import {
  ERROR_HISTORY_LIMIT,
  STATUS_TIMEOUT_DISPATCHED_MESSAGE,
  capErrorHistory,
  currentFailureEntry,
  errorHistoryAppend,
  literalSetStage,
  inferFailureSource,
  isStatusTimeoutNote,
  storedErrorHistory,
} from './error-history'

describe('errorHistoryAppend', () => {
  const at = new Date('2026-09-20T10:00:00.000Z')
  const entriesOf = (stage: any, field = 'issueHistory') =>
    stage.$set[field].$let.vars.all.$sortArray.input.$concatArrays[1].$literal

  it('appends one entry to the trail as a literal, not to metadata', () => {
    const stage = errorHistoryAppend(
      { code: 'NO_SERVICE', message: '$not a path', source: 'device' },
      at,
    )

    const entry = { code: 'NO_SERVICE', message: '$not a path', at, source: 'device' }
    expect(entriesOf(stage)).toEqual([entry])
    expect(stage.$set).not.toHaveProperty(['metadata.errorHistory'])
  })

  it('keeps the first five and the newest ten', () => {
    const stage = errorHistoryAppend({ code: 'X', source: 'push' }, at)
    const cap = (stage.$set.issueHistory as any).$let.in.$cond

    expect(ERROR_HISTORY_LIMIT).toBe(15)
    expect(cap[0]).toEqual({ $lte: [{ $size: '$$all' }, 15] })
    expect(cap[2].$concatArrays).toEqual([
      { $firstN: { n: 5, input: '$$all' } },
      { $lastN: { n: 10, input: '$$all' } },
    ])
  })

  it('labels a message-only failure UNKNOWN rather than dropping it', () => {
    const stage = errorHistoryAppend({ message: 'timed out', source: 'server' }, at)

    expect(entriesOf(stage)[0].code).toBe('UNKNOWN')
  })

  it('returns null when there is nothing to record', () => {
    expect(errorHistoryAppend({ source: 'server' }, at)).toBeNull()
    expect(errorHistoryAppend({ code: '  ', message: '', source: 'push' }, at)).toBeNull()
    expect(errorHistoryAppend({ code: 42 as any, source: 'push' }, at)).toBeNull()
  })

  it('truncates a long message', () => {
    const stage = errorHistoryAppend({ code: 'X', message: 'y'.repeat(1000), source: 'device' }, at)

    expect(entriesOf(stage)[0].message).toHaveLength(300)
  })
})

describe('literalSetStage', () => {
  it('wraps every value and drops undefined ones', () => {
    expect(literalSetStage({ a: '$b', c: undefined, d: 1 })).toEqual({
      $set: { a: { $literal: '$b' }, d: { $literal: 1 } },
    })
  })
})

describe('capErrorHistory', () => {
  it('keeps short trails whole and long ones at both ends', () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ at: new Date(i * 1000), i }))

    expect(capErrorHistory(entries.slice(0, 15))).toHaveLength(15)
    expect(capErrorHistory(entries).map((e) => e.i)).toEqual([
      0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ])
  })
})

describe('storedErrorHistory', () => {
  const t = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute))

  it('merges both trails, dedupes, maps fcm to push and sorts by time', () => {
    const history = storedErrorHistory({
      metadata: {
        errorHistory: [
          { code: 'FCM_SEND_TIMEOUT', at: t(1), source: 'fcm' },
          { code: '4', at: t(3), source: 'device' },
        ],
      },
      issueHistory: [
        { code: '4', at: t(3).toISOString(), source: 'device' },
        { code: '1', at: t(2), source: 'device', message: 'generic' },
      ],
    })

    expect(history).toEqual([
      { code: 'FCM_SEND_TIMEOUT', at: t(1), source: 'push' },
      { code: '1', at: t(2), source: 'device', message: 'generic' },
      { code: '4', at: t(3), source: 'device' },
    ])
  })

  it('keeps the first five and the newest ten', () => {
    const history = storedErrorHistory({
      issueHistory: Array.from({ length: 18 }, (_, i) => ({
        code: String(i),
        at: t(i),
        source: 'device',
      })),
    })

    expect(history.map((e) => e.code)).toEqual([
      '0', '1', '2', '3', '4', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17',
    ])
  })

  it('keeps the delivery report mark', () => {
    expect(
      storedErrorHistory({
        issueHistory: [{ code: '0', at: t(1), source: 'device', deliveryReport: true }],
      }),
    ).toEqual([{ code: '0', at: t(1), source: 'device', deliveryReport: true }])
  })

  it('skips entries without a usable time and survives odd shapes', () => {
    expect(
      storedErrorHistory({
        issueHistory: [{ code: 'X', at: 'not a date' }, null],
        metadata: { errorHistory: 'nope' },
      }),
    ).toEqual([])
    expect(storedErrorHistory({ metadata: null })).toEqual([])
  })
})

describe('currentFailureEntry', () => {
  const failedAt = new Date('2026-09-01T08:00:00.000Z')

  it('rebuilds the failure the top-level fields still hold', () => {
    expect(
      currentFailureEntry(
        { errorCode: 'PERMISSION_DENIED', errorMessage: 'no permission', failedAt },
        [],
      ),
    ).toEqual({
      code: 'PERMISSION_DENIED',
      message: 'no permission',
      at: failedAt,
      source: 'device',
      backfilled: true,
    })
  })

  it('returns null when the trail already holds it', () => {
    expect(
      currentFailureEntry({ errorCode: '4', failedAt }, [
        { code: '4', at: failedAt, source: 'device' },
      ]),
    ).toBeNull()
  })

  it('never turns the timeout note into a failure', () => {
    expect(
      currentFailureEntry({ errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE }, []),
    ).toBeNull()
  })

  it('never turns the test-skip marker into a failure', () => {
    expect(
      currentFailureEntry(
        { errorCode: 'FCM_SEND_SKIPPED', errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE },
        [],
      ),
    ).toBeNull()
  })

  it('keeps a real code but drops a timeout note next to it', () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z')
    expect(
      currentFailureEntry(
        { errorCode: '1', errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE, createdAt },
        [],
      ),
    ).toEqual({ code: '1', at: createdAt, source: 'device', backfilled: true })
  })

  it('labels a server failure without a code', () => {
    expect(
      currentFailureEntry({ errorMessage: 'queue down', failedAt }, []),
    ).toEqual(
      expect.objectContaining({ code: 'UNKNOWN', source: 'server', message: 'queue down' }),
    )
  })
})

describe('inferFailureSource', () => {
  it('tells push, server and phone failures apart', () => {
    expect(inferFailureSource('FCM_TOKEN_NOT_REGISTERED', '', null)).toBe('push')
    expect(inferFailureSource(undefined, 'FCM_SEND_TIMEOUT: slow', new Date())).toBe('push')
    expect(inferFailureSource(undefined, 'boom', new Date())).toBe('server')
    expect(inferFailureSource('2', 'radio off', new Date())).toBe('device')
    expect(inferFailureSource('DISPATCH_FAILED', 'boom', new Date())).toBe('server')
  })
})

describe('isStatusTimeoutNote', () => {
  it('matches only the two notes', () => {
    expect(isStatusTimeoutNote(STATUS_TIMEOUT_DISPATCHED_MESSAGE)).toBe(true)
    expect(isStatusTimeoutNote('Status update timeout')).toBe(false)
    expect(isStatusTimeoutNote(undefined)).toBe(false)
  })
})
