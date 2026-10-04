import { countMessageStatuses, summarizeBatch } from './batch-summary'

const counts = (rows: Record<string, number>) =>
  summarizeBatch(
    countMessageStatuses(Object.entries(rows).map(([_id, n]) => ({ _id, n }))),
  )

describe('countMessageStatuses', () => {
  it('maps each message status to its counter', () => {
    expect(
      countMessageStatuses([
        { _id: 'pending', n: 1 },
        { _id: 'dispatched', n: 2 },
        { _id: 'sent', n: 3 },
        { _id: 'delivered', n: 4 },
        { _id: 'failed', n: 5 },
        { _id: 'unknown', n: 6 },
      ]),
    ).toEqual({
      pendingCount: 1,
      dispatchedCount: 2,
      sentCount: 3,
      deliveredCount: 4,
      failureCount: 5,
      unknownCount: 6,
    })
  })

  it('reads legacy uppercase statuses and folds the rest into unknown', () => {
    expect(
      countMessageStatuses([
        { _id: 'PENDING', n: 1 },
        { _id: 'DELIVERED', n: 1 },
        { _id: null, n: 2 },
        { _id: 'received', n: 1 },
      ]),
    ).toEqual(
      expect.objectContaining({ pendingCount: 1, deliveredCount: 1, unknownCount: 3 }),
    )
  })

  it('adds up rows that differ only by case', () => {
    expect(
      countMessageStatuses([
        { _id: 'failed', n: 2 },
        { _id: 'FAILED', n: 3 },
      ]).failureCount,
    ).toBe(5)
  })
})

describe('summarizeBatch', () => {
  it.each([
    [{ pending: 1, delivered: 3 }, 'processing'],
    [{ dispatched: 1, failed: 3 }, 'processing'],
    [{ sent: 2, delivered: 3 }, 'completed'],
    [{ failed: 4 }, 'failed'],
    [{ sent: 1, failed: 1 }, 'partial_success'],
    [{ delivered: 1, unknown: 1 }, 'partial_success'],
    [{ unknown: 3 }, 'unknown'],
    [{ failed: 1, unknown: 1 }, 'unknown'],
  ])('%j is %s', (rows, status) => {
    expect(counts(rows).status).toBe(status)
  })

  it('counts sent and delivered as success and keeps the parts', () => {
    const summary = counts({ sent: 2, delivered: 3, failed: 1, unknown: 4 })
    expect(summary).toEqual(
      expect.objectContaining({
        successCount: 5,
        sentCount: 2,
        deliveredCount: 3,
        failureCount: 1,
        unknownCount: 4,
        total: 10,
      }),
    )
  })
})
