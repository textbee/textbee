import { STATUS_TIMEOUT_DISPATCHED_MESSAGE } from './error-history'
import {
  StatusDecision,
  decideStatusReport,
  isReportedStatus,
} from './status-report-decision'

const t = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute))
const now = t(59)

function applied(decision: StatusDecision) {
  if (decision.kind !== 'apply') {
    throw new Error(`expected apply, got ${decision.kind}`)
  }
  return decision
}

describe('isReportedStatus', () => {
  it('accepts only what the phone reports', () => {
    expect(isReportedStatus('delivery_failed')).toBe(true)
    expect(isReportedStatus('unknown')).toBe(false)
    expect(isReportedStatus('pending')).toBe(false)
  })
})

describe('decideStatusReport', () => {
  describe('sent and delivered reports', () => {
    it('moves a dispatched message forward', () => {
      const d = applied(
        decideStatusReport({ status: 'dispatched' }, { status: 'sent', at: t(1) }, now),
      )

      expect(d).toEqual(
        expect.objectContaining({
          status: 'sent',
          writeStatus: true,
          statusChanged: true,
          set: { sentAt: t(1) },
          unset: [],
          entries: [],
        }),
      )
    })

    it('drops the timeout note without recording a failure', () => {
      const d = applied(
        decideStatusReport(
          { status: 'unknown', errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE },
          { status: 'delivered', at: t(5) },
          now,
        ),
      )

      expect(d.status).toBe('delivered')
      expect(d.unset).toEqual(['errorMessage'])
      expect(d.entries).toEqual([])
    })

    it('moves sent to delivered', () => {
      const d = applied(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'delivered', at: t(2) },
          now,
        ),
      )

      expect(d.status).toBe('delivered')
      expect(d.statusChanged).toBe(true)
    })

    it('never moves delivered back to sent', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', sentAt: t(1), deliveredAt: t(2) },
          { status: 'sent', at: t(1) },
          now,
        ),
      ).toEqual({ kind: 'noop' })
    })

    it('fills a missing sent time on a delivered message', () => {
      const d = applied(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(2) },
          { status: 'sent', at: t(1) },
          now,
        ),
      )

      expect(d.status).toBe('delivered')
      expect(d.statusChanged).toBe(false)
      expect(d.writeStatus).toBe(false)
      expect(d.set).toEqual({ sentAt: t(1) })
    })

    it('moves a message with a delivery time to delivered, not sent', () => {
      const d = applied(
        decideStatusReport(
          { status: 'unknown', deliveredAt: t(4) },
          { status: 'sent', at: t(3) },
          now,
        ),
      )

      expect(d.status).toBe('delivered')
    })

    it('treats a repeated report as nothing new', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'sent', at: t(1) },
          now,
        ),
      ).toEqual({ kind: 'noop' })
    })

    it('clears a recovered failure and keeps it in the trail', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(1),
            errorCode: '4',
            errorMessage: 'no service',
          },
          { status: 'sent', at: t(3) },
          now,
        ),
      )

      expect(d.status).toBe('sent')
      expect(d.statusChanged).toBe(true)
      expect(d.unset.sort()).toEqual(['errorCode', 'errorMessage', 'failedAt'])
      expect(d.entries).toEqual([
        {
          code: '4',
          message: 'no service',
          at: t(1),
          source: 'device',
          backfilled: true,
        },
      ])
    })

    it('does not copy a failure the trail already holds', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(1),
            errorCode: '4',
            issueHistory: [{ code: '4', at: t(1), source: 'device' }],
          },
          { status: 'delivered', at: t(3) },
          now,
        ),
      )

      expect(d.entries).toEqual([])
      expect(d.unset.sort()).toEqual(['errorCode', 'failedAt'])
    })

    it('keeps a phone failure that came after the reported send', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(5),
            errorCode: '1',
            issueHistory: [{ code: '1', at: t(5), source: 'device' }],
          },
          { status: 'sent', at: t(4) },
          now,
        ),
      )

      expect(d.status).toBe('failed')
      expect(d.statusChanged).toBe(false)
      expect(d.set).toEqual({ sentAt: t(4) })
      expect(d.unset).toEqual([])
    })

    it('lets a phone report beat a push failure whatever the times', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(5),
            errorCode: 'FCM_SEND_TIMEOUT',
            issueHistory: [{ code: 'FCM_SEND_TIMEOUT', at: t(5), source: 'fcm' }],
          },
          { status: 'sent', at: t(4) },
          now,
        ),
      )

      expect(d.status).toBe('sent')
      expect(d.statusChanged).toBe(true)
    })

    it('clears stale failure fields left on a delivered message', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'delivered',
            deliveredAt: t(6),
            failedAt: t(2),
            errorCode: '1',
            errorMessage: 'generic',
          },
          { status: 'delivered', at: t(6) },
          now,
        ),
      )

      expect(d.statusChanged).toBe(false)
      expect(d.entries).toHaveLength(1)
      expect(d.unset.sort()).toEqual(['errorCode', 'errorMessage', 'failedAt'])
    })

    it('keeps the test-skip marker', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'unknown',
            errorCode: 'FCM_SEND_SKIPPED',
            errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE,
          },
          { status: 'sent', at: t(1) },
          now,
        ),
      )

      expect(d.unset).toEqual(['errorMessage'])
      expect(d.entries).toEqual([])
    })

    it('rewrites a legacy uppercase status', () => {
      const d = applied(
        decideStatusReport(
          { status: 'FAILED', failedAt: t(1), errorCode: 'X' },
          { status: 'delivered', at: t(3) },
          now,
        ),
      )

      expect(d.status).toBe('delivered')
      expect(d.writeStatus).toBe(true)
    })
  })

  describe('failed reports', () => {
    it('fails a dispatched message', () => {
      const d = applied(
        decideStatusReport(
          { status: 'dispatched' },
          { status: 'failed', at: t(2), code: 'PERMISSION_DENIED', message: 'denied' },
          now,
        ),
      )

      expect(d.status).toBe('failed')
      expect(d.statusChanged).toBe(true)
      expect(d.set).toEqual({
        failedAt: t(2),
        errorMessage: 'denied',
        errorCode: 'PERMISSION_DENIED',
      })
      expect(d.entries).toEqual([
        { code: 'PERMISSION_DENIED', message: 'denied', at: t(2), source: 'device' },
      ])
    })

    it('uses the server time and a placeholder when the phone sent neither', () => {
      const d = applied(
        decideStatusReport({ status: 'pending', errorCode: 'FCM_X' }, { status: 'failed' }, now),
      )

      expect(d.set).toEqual({
        failedAt: now,
        errorMessage: 'Unknown error',
        'metadata.failureTimeFromServer': true,
      })
      expect(d.unset).toEqual(['errorCode'])
      expect(d.entries[d.entries.length - 1]).toEqual({
        code: 'UNKNOWN',
        message: 'Unknown error',
        at: now,
        source: 'device',
      })
    })

    it('fails a delivered message when a part failed afterwards', () => {
      const d = applied(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(2) },
          { status: 'failed', at: t(3), code: '1' },
          now,
        ),
      )

      expect(d.status).toBe('failed')
      expect(d.unset).not.toContain('deliveredAt')
    })

    it('only records a failure older than the delivery', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(5) },
          { status: 'failed', at: t(3), code: '1' },
          now,
        ),
      ).toEqual({
        kind: 'history',
        entries: [{ code: '1', message: 'Unknown error', at: t(3), source: 'device' }],
      })
    })

    it('only records a failure older than the send', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(5) },
          { status: 'failed', at: t(3), code: '1' },
          now,
        ).kind,
      ).toBe('history')
    })

    it('ignores a retried failure', () => {
      expect(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(3),
            errorCode: '1',
            issueHistory: [{ code: '1', at: t(3), source: 'device' }],
          },
          { status: 'failed', at: t(3), code: '1' },
          now,
        ),
      ).toEqual({ kind: 'noop' })
    })

    it('replaces the current failure with a newer one and keeps the old one', () => {
      const d = applied(
        decideStatusReport(
          { status: 'failed', failedAt: t(1), errorCode: '4', errorMessage: 'no service' },
          { status: 'failed', at: t(4), code: '1', message: 'generic' },
          now,
        ),
      )

      expect(d.statusChanged).toBe(false)
      expect(d.set.errorCode).toBe('1')
      expect(d.entries.map((e) => e.code)).toEqual(['4', '1'])
    })

    it('only records an older phone failure', () => {
      expect(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(5),
            errorCode: '1',
            issueHistory: [{ code: '1', at: t(5), source: 'device' }],
          },
          { status: 'failed', at: t(2), code: '4' },
          now,
        ).kind,
      ).toBe('history')
    })
  })

  describe('a phone failure without a phone time', () => {
    it('marks the failure time as server time', () => {
      const d = applied(
        decideStatusReport({ status: 'dispatched' }, { status: 'failed', code: '1' }, now),
      )

      expect(d.set['metadata.failureTimeFromServer']).toBe(true)
    })

    it('loses to a later phone report even when the phone time looks earlier', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(30),
            errorCode: '1',
            issueHistory: [{ code: '1', at: t(30), source: 'device' }],
            metadata: { failureTimeFromServer: true },
          },
          { status: 'sent', at: t(20) },
          now,
        ),
      )

      expect(d.status).toBe('sent')
      expect(d.unset).toContain('metadata.failureTimeFromServer')
    })

    it('drops the mark when a phone-timed failure replaces it', () => {
      const d = applied(
        decideStatusReport(
          {
            status: 'failed',
            failedAt: t(30),
            errorCode: '1',
            issueHistory: [{ code: '1', at: t(30), source: 'device' }],
            metadata: { failureTimeFromServer: true },
          },
          { status: 'failed', at: t(10), code: '4' },
          now,
        ),
      )

      expect(d.set.errorCode).toBe('4')
      expect(d.unset).toContain('metadata.failureTimeFromServer')
    })
  })

  describe('delivery_failed reports', () => {
    it('records the report and keeps the status', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(1) },
          { status: 'delivery_failed', code: '0', message: 'canceled' },
          now,
        ),
      ).toEqual({
        kind: 'history',
        entries: [
          { code: '0', message: 'canceled', at: now, source: 'device', deliveryReport: true },
        ],
      })
    })

    it('records a carrier failure with its phone time and keeps the status', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'delivery_failed', at: t(2), code: 'CARRIER_0x41', message: 'gave up' },
          now,
        ),
      ).toEqual({
        kind: 'history',
        entries: [
          { code: 'CARRIER_0x41', message: 'gave up', at: t(2), source: 'device', deliveryReport: true },
        ],
      })
    })

    it('never moves a sent message to failed', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'delivery_failed', code: '0', message: 'canceled' },
          now,
        ).kind,
      ).toBe('history')
    })

    it('ignores a retry that carries no phone time', () => {
      expect(
        decideStatusReport(
          {
            status: 'sent',
            issueHistory: [
              { code: '0', message: 'canceled', at: t(1), source: 'device', deliveryReport: true },
            ],
          },
          { status: 'delivery_failed', code: '0', message: 'canceled' },
          now,
        ),
      ).toEqual({ kind: 'noop' })
    })
  })

  it('ignores a report on a received message', () => {
    expect(
      decideStatusReport({ status: 'received' }, { status: 'sent', at: t(1) }, now),
    ).toEqual({ kind: 'noop' })
  })
})
