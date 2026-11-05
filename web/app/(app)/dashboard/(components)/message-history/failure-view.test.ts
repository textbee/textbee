import { describe, expect, it } from 'vitest'
import {
  entryView,
  errorMeta,
  failedBeforeSent,
  failureReason,
  failureView,
  firstSentence,
  historyHeading,
  safeDocsUrl,
  sourceLabel,
  timelinePattern,
} from './failure-view'

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString()

describe('failureView', () => {
  it('shows the current failure and hides it from the earlier list', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorCode: '1',
      errorMessage: 'generic',
      failedAt: at(5),
      issueHistory: [
        { code: '1', at: at(5), source: 'device' },
        { code: 'FCM_SEND_TIMEOUT', at: at(1), source: 'push' },
      ],
    })

    expect(view).toEqual({
      kind: 'failed',
      code: '1',
      message: 'generic',
      source: 'device',
      others: [{ code: 'FCM_SEND_TIMEOUT', at: at(1), source: 'push' }],
    })
  })

  it('finds the current failure when the phone sent no code', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorMessage: 'Unknown error',
      failedAt: at(5),
      issueHistory: [{ code: 'UNKNOWN', message: 'Unknown error', at: at(5), source: 'device' }],
    })

    expect(view).toEqual(expect.objectContaining({ kind: 'failed', others: [] }))
  })

  it('finds the current failure of an old message without failedAt', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorMessage: 'queue down',
      issueHistory: [
        { code: '4', at: at(1), source: 'device' },
        { code: 'UNKNOWN', message: 'queue down', at: at(2), source: 'server', backfilled: true },
      ],
    })

    expect(view).toEqual(
      expect.objectContaining({ others: [{ code: '4', at: at(1), source: 'device' }] })
    )
  })

  it('shows an old failure that has no history', () => {
    expect(
      failureView({ _id: 'm', status: 'FAILED', errorCode: '4', errorMessage: 'no service' })
    ).toEqual({ kind: 'failed', code: '4', message: 'no service', others: [] })
  })

  it('lists the failures of a message that went out after all', () => {
    const view = failureView({
      _id: 'm',
      status: 'delivered',
      issueHistory: [{ code: '1', at: at(1), source: 'device' }],
    })

    expect(view).toEqual({
      kind: 'recovered',
      attempts: [{ code: '1', at: at(1), source: 'device' }],
      failures: 1,
      capped: false,
    })
  })

  it('does not call an unconfirmed delivery report a failure', () => {
    const report = { code: '0', at: at(2), source: 'device' as const, deliveryReport: true }
    expect(failureView({ _id: 'm', status: 'sent', issueHistory: [report] })).toEqual({
      kind: 'delivery-unconfirmed',
      attempts: [report],
    })
    const mixed = failureView({
      _id: 'm',
      status: 'delivered',
      issueHistory: [{ code: '1', at: at(1), source: 'device' }, report],
    })
    expect(mixed).toEqual(expect.objectContaining({ kind: 'recovered', failures: 1 }))
  })

  it('says nothing about leftover error text on a delivered message', () => {
    expect(
      failureView({
        _id: 'm',
        status: 'delivered',
        errorMessage: 'Status update timeout - no response from device after dispatch',
      })
    ).toBeNull()
  })

  it('explains a missing report instead of calling it a failure', () => {
    expect(
      failureView({
        _id: 'm',
        status: 'unknown',
        errorMessage: 'Status update timeout - no response from device after dispatch',
      })
    ).toEqual({ kind: 'no-report', attempts: [] })
  })

  it('keeps phone reports seen on an unknown message', () => {
    expect(
      failureView({
        _id: 'm',
        status: 'unknown',
        issueHistory: [{ code: '0', message: 'canceled', at: at(1), source: 'device' }],
      })
    ).toEqual({
      kind: 'no-report',
      attempts: [{ code: '0', message: 'canceled', at: at(1), source: 'device' }],
    })
  })

  it('adds the catalog fields of the current failure', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorCode: '7',
      errorName: 'SHORT_CODE_CANCELLED',
      errorMessage: 'The phone asked to allow this short code, and someone tapped Cancel.',
      deviceMessage: 'Short code not allowed on this carrier.',
      docsUrl: 'https://textbee.dev/docs/short-codes',
      failedAt: at(5),
      issueHistory: [{ code: '7', at: at(5), source: 'device' }],
    })

    expect(view).toEqual(
      expect.objectContaining({
        name: 'SHORT_CODE_CANCELLED',
        deviceMessage: 'Short code not allowed on this carrier.',
        docsUrl: 'https://textbee.dev/docs/short-codes',
        source: 'device',
        others: [],
      })
    )
  })

  it('falls back to the catalog fields of the history entry', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorCode: '7',
      errorMessage: 'catalog text',
      failedAt: at(5),
      issueHistory: [
        {
          code: '7',
          name: 'SHORT_CODE_CANCELLED',
          deviceMessage: 'phone text',
          docsUrl: 'https://textbee.dev/docs/short-codes',
          at: at(5),
          source: 'device',
        },
      ],
    })

    expect(view).toEqual(
      expect.objectContaining({
        name: 'SHORT_CODE_CANCELLED',
        deviceMessage: 'phone text',
        docsUrl: 'https://textbee.dev/docs/short-codes',
      })
    )
  })

  it('hides phone text that repeats the message, and unsafe docs links', () => {
    const view = failureView({
      _id: 'm',
      status: 'failed',
      errorCode: '1',
      errorMessage: 'Generic failure.',
      deviceMessage: ' Generic failure. ',
      docsUrl: 'javascript:alert(1)',
    })

    expect(view).toEqual(
      expect.objectContaining({ deviceMessage: undefined, docsUrl: undefined, source: undefined })
    )
  })

  it('shows nothing for a message still on its way', () => {
    expect(failureView({ _id: 'm', status: 'dispatched', errorCode: 'FCM_SEND_SKIPPED' })).toBeNull()
  })
})

describe('sourceLabel', () => {
  it('names where the failure came from', () => {
    expect(sourceLabel('device')).toBe('Phone')
    expect(sourceLabel('push')).toBe('Push service')
    expect(sourceLabel('server')).toBe('Server')
  })
})

describe('firstSentence', () => {
  it('cuts the text after its first sentence', () => {
    expect(firstSentence('SMS failed on device. Check SIM balance.')).toBe('SMS failed on device.')
    expect(firstSentence('Is the SIM in? Check it.')).toBe('Is the SIM in?')
  })

  it('keeps text without a sentence end, and dots inside words', () => {
    expect(firstSentence('Status update timeout - no response')).toBe(
      'Status update timeout - no response'
    )
    expect(firstSentence('Update to app 2.9.0 first. Then retry.')).toBe(
      'Update to app 2.9.0 first.'
    )
    expect(firstSentence(undefined)).toBe('')
  })
})

describe('failureReason', () => {
  it('gives the first sentence of a failed message', () => {
    expect(
      failureReason({
        _id: 'm',
        status: 'failed',
        errorMessage: 'The phone had no cellular service. Try again later.',
      })
    ).toBe('The phone had no cellular service.')
  })

  it('gives nothing for other statuses or a missing message', () => {
    expect(failureReason({ _id: 'm', status: 'delivered', errorMessage: 'old text' })).toBeUndefined()
    expect(failureReason({ _id: 'm', status: 'failed' })).toBeUndefined()
  })
})

describe('failedBeforeSent', () => {
  const failure = (minute: number) => ({ code: '4', at: at(minute), source: 'device' as const })

  it('counts failures of a message that went out', () => {
    expect(failedBeforeSent({ _id: 'm', status: 'delivered', issueHistory: [failure(1)] })).toBe(
      'Failed once before it was sent'
    )
    expect(
      failedBeforeSent({ _id: 'm', status: 'sent', issueHistory: [failure(1), failure(2)] })
    ).toBe('Failed 2 times before it was sent')
  })

  it('says "or more" when the history is capped', () => {
    const issueHistory = Array.from({ length: 15 }, (_, i) => failure(i))
    expect(failedBeforeSent({ _id: 'm', status: 'delivered', issueHistory })).toBe(
      'Failed 15 or more times before it was sent'
    )
  })

  it('ignores delivery reports and failed messages', () => {
    const report = { ...failure(1), deliveryReport: true }
    expect(failedBeforeSent({ _id: 'm', status: 'sent', issueHistory: [report] })).toBeUndefined()
    expect(
      failedBeforeSent({ _id: 'm', status: 'failed', issueHistory: [failure(1)] })
    ).toBeUndefined()
  })
})

describe('errorMeta', () => {
  it('joins source, code and name', () => {
    expect(errorMeta({ source: 'device', code: '7', name: 'SHORT_CODE_CANCELLED' })).toBe(
      'Phone · code 7 · SHORT_CODE_CANCELLED'
    )
  })

  it('skips missing parts and a name that repeats the code', () => {
    expect(errorMeta({ code: '7' })).toBe('code 7')
    expect(errorMeta({ source: 'server', code: 'DISPATCH_FAILED', name: 'DISPATCH_FAILED' })).toBe(
      'Server · code DISPATCH_FAILED'
    )
    expect(errorMeta({ source: 'device', code: '0', deliveryReport: true })).toBe(
      'Delivery report · code 0'
    )
    expect(errorMeta({})).toBe('')
  })
})

describe('historyHeading', () => {
  const failure = { code: '4', at: at(1), source: 'device' as const }
  const report = { ...failure, deliveryReport: true }

  it('names the list by what it holds', () => {
    expect(historyHeading('recovered', [failure, report])).toBe('Attempts before it was sent')
    expect(historyHeading('failed', [failure])).toBe('Earlier failures')
    expect(historyHeading('failed', [report])).toBe('Delivery reports')
    expect(historyHeading('failed', [failure, report])).toBe('Earlier failures and reports')
    expect(historyHeading('delivery-unconfirmed', [report])).toBe('Delivery reports')
    expect(historyHeading('no-report', [failure])).toBe('Failures recorded')
    expect(historyHeading('no-report', [failure, report])).toBe('Failures and reports')
  })
})

describe('timelinePattern', () => {
  const entry = (iso: string) => ({ code: '4', at: iso, source: 'device' as const })

  it('shows times only when everything is on one day', () => {
    expect(timelinePattern([entry(at(1)), entry(at(5))], new Date(at(0)))).toBe('h:mm:ss a')
  })

  it('shows the date when the entries span days', () => {
    const nextDay = new Date(Date.UTC(2026, 9, 2, 10, 0)).toISOString()
    expect(timelinePattern([entry(at(1)), entry(nextDay)])).toBe('MMM d, h:mm:ss a')
    expect(timelinePattern([entry(nextDay)], new Date(at(0)))).toBe('MMM d, h:mm:ss a')
  })
})

describe('entryView', () => {
  it('shows the first sentence and keeps the rest for the expanded view', () => {
    expect(
      entryView({
        code: '4',
        message: 'The phone had no cellular service. Check signal.',
        deviceMessage: 'RESULT_ERROR_NO_SERVICE',
        at: at(1),
        source: 'device',
      })
    ).toEqual({
      meta: 'Phone · code 4',
      summary: 'The phone had no cellular service.',
      full: 'The phone had no cellular service. Check signal.',
      deviceText: 'RESULT_ERROR_NO_SERVICE',
    })
  })

  it('has nothing to expand for a one-sentence entry', () => {
    expect(
      entryView({ code: '4', message: 'No service.', deviceMessage: 'No service.', at: at(1), source: 'device' })
    ).toEqual({ meta: 'Phone · code 4', summary: 'No service.', full: undefined, deviceText: undefined })
  })

  it('explains a delivery report without text', () => {
    expect(
      entryView({ code: '0', at: at(1), source: 'device', deliveryReport: true }).summary
    ).toBe('The carrier did not confirm delivery.')
  })
})

describe('safeDocsUrl', () => {
  it('keeps web links only', () => {
    expect(safeDocsUrl('https://textbee.dev/docs')).toBe('https://textbee.dev/docs')
    expect(safeDocsUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeDocsUrl('not a url')).toBeUndefined()
    expect(safeDocsUrl(undefined)).toBeUndefined()
  })
})
