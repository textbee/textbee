import { STATUS_TIMEOUT_DISPATCHED_MESSAGE } from './error-history'
import {
  DecisionRules,
  StatusDecision,
  StatusReport,
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

    it('only records a carrier code, as any other delivery report', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'delivery_failed', at: t(2), code: 'CARRIER_0x41', message: 'gave up' },
          now,
        ),
      ).toEqual({
        kind: 'history',
        entries: [
          {
            code: 'CARRIER_0x41',
            message: 'gave up',
            at: t(2),
            source: 'device',
            deliveryReport: true,
          },
        ],
      })
    })

    it('keeps a carrier failure when the earlier sent report arrives after it', () => {
      const failed = {
        status: 'failed',
        failedAt: t(2),
        errorCode: 'CARRIER_0x41',
        errorMessage: 'gave up',
        issueHistory: [{ code: 'CARRIER_0x41', message: 'gave up', at: t(2), source: 'device' }],
      }
      const d = applied(decideStatusReport(failed, { status: 'sent', at: t(1) }, now))
      expect(d.status).toBe('failed')
      expect(d.statusChanged).toBe(false)
      expect(d.set).toEqual({ sentAt: t(1) })
    })

    it('keeps the old rule for delivery reports without a carrier code', () => {
      expect(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'delivery_failed', at: t(2), code: '0' },
          now,
        ).kind,
      ).toBe('history')
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

  describe('carrier verdict', () => {
    it('fails a sent message on a carrier failure', () => {
      const d = applied(
        decideStatusReport(
          { status: 'sent', sentAt: t(1) },
          { status: 'failed', at: t(2), code: 'CARRIER_0x41', message: 'gave up' },
          now,
        ),
      )
      expect(d).toEqual(
        expect.objectContaining({
          status: 'failed',
          statusChanged: true,
          set: expect.objectContaining({
            failedAt: t(2),
            errorCode: 'CARRIER_0x41',
            errorMessage: 'gave up',
          }),
          entries: [{ code: 'CARRIER_0x41', message: 'gave up', at: t(2), source: 'device' }],
        }),
      )
    })

    it('fails a single-part delivered message only on a later carrier failure', () => {
      const delivered = { status: 'delivered', sentAt: t(1), deliveredAt: t(2) }
      expect(
        applied(
          decideStatusReport(
            delivered,
            { status: 'failed', at: t(3), code: 'CARRIER_0x41', partCount: 1 },
            now,
          ),
        ).status,
      ).toBe('failed')
      expect(
        decideStatusReport(
          delivered,
          { status: 'failed', at: t(1), code: 'CARRIER_0x41', partCount: 1 },
          now,
        ).kind,
      ).toBe('history')
    })

    it('moves a waiting message to sent while the carrier still tries', () => {
      for (const status of ['pending', 'dispatched', 'unknown']) {
        const d = applied(
          decideStatusReport(
            { status },
            { status: 'delivered', at: t(2), stillTrying: true, partCount: 1 },
            now,
          ),
        )
        expect(d.status).toBe('sent')
        expect(d.statusChanged).toBe(true)
        expect(d.set).toEqual({})
      }
    })

    it('drops the timeout note when the carrier still tries', () => {
      const d = applied(
        decideStatusReport(
          { status: 'unknown', errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE },
          { status: 'delivered', at: t(2), stillTrying: true },
          now,
        ),
      )
      expect(d.status).toBe('sent')
      expect(d.unset).toEqual(['errorMessage'])
    })

    it('never moves a message back or to delivered while the carrier still tries', () => {
      for (const stored of [
        { status: 'sent', sentAt: t(1) },
        { status: 'delivered', deliveredAt: t(1) },
        { status: 'failed', failedAt: t(1), errorCode: '1' },
      ]) {
        expect(
          decideStatusReport(
            stored,
            { status: 'delivered', at: t(2), stillTrying: true, partCount: 3 },
            now,
          ),
        ).toEqual({ kind: 'noop' })
      }
    })
  })

  describe('a failure is final for a long message', () => {
    const failedPart = { status: 'failed' as const, at: t(2), code: '1', partCount: 3 }

    it('fails a delivered message even when the failure came first', () => {
      const delivered = { status: 'delivered', sentAt: t(1), deliveredAt: t(5) }
      const d = applied(decideStatusReport(delivered, failedPart, now))
      expect(d.status).toBe('failed')
      expect(d.statusChanged).toBe(true)
      expect(d.set).toEqual(expect.objectContaining({ failedAt: t(2), errorCode: '1' }))
    })

    it('fails a sent message even when the failure came first', () => {
      const d = applied(
        decideStatusReport({ status: 'sent', sentAt: t(3) }, failedPart, now),
      )
      expect(d.status).toBe('failed')
    })

    it('treats a carrier failure of a part the same way', () => {
      const d = applied(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(5) },
          { status: 'failed', at: t(2), code: 'CARRIER_0x41', partCount: 2 },
          now,
        ),
      )
      expect(d.status).toBe('failed')
      expect(d.set.errorCode).toBe('CARRIER_0x41')
    })

    it('only fills a time when a later part reports sent or delivered', () => {
      const failed = {
        status: 'failed',
        failedAt: t(2),
        errorCode: '1',
        issueHistory: [{ code: '1', at: t(2), source: 'device' }],
      }
      const d = applied(
        decideStatusReport(failed, { status: 'delivered', at: t(5), partCount: 3 }, now),
      )
      expect(d.status).toBe('failed')
      expect(d.statusChanged).toBe(false)
      expect(d.set).toEqual({ deliveredAt: t(5) })
      expect(d.unset).toEqual([])
    })

    it('lets a part report clear a push failure', () => {
      const pushFailed = {
        status: 'failed',
        failedAt: t(2),
        errorCode: 'FCM_TOKEN_NOT_REGISTERED',
        issueHistory: [{ code: 'FCM_TOKEN_NOT_REGISTERED', at: t(2), source: 'push' }],
      }
      const d = applied(
        decideStatusReport(pushFailed, { status: 'sent', at: t(5), partCount: 3 }, now),
      )
      expect(d.status).toBe('sent')
    })

    it('does not count delivery_failed as a failure', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(5) },
          { status: 'delivery_failed', at: t(6), code: '0', partCount: 3 },
          now,
        ).kind,
      ).toBe('history')
    })

    it('keeps the old rule for a single-part message', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(5) },
          { ...failedPart, partCount: 1 },
          now,
        ).kind,
      ).toBe('history')
    })

    it('keeps the old rule for a report without partCount', () => {
      expect(
        decideStatusReport(
          { status: 'delivered', deliveredAt: t(5) },
          { status: 'failed', at: t(2), code: '1' },
          now,
        ).kind,
      ).toBe('history')
      const failed = {
        status: 'failed',
        failedAt: t(2),
        errorCode: '1',
        issueHistory: [{ code: '1', at: t(2), source: 'device' }],
      }
      expect(
        applied(decideStatusReport(failed, { status: 'delivered', at: t(5) }, now)).status,
      ).toBe('delivered')
    })

    it('keeps the old rule when the switch is off', () => {
      expect(
        decideStatusReport({ status: 'delivered', deliveredAt: t(5) }, failedPart, now, {
          multipartFailureFinal: false,
        }).kind,
      ).toBe('history')
    })

    // Applies each decision the way the service writes it; counts moves into failed
    function play(
      reports: StatusReport[],
      rules?: DecisionRules,
      start: Record<string, any> = { status: 'dispatched' },
    ): Record<string, any> {
      let stored: Record<string, any> = { ...start }
      let failedMoves = 0
      for (const report of reports) {
        const d = decideStatusReport(stored as any, report, now, rules)
        if (d.kind === 'noop') continue
        const history = [...(stored.issueHistory ?? []), ...d.entries]
        if (d.kind === 'history') {
          stored = { ...stored, issueHistory: history }
          continue
        }
        if (d.status === 'failed' && stored.status !== 'failed') failedMoves++
        stored = { ...stored, ...d.set, status: d.status, issueHistory: history }
        for (const key of d.unset) delete stored[key]
      }
      return { ...stored, failedMoves }
    }

    function orders<T>(items: T[]): T[][] {
      if (items.length <= 1) return [items]
      return items.flatMap((item, i) =>
        orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
      )
    }

    const label = (order: StatusReport[]) =>
      order.map((r) => `${r.code ?? r.status}@${r.at.getUTCMinutes()}`).join(' ')

    const failedPartReport: StatusReport = {
      status: 'failed',
      at: t(2),
      code: '1',
      message: 'generic failure',
      partCount: 3,
    }
    const reports: StatusReport[] = [
      { status: 'sent', at: t(1), partCount: 3 },
      failedPartReport,
      { status: 'sent', at: t(3), partCount: 3 },
      { status: 'delivered', at: t(4), partCount: 3 },
    ]

    it('ends failed in every arrival order of a long message with a failed part', () => {
      const all = orders(reports)
      expect(all).toHaveLength(24)
      for (const order of all) {
        const end = play(order)
        expect([label(order), end.status, end.failedMoves]).toEqual([label(order), 'failed', 1])
        expect(end.errorCode).toBe('1')
        expect(end.failedAt).toEqual(t(2))
        expect(end.sentAt).toBeInstanceOf(Date)
      }
    })

    it('ends failed in every order when the message starts as a server failure', () => {
      const serverFailure = {
        status: 'failed',
        failedAt: t(0),
        errorCode: 'SEND_TIMEOUT',
        errorMessage: 'no report from the phone',
        issueHistory: [
          { code: 'SEND_TIMEOUT', message: 'no report from the phone', at: t(0), source: 'server' },
        ],
      }
      for (const order of orders(reports)) {
        const end = play(order, undefined, serverFailure)
        // the phone failure replaces the server one in place when it comes first
        const moves = order[0] === failedPartReport ? 0 : 1
        expect([label(order), end.status, end.failedMoves]).toEqual([
          label(order),
          'failed',
          moves,
        ])
        expect(end.errorCode).toBe('1')
        expect(end.failedAt).toEqual(t(2))
        expect(end.sentAt).toBeInstanceOf(Date)
      }
    })

    it('ends with the later carrier failure in every order of five reports', () => {
      const all = orders<StatusReport>([
        ...reports,
        { status: 'failed', at: t(6), code: 'CARRIER_0x41', message: 'gave up', partCount: 3 },
      ])
      expect(all).toHaveLength(120)
      for (const order of all) {
        const end = play(order)
        expect([label(order), end.status, end.failedMoves]).toEqual([label(order), 'failed', 1])
        expect(end.errorCode).toBe('CARRIER_0x41')
        expect(end.failedAt).toEqual(t(6))
        expect(end.sentAt).toBeInstanceOf(Date)
        expect(end.issueHistory.map((e) => e.code).sort()).toEqual(['1', 'CARRIER_0x41'])
      }
    })

    it('can end delivered in some order when the switch is off', () => {
      const ends = orders(reports).map(
        (order) => play(order, { multipartFailureFinal: false }).status,
      )
      expect(ends).toContain('delivered')
    })
  })

  it('ignores a report on a received message', () => {
    expect(
      decideStatusReport({ status: 'received' }, { status: 'sent', at: t(1) }, now),
    ).toEqual({ kind: 'noop' })
  })
})
