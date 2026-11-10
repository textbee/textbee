import { isSameDay } from 'date-fns'
import type { ErrorHistoryEntry, SmsMessage } from './types'

// What the details dialog and the list say about a message's failures. The
// top-level error fields describe a failure that is still current;
// issueHistory keeps every failure, including ones the message recovered from.
// The catalog fields (errorName, deviceMessage, docsUrl) are optional: older
// APIs and unknown codes do not send them.

// The API keeps the first 5 and the newest 10
export const ERROR_HISTORY_LIMIT = 15

export type FailureView =
  | {
      kind: 'failed'
      code?: string
      name?: string
      message?: string
      // only when it differs from message
      deviceMessage?: string
      // only http(s) links
      docsUrl?: string
      // where the current failure came from, when the history records it
      source?: ErrorHistoryEntry['source']
      // every other failure, oldest first
      others: ErrorHistoryEntry[]
    }
  // attempts holds failures and delivery reports; failures counts only the first
  | { kind: 'recovered'; attempts: ErrorHistoryEntry[]; failures: number; capped: boolean }
  // sent or delivered, and the only entries are unconfirmed delivery reports
  | { kind: 'delivery-unconfirmed'; attempts: ErrorHistoryEntry[] }
  // the phone reports seen so far, if any, are listed under the note
  | { kind: 'no-report'; attempts: ErrorHistoryEntry[] }

const time = (value: string) => new Date(value).getTime()

function history(message: SmsMessage): ErrorHistoryEntry[] {
  return (message.issueHistory ?? [])
    .filter((entry) => entry && !Number.isNaN(time(entry.at)))
    .sort((a, b) => time(a.at) - time(b.at))
}

const isFailure = (entry: ErrorHistoryEntry) => !entry.deliveryReport

// The entry that is the failure shown in the red box. The API records a
// failure without a code as UNKNOWN, and an old message may have no failedAt.
function currentIndex(message: SmsMessage, entries: ErrorHistoryEntry[]): number {
  const code = message.errorCode?.trim() || 'UNKNOWN'
  if (message.failedAt) {
    const failedAt = time(message.failedAt)
    return entries.findIndex((entry) => isFailure(entry) && time(entry.at) === failedAt)
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isFailure(entries[i]) && entries[i].code === code) return i
  }
  return -1
}

// A docs link from the API opens in a new tab, so only web links pass
export function safeDocsUrl(url?: string): string | undefined {
  if (!url) return undefined
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : undefined
  } catch {
    return undefined
  }
}

// The phone's text is worth showing only when it adds something
function distinct(text: string | undefined, from: string | undefined) {
  const trimmed = text?.trim()
  return trimmed && trimmed !== from?.trim() ? trimmed : undefined
}

export function failureView(message: SmsMessage): FailureView | null {
  const status = message.status?.toLowerCase()

  if (status === 'failed') {
    const entries = history(message)
    const current = currentIndex(message, entries)
    const entry = current >= 0 ? entries[current] : undefined
    return {
      kind: 'failed',
      code: message.errorCode,
      name: message.errorName ?? entry?.name,
      message: message.errorMessage,
      deviceMessage: distinct(
        message.deviceMessage ?? entry?.deviceMessage,
        message.errorMessage
      ),
      docsUrl: safeDocsUrl(message.docsUrl ?? entry?.docsUrl),
      source: entry?.source,
      others: entries.filter((_, i) => i !== current),
    }
  }

  if (status === 'sent' || status === 'delivered') {
    const attempts = history(message)
    if (attempts.length === 0) return null
    const failures = attempts.filter(isFailure).length
    if (failures === 0) return { kind: 'delivery-unconfirmed', attempts }
    return {
      kind: 'recovered',
      attempts,
      failures,
      capped: attempts.length >= ERROR_HISTORY_LIMIT,
    }
  }

  if (status === 'unknown') return { kind: 'no-report', attempts: history(message) }

  return null
}

export function sourceLabel(source: ErrorHistoryEntry['source']): string {
  if (source === 'server') return 'Server'
  if (source === 'push') return 'Push service'
  return 'Phone'
}

// The text up to the end of its first sentence, or all of it if it has none
export function firstSentence(text?: string): string {
  const trimmed = text?.trim() ?? ''
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed)
  return match ? match[0] : trimmed
}

// The phone sent it, but the carrier reported that it could not deliver it
export function isCarrierFailure(code?: string): boolean {
  return !!code?.trim().startsWith('CARRIER_')
}

// One line for the list: why a failed message was not sent
export function failureReason(message: SmsMessage): string | undefined {
  if (message.status?.toLowerCase() !== 'failed') return undefined
  return firstSentence(message.errorMessage) || undefined
}

// Small print for developers and support screenshots, e.g.
// "Phone · code 7 · SHORT_CODE_CANCELLED"
export function errorMeta(parts: {
  source?: ErrorHistoryEntry['source']
  code?: string
  name?: string
  deliveryReport?: boolean
}): string {
  const code = parts.code?.trim()
  const name = parts.name?.trim()
  return [
    parts.deliveryReport ? 'Delivery report' : parts.source && sourceLabel(parts.source),
    code && `code ${code}`,
    name && name !== code && name,
  ]
    .filter(Boolean)
    .join(' · ')
}

// A sent or delivered message that failed first: the list marks it, and its
// tooltip and screen reader text say how often.
export function failedBeforeSent(message: SmsMessage): string | undefined {
  const view = failureView(message)
  if (view?.kind !== 'recovered') return undefined
  if (view.capped) return `Failed ${view.failures} or more times before it was sent`
  if (view.failures === 1) return 'Failed once before it was sent'
  return `Failed ${view.failures} times before it was sent`
}

export function historyHeading(
  kind: FailureView['kind'],
  entries: ErrorHistoryEntry[]
): string {
  if (kind === 'recovered') return 'Attempts before it was sent'
  if (entries.every((entry) => entry.deliveryReport)) return 'Delivery reports'
  const allFailures = entries.every(isFailure)
  if (kind === 'failed') return allFailures ? 'Earlier failures' : 'Earlier failures and reports'
  return allFailures ? 'Failures recorded' : 'Failures and reports'
}

// date-fns pattern for the timeline: the time only, unless the entries (or
// the message itself) fall on more than one day
export function timelinePattern(entries: ErrorHistoryEntry[], reference?: Date | null) {
  const dates = entries.map((entry) => new Date(entry.at))
  if (reference) dates.push(reference)
  const oneDay = dates.every((date) => isSameDay(date, dates[0]))
  return oneDay ? 'h:mm:ss a' : 'MMM d, h:mm:ss a'
}

export type EntryView = {
  meta: string
  // first sentence, shown at all times
  summary: string
  // the full text, when the summary cuts it
  full?: string
  // the phone's original text, when it differs
  deviceText?: string
}

export function entryView(entry: ErrorHistoryEntry): EntryView {
  const message = entry.message?.trim() ?? ''
  const summary =
    firstSentence(message) ||
    (entry.deliveryReport ? 'The carrier did not confirm delivery.' : '')
  return {
    meta: errorMeta(entry),
    summary,
    full: message && message !== summary ? message : undefined,
    deviceText: distinct(entry.deviceMessage, message),
  }
}
