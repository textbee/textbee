export type BatchMessageCounts = {
  pendingCount: number
  dispatchedCount: number
  sentCount: number
  deliveredCount: number
  failureCount: number
  unknownCount: number
}

export type DerivedBatchStatus =
  | 'processing'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'unknown'

export type BatchSummary = BatchMessageCounts & {
  successCount: number
  total: number
  status: DerivedBatchStatus
}

// Tallies message statuses; anything unrecognized counts as unknown so the
// counters always add up to the number of messages
export function countMessageStatuses(
  rows: Array<{ _id: string | null; n: number }>,
): BatchMessageCounts {
  const counts: BatchMessageCounts = {
    pendingCount: 0,
    dispatchedCount: 0,
    sentCount: 0,
    deliveredCount: 0,
    failureCount: 0,
    unknownCount: 0,
  }
  for (const { _id, n } of rows) {
    switch (String(_id ?? '').toLowerCase()) {
      case 'pending':
        counts.pendingCount += n
        break
      case 'dispatched':
        counts.dispatchedCount += n
        break
      case 'sent':
        counts.sentCount += n
        break
      case 'delivered':
        counts.deliveredCount += n
        break
      case 'failed':
        counts.failureCount += n
        break
      default:
        counts.unknownCount += n
    }
  }
  return counts
}

export function summarizeBatch(counts: BatchMessageCounts): BatchSummary {
  const successCount = counts.sentCount + counts.deliveredCount
  const total =
    counts.pendingCount +
    counts.dispatchedCount +
    successCount +
    counts.failureCount +
    counts.unknownCount

  let status: DerivedBatchStatus
  if (counts.pendingCount + counts.dispatchedCount > 0) {
    status = 'processing'
  } else if (successCount === total) {
    status = 'completed'
  } else if (counts.failureCount === total) {
    status = 'failed'
  } else if (successCount > 0) {
    status = 'partial_success'
  } else {
    status = 'unknown'
  }

  return { ...counts, successCount, total, status }
}

