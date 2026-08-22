// Pure CSV / template logic for bulk send. No React and no network, so the
// rules that decide who actually receives a message are directly testable.

import { isPlausiblePhone, normalizePhone } from '@/lib/sms'

export type CsvRow = Record<string, string>

export type RecipientRow = {
  // 1-based row number as it appears in the user's file, so problems can be
  // reported in terms of their spreadsheet.
  rowNumber: number
  raw: string
  normalized: string
  data: CsvRow
}

export type ExclusionReason = 'empty' | 'invalid' | 'duplicate'

export type ExcludedRow = {
  rowNumber: number
  raw: string
  reason: ExclusionReason
}

export type RecipientPlan = {
  valid: RecipientRow[]
  excluded: ExcludedRow[]
  counts: {
    total: number
    valid: number
    empty: number
    invalid: number
    duplicate: number
  }
}

// Column names people actually use for a phone number, most specific first.
const RECIPIENT_COLUMN_HINTS = [
  'phone',
  'phone_number',
  'phonenumber',
  'mobile',
  'msisdn',
  'recipient',
  'number',
  'cell',
  'cellphone',
  'contact',
  'telephone',
  'to',
  'tel',
]

// Short hints are matched exactly only. Substring-matching "to" would claim a
// "total" column, and "tel" would claim "hotel", silently texting the wrong
// data.
const EXACT_ONLY_HINTS = new Set(['to', 'tel', 'cell'])

/**
 * Guess which column holds the phone number.
 *
 * Exact matches win over partial ones so a file with both "phone" and
 * "phone_type" picks "phone".
 */
export function detectRecipientColumn(columns: string[]): string | undefined {
  const normalized = columns.map((c) => ({
    original: c,
    key: c.trim().toLowerCase().replace(/[\s-]+/g, '_'),
  }))

  for (const hint of RECIPIENT_COLUMN_HINTS) {
    const exact = normalized.find((c) => c.key === hint)
    if (exact) return exact.original
  }

  for (const hint of RECIPIENT_COLUMN_HINTS) {
    if (EXACT_ONLY_HINTS.has(hint)) continue
    const partial = normalized.find((c) => c.key.includes(hint))
    if (partial) return partial.original
  }

  return undefined
}

/**
 * Decide who actually receives a message.
 *
 * The previous implementation mapped every parsed row straight into the
 * payload, so blank cells produced messages addressed to "" and duplicated
 * rows were texted twice.
 */
export function buildRecipientPlan(
  rows: CsvRow[],
  column: string
): RecipientPlan {
  const valid: RecipientRow[] = []
  const excluded: ExcludedRow[] = []
  const seen = new Set<string>()

  rows.forEach((row, index) => {
    // +2: one for the header row, one for 1-based counting, so the number
    // matches what the user sees in their spreadsheet.
    const rowNumber = index + 2
    const raw = (row[column] ?? '').trim()

    if (!raw) {
      excluded.push({ rowNumber, raw, reason: 'empty' })
      return
    }

    if (!isPlausiblePhone(raw)) {
      excluded.push({ rowNumber, raw, reason: 'invalid' })
      return
    }

    const normalized = normalizePhone(raw)
    if (seen.has(normalized)) {
      excluded.push({ rowNumber, raw, reason: 'duplicate' })
      return
    }

    seen.add(normalized)
    valid.push({ rowNumber, raw, normalized, data: row })
  })

  return {
    valid,
    excluded,
    counts: {
      total: rows.length,
      valid: valid.length,
      empty: excluded.filter((e) => e.reason === 'empty').length,
      invalid: excluded.filter((e) => e.reason === 'invalid').length,
      duplicate: excluded.filter((e) => e.reason === 'duplicate').length,
    },
  }
}

/** Column placeholders present in a template, in order of first appearance. */
export function extractTemplateVariables(template: string): string[] {
  // Collected with exec rather than matchAll: the project targets ES5, where
  // iterating a RegExp iterator needs downlevelIteration.
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g
  const found: string[] = []
  let match: RegExpExecArray | null

  while ((match = pattern.exec(template)) !== null) {
    const name = match[1].trim()
    if (found.indexOf(name) === -1) found.push(name)
  }

  return found
}

/** Variables the template references that the CSV does not provide. */
export function findUnknownVariables(
  template: string,
  columns: string[]
): string[] {
  return extractTemplateVariables(template).filter((v) => !columns.includes(v))
}

/**
 * Fill a template for one row. Unknown or empty placeholders collapse to an
 * empty string, matching the previous behaviour, but callers can surface them
 * up front with findUnknownVariables.
 */
export function renderTemplate(template: string, row: CsvRow): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => {
    return row[String(key).trim()] ?? ''
  })
}

/** Human-readable file size, so limits are not shown in raw bytes. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

/** Rough send duration, so a large batch states its cost in time up front. */
export function formatSendDuration(ms: number): string {
  // Boundaries compare raw ms. Rounding first would report 59.9 seconds as
  // "about 1 minute" and 89.9 minutes as hours, each below its stated bound.
  if (ms < 60_000) return 'under a minute'
  const minutes = Math.round(ms / 60_000)
  if (ms < 90 * 60_000) {
    return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  const hours = ms / 3_600_000
  if (hours < 24) return `about ${hours.toFixed(1)} hours`
  const days = hours / 24
  return `about ${days.toFixed(1)} days`
}

export { isPlausiblePhone, normalizePhone }
