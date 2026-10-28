import { FCM_SEND_SKIPPED_ERROR_CODE } from './fcm-send-skip'

// The failure trail on a message. Capped, so a flapping device cannot grow the
// document without bound. It outlives the top-level error fields, which only
// describe a failure that is still current.

export type ErrorHistorySource = 'push' | 'device' | 'server'

// The first failures usually name the cause and the newest show where things
// stand, so a long trail keeps both ends and drops the middle
export const ERROR_HISTORY_FIRST = 5
export const ERROR_HISTORY_NEWEST = 10
export const ERROR_HISTORY_LIMIT = ERROR_HISTORY_FIRST + ERROR_HISTORY_NEWEST
const MAX_MESSAGE_LENGTH = 300

export type ErrorHistoryEntry = {
  code: string
  message?: string
  at: Date
  source: ErrorHistorySource
  // rebuilt from the top-level fields of a message older than the trail
  backfilled?: boolean
  // a delivery report that did not confirm delivery: the message was sent,
  // so this is not a send failure and no failure count includes it
  deliveryReport?: boolean
}

// Written by the stale-message task. A missing report, not a failure.
export const STATUS_TIMEOUT_PENDING_MESSAGE =
  'Status update timeout - no response received after 20 minutes'
export const STATUS_TIMEOUT_DISPATCHED_MESSAGE =
  'Status update timeout - no response from device after dispatch'
const STATUS_TIMEOUT_MESSAGES = [
  STATUS_TIMEOUT_PENDING_MESSAGE,
  STATUS_TIMEOUT_DISPATCHED_MESSAGE,
]

export function isStatusTimeoutNote(message: unknown): boolean {
  return typeof message === 'string' && STATUS_TIMEOUT_MESSAGES.includes(message)
}

/** One trimmed entry, or null when there is nothing to record. */
export function errorHistoryEntry(
  {
    code,
    message,
    source,
  }: {
    code?: unknown
    message?: unknown
    source: ErrorHistorySource
  },
  at: Date = new Date(),
): ErrorHistoryEntry | null {
  const entryCode = typeof code === 'string' ? code.trim() : ''
  const entryMessage = typeof message === 'string' ? message.trim() : ''

  if (!entryCode && !entryMessage) return null

  const entry: ErrorHistoryEntry = {
    code: entryCode || 'UNKNOWN',
    at,
    source,
  }
  if (entryMessage) {
    entry.message = entryMessage.slice(0, MAX_MESSAGE_LENGTH)
  }
  return entry
}

/** Oldest first; past the limit, the first few and the newest. */
export function capErrorHistory<T extends { at: Date }>(sorted: T[]): T[] {
  if (sorted.length <= ERROR_HISTORY_LIMIT) return sorted
  return [...sorted.slice(0, ERROR_HISTORY_FIRST), ...sorted.slice(-ERROR_HISTORY_NEWEST)]
}

// The same cap as an aggregation expression over an array of entries
function cappedTrail(input: unknown) {
  return {
    $let: {
      vars: { all: { $sortArray: { input, sortBy: { at: 1 } } } },
      in: {
        $cond: [
          { $lte: [{ $size: '$$all' }, ERROR_HISTORY_LIMIT] },
          '$$all',
          {
            $concatArrays: [
              { $firstN: { n: ERROR_HISTORY_FIRST, input: '$$all' } },
              { $lastN: { n: ERROR_HISTORY_NEWEST, input: '$$all' } },
            ],
          },
        ],
      },
    },
  }
}

/**
 * The pipeline stage that appends entries to the trail and caps it, or null
 * when there is nothing to record. A plain $push can only keep one end, so
 * every history write is a pipeline update.
 */
export function errorHistoryAppendStage(
  entries: ErrorHistoryEntry[],
): { $set: Record<string, unknown> } | null {
  if (entries.length === 0) return null
  // $literal, so a phone-sent message starting with $ is never read as a path
  const append = (field: string) =>
    cappedTrail({
      $concatArrays: [{ $cond: [{ $isArray: field }, field, []] }, { $literal: entries }],
    })
  return {
    $set: {
      issueHistory: append('$issueHistory'),
    },
  }
}

/** A $set stage whose values are taken as they are, never as expressions. */
export function literalSetStage(values: Record<string, unknown>): { $set: Record<string, unknown> } {
  const set: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) set[key] = { $literal: value }
  }
  return { $set: set }
}

export function errorHistoryAppend(
  input: { code?: unknown; message?: unknown; source: ErrorHistorySource },
  at: Date = new Date(),
): { $set: Record<string, unknown> } | null {
  const entry = errorHistoryEntry(input, at)
  return entry ? errorHistoryAppendStage([entry]) : null
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

function toSource(value: unknown): ErrorHistorySource {
  if (value === 'fcm' || value === 'push') return 'push'
  if (value === 'server') return 'server'
  return 'device'
}

export function sameEntry(
  a: Pick<ErrorHistoryEntry, 'code' | 'at'>,
  b: Pick<ErrorHistoryEntry, 'code' | 'at'>,
): boolean {
  return a.code === b.code && a.at.getTime() === b.at.getTime()
}

/**
 * Both trails of a stored message, merged: older entries live only under
 * metadata, newer ones in both places. Oldest first, capped like the trail.
 */
export function storedErrorHistory(doc: {
  issueHistory?: unknown
  metadata?: { errorHistory?: unknown } | null
}): ErrorHistoryEntry[] {
  const raw = [
    ...(Array.isArray(doc?.metadata?.errorHistory) ? doc.metadata.errorHistory : []),
    ...(Array.isArray(doc?.issueHistory) ? doc.issueHistory : []),
  ]
  const merged: ErrorHistoryEntry[] = []
  for (const item of raw) {
    const at = toDate(item?.at)
    if (!at) continue
    const entry: ErrorHistoryEntry = {
      code: item?.code != null && String(item.code).trim() ? String(item.code) : 'UNKNOWN',
      at,
      source: toSource(item?.source),
    }
    if (typeof item?.message === 'string' && item.message) entry.message = item.message
    if (item?.backfilled === true) entry.backfilled = true
    if (item?.deliveryReport === true) entry.deliveryReport = true
    if (!merged.some((existing) => sameEntry(existing, entry))) merged.push(entry)
  }
  merged.sort((a, b) => a.at.getTime() - b.at.getTime())
  return capErrorHistory(merged)
}

// Written by the server when it could not hand a message off
export const DISPATCH_FAILED_ERROR_CODE = 'DISPATCH_FAILED'
const SERVER_FAILURE_CODES = [DISPATCH_FAILED_ERROR_CODE, 'QUEUE_ADD_FAILED']

/** Where a failure stored only in the top-level fields came from. */
export function inferFailureSource(
  code: unknown,
  message: unknown,
  failedAt: unknown,
): ErrorHistorySource {
  const text = typeof code === 'string' ? code.trim() : ''
  if (text.startsWith('FCM_')) return 'push'
  if (SERVER_FAILURE_CODES.includes(text)) return 'server'
  if (typeof message === 'string' && /^FCM_(DELIVERY_FAILED|SEND_TIMEOUT)/.test(message)) {
    return 'push'
  }
  if (!text && failedAt) return 'server'
  return 'device'
}

/**
 * The entry for the failure held in a message's top-level fields, when those
 * fields describe a real failure the trail does not hold yet. The timeout note
 * and the test-skip marker are not failures, so they never become entries.
 */
export function currentFailureEntry(
  doc: {
    errorCode?: unknown
    errorMessage?: unknown
    failedAt?: unknown
    createdAt?: unknown
  },
  history: ErrorHistoryEntry[],
): ErrorHistoryEntry | null {
  const failedAt = toDate(doc.failedAt)
  const code =
    typeof doc.errorCode === 'string' && doc.errorCode !== FCM_SEND_SKIPPED_ERROR_CODE
      ? doc.errorCode.trim()
      : ''
  if (!failedAt && !code) return null

  const message = isStatusTimeoutNote(doc.errorMessage) ? undefined : doc.errorMessage
  const at = failedAt ?? toDate(doc.createdAt) ?? new Date(0)
  const entry = errorHistoryEntry(
    { code: code || 'UNKNOWN', message, source: inferFailureSource(code, message, failedAt) },
    at,
  )
  if (!entry || history.some((existing) => sameEntry(existing, entry))) return null
  entry.backfilled = true
  return entry
}
