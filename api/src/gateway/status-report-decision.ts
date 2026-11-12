import { FCM_SEND_SKIPPED_ERROR_CODE } from './fcm-send-skip'
import {
  ErrorHistoryEntry,
  ErrorHistorySource,
  currentFailureEntry,
  errorHistoryEntry,
  inferFailureSource,
  storedErrorHistory,
} from './error-history'

// What one phone report does to a message. The phone uploads each status as
// its own job, in any order and with retries, and a multipart message reports
// once per part, so arrival order means nothing. Two phone times share one
// clock and can be compared; a push or server failure never beats the phone.

export const REPORTED_STATUSES = [
  'sent',
  'delivered',
  'failed',
  'delivery_failed',
] as const
export type ReportedStatus = (typeof REPORTED_STATUSES)[number]

export type StatusReport = {
  status: ReportedStatus
  // the phone time of this event, when it sent a plausible one
  at?: Date
  code?: string
  message?: string
  // parts the phone split the text into; only builds that report per part
  partCount?: number
  // a delivery report in which the carrier is still trying
  stillTrying?: boolean
}

export type DecisionRules = {
  // a failed part fails a long message for good
  multipartFailureFinal?: boolean
}

export type StoredMessage = {
  status?: string | null
  type?: string | null
  sentAt?: Date | null
  deliveredAt?: Date | null
  failedAt?: Date | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt?: Date | null
  issueHistory?: unknown
  metadata?: { errorHistory?: unknown; failureTimeFromServer?: unknown } | null
}

export type StatusDecision =
  // nothing to write
  | { kind: 'noop' }
  // only the trail grows; status and fields stay
  | { kind: 'history'; entries: ErrorHistoryEntry[] }
  | {
      kind: 'apply'
      // lowercase status after the report
      status: string
      // the stored value differs from status, even if only in case
      writeStatus: boolean
      // the status really moved, so the webhook and batch refresh run
      statusChanged: boolean
      set: Record<string, unknown>
      unset: string[]
      entries: ErrorHistoryEntry[]
    }

export function isReportedStatus(value: unknown): value is ReportedStatus {
  return (
    typeof value === 'string' &&
    (REPORTED_STATUSES as readonly string[]).includes(value)
  )
}

function before(a: Date | undefined | null, b: Date | undefined | null): boolean {
  return !!a && !!b && a.getTime() < b.getTime()
}

// The source of the failure the top-level fields hold. Also used to read the
// error catalog, so a numeric code is read as a phone code only from the phone.
export function currentFailureSource(
  stored: StoredMessage,
  history: ErrorHistoryEntry[],
): ErrorHistorySource {
  const failedAt = stored.failedAt?.getTime()
  const match = history.find(
    (entry) => !entry.deliveryReport && entry.at.getTime() === failedAt,
  )
  return match
    ? match.source
    : inferFailureSource(stored.errorCode, stored.errorMessage, stored.failedAt)
}

// Only a phone failure with its own phone time can be compared with another
// phone time; one stamped with server time loses to the phone like a push one
function failureHasPhoneTime(stored: StoredMessage, history: ErrorHistoryEntry[]) {
  return (
    currentFailureSource(stored, history) === 'device' &&
    stored.metadata?.failureTimeFromServer !== true
  )
}

function isDuplicate(
  entry: ErrorHistoryEntry,
  history: ErrorHistoryEntry[],
  timeReported: boolean,
): boolean {
  if (timeReported) {
    return history.some(
      (existing) =>
        existing.source === entry.source &&
        existing.code === entry.code &&
        existing.at.getTime() === entry.at.getTime(),
    )
  }
  // Without a phone time a retry gets a new server time, so only the latest
  // entry can tell it apart
  const last = history[history.length - 1]
  return (
    !!last &&
    last.source === entry.source &&
    last.code === entry.code &&
    last.message === entry.message
  )
}

/** The trail entry a failure report adds, or null for a success report. */
export function statusReportEntry(
  report: StatusReport,
  now: Date = new Date(),
): ErrorHistoryEntry | null {
  if (report.status !== 'failed' && report.status !== 'delivery_failed') return null
  const entry = errorHistoryEntry(
    {
      code: report.code || 'UNKNOWN',
      message:
        report.status === 'failed' ? report.message || 'Unknown error' : report.message,
      source: 'device',
    },
    report.at ?? now,
  )
  if (entry && report.status === 'delivery_failed') entry.deliveryReport = true
  return entry
}

export function decideStatusReport(
  stored: StoredMessage,
  report: StatusReport,
  now: Date = new Date(),
  { multipartFailureFinal = true }: DecisionRules = {},
): StatusDecision {
  const storedStatus = String(stored.status ?? '').toLowerCase()
  // Incoming messages have no send to report on
  if (storedStatus === 'received' || stored.type === 'RECEIVED') {
    return { kind: 'noop' }
  }

  const history = storedErrorHistory(stored)
  // A failed part of a long message fails the whole message
  const multipart = multipartFailureFinal && (report.partCount ?? 0) > 1
  const set: Record<string, unknown> = {}
  const unset: string[] = []
  const entries: ErrorHistoryEntry[] = []

  // Fields that describe the current failure go; the failure stays in the trail
  const clearCurrentFailure = () => {
    const legacy = currentFailureEntry(stored, history)
    if (legacy) entries.push(legacy)
    if (stored.errorMessage != null) unset.push('errorMessage')
    if (stored.failedAt != null) unset.push('failedAt')
    if (stored.errorCode != null && stored.errorCode !== FCM_SEND_SKIPPED_ERROR_CODE) {
      unset.push('errorCode')
    }
    if (stored.metadata?.failureTimeFromServer != null) {
      unset.push('metadata.failureTimeFromServer')
    }
  }

  const apply = (status: string): StatusDecision => {
    const statusChanged = status !== storedStatus
    const writeStatus = stored.status !== status
    if (
      !writeStatus &&
      Object.keys(set).length === 0 &&
      unset.length === 0 &&
      entries.length === 0
    ) {
      return { kind: 'noop' }
    }
    return {
      kind: 'apply' as const,
      status,
      writeStatus,
      statusChanged,
      set,
      unset,
      entries,
    }
  }

  // The carrier still tries: proof of a send, never of a delivery
  if (report.stillTrying) {
    if (!['pending', 'dispatched', 'unknown'].includes(storedStatus)) {
      return { kind: 'noop' }
    }
    clearCurrentFailure()
    return apply('sent')
  }

  if (report.status === 'sent' || report.status === 'delivered') {
    const field = report.status === 'sent' ? 'sentAt' : 'deliveredAt'
    // A message the carrier already confirmed never goes back to sent
    const reached = report.status === 'sent' && stored.deliveredAt ? 'delivered' : report.status
    const fill = () => {
      if (report.at && stored[field] == null) set[field] = report.at
    }

    if (storedStatus === 'failed') {
      // Another part of a long message failed on the phone or at the carrier
      if (multipart && currentFailureSource(stored, history) === 'device') {
        fill()
        return apply('failed')
      }
      // A part that went out before another part failed, on the same clock
      if (failureHasPhoneTime(stored, history) && before(report.at, stored.failedAt)) {
        fill()
        return apply('failed')
      }
      if (report.at) set[field] = report.at
      clearCurrentFailure()
      return apply(reached)
    }

    // Delivered is as far as a message goes, and a repeat of the same status
    // only fills a missing time
    if (
      storedStatus === 'delivered' ||
      (storedStatus === 'sent' && report.status === 'sent')
    ) {
      fill()
      clearCurrentFailure()
      return apply(storedStatus)
    }

    if (report.at) set[field] = report.at
    clearCurrentFailure()
    return apply(reached)
  }

  // A failure report always carries a code, UNKNOWN at worst
  const entry = statusReportEntry(report, now)!
  if (isDuplicate(entry, history, !!report.at)) return { kind: 'noop' }

  // Any other delivery report that did not confirm delivery never moves the
  // status
  if (report.status === 'delivery_failed') {
    return { kind: 'history', entries: [entry] }
  }

  const setFailure = () => {
    const legacy = currentFailureEntry(stored, history)
    if (legacy && !(legacy.code === entry.code && legacy.at.getTime() === entry.at.getTime())) {
      entries.push(legacy)
    }
    entries.push(entry)
    set.failedAt = entry.at
    if (report.at) {
      if (stored.metadata?.failureTimeFromServer != null) {
        unset.push('metadata.failureTimeFromServer')
      }
    } else {
      set['metadata.failureTimeFromServer'] = true
    }
    set.errorMessage = report.message || 'Unknown error'
    const code = report.code?.trim()
    if (code) set.errorCode = code
    else if (stored.errorCode != null) unset.push('errorCode')
  }

  if (storedStatus === 'failed') {
    // A newer phone failure replaces the current one; an older one is history
    const replace =
      !stored.failedAt ||
      !failureHasPhoneTime(stored, history) ||
      !report.at ||
      !before(entry.at, stored.failedAt)
    if (!replace) return { kind: 'history', entries: [entry] }
    setFailure()
    return apply('failed')
  }

  // A part that failed fails a long message, whatever another part reported
  if (!multipart && (storedStatus === 'sent' || storedStatus === 'delivered')) {
    const reached = storedStatus === 'sent' ? stored.sentAt : stored.deliveredAt
    // The failure happened before the phone reported this status
    if (before(report.at, reached)) {
      return { kind: 'history', entries: [entry] }
    }
  }

  setFailure()
  return apply('failed')
}
