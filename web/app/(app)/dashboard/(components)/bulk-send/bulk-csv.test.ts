import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import {
  buildRecipientPlan,
  detectRecipientColumn,
  extractTemplateVariables,
  findUnknownVariables,
  formatFileSize,
  formatSendDuration,
  isPlausiblePhone,
  normalizePhone,
  renderTemplate,
} from './bulk-csv'

describe('detectRecipientColumn', () => {
  it('finds the obvious column', () => {
    expect(detectRecipientColumn(['name', 'phone', 'code'])).toBe('phone')
  })

  it('is case and separator insensitive', () => {
    expect(detectRecipientColumn(['Name', 'Phone Number'])).toBe('Phone Number')
    expect(detectRecipientColumn(['name', 'MSISDN'])).toBe('MSISDN')
  })

  it('prefers an exact match over a partial one', () => {
    expect(detectRecipientColumn(['phone_type', 'phone'])).toBe('phone')
  })

  it('falls back to a partial match', () => {
    expect(detectRecipientColumn(['customer_mobile_no'])).toBe(
      'customer_mobile_no'
    )
  })

  it('returns undefined when nothing looks like a phone column', () => {
    expect(detectRecipientColumn(['name', 'city', 'total'])).toBeUndefined()
  })

  it('does not let short hints claim unrelated columns', () => {
    // "to" must not match "total", "tel" must not match "hotel".
    expect(detectRecipientColumn(['total', 'hotel', 'country'])).toBeUndefined()
    // But an exact "to" column is still a valid recipient column.
    expect(detectRecipientColumn(['to', 'body'])).toBe('to')
  })
})

describe('normalizePhone', () => {
  it('strips formatting but keeps a leading plus', () => {
    expect(normalizePhone('+1 (415) 555-0101')).toBe('+14155550101')
    expect(normalizePhone(' 415.555.0101 ')).toBe('4155550101')
  })
})

describe('isPlausiblePhone', () => {
  it('accepts common formats', () => {
    expect(isPlausiblePhone('+14155550101')).toBe(true)
    expect(isPlausiblePhone('+1 (415) 555-0101')).toBe(true)
    expect(isPlausiblePhone('0911000001')).toBe(true)
  })

  it('rejects text, empties and impossible lengths', () => {
    expect(isPlausiblePhone('not a number')).toBe(false)
    expect(isPlausiblePhone('')).toBe(false)
    expect(isPlausiblePhone('12345')).toBe(false)
    expect(isPlausiblePhone('1234567890123456789')).toBe(false)
  })
})

describe('buildRecipientPlan', () => {
  const rows = [
    { name: 'Alice', phone: '+14155550101' },
    { name: 'Blank', phone: '' },
    { name: 'Bob', phone: '+16475550187' },
    { name: 'Junk', phone: 'call me' },
    // Same number as Alice in a different format.
    { name: 'Alice again', phone: '+1 (415) 555-0101' },
  ]

  it('keeps only rows that can actually receive a message', () => {
    const plan = buildRecipientPlan(rows, 'phone')

    expect(plan.valid.map((r) => r.raw)).toEqual([
      '+14155550101',
      '+16475550187',
    ])
    expect(plan.counts).toEqual({
      total: 5,
      valid: 2,
      empty: 1,
      invalid: 1,
      duplicate: 1,
    })
  })

  it('explains every exclusion against the user spreadsheet row number', () => {
    const plan = buildRecipientPlan(rows, 'phone')

    // Header is row 1, so the blank row is row 3 in the file.
    expect(plan.excluded).toEqual([
      { rowNumber: 3, raw: '', reason: 'empty' },
      { rowNumber: 5, raw: 'call me', reason: 'invalid' },
      { rowNumber: 6, raw: '+1 (415) 555-0101', reason: 'duplicate' },
    ])
  })

  it('detects duplicates across differing formats', () => {
    const plan = buildRecipientPlan(
      [{ phone: '4155550101' }, { phone: '415-555-0101' }],
      'phone'
    )
    expect(plan.counts.valid).toBe(1)
    expect(plan.counts.duplicate).toBe(1)
  })

  it('carries the full row so templates can use other columns', () => {
    const plan = buildRecipientPlan(rows, 'phone')
    expect(plan.valid[0].data.name).toBe('Alice')
  })
})

describe('templates', () => {
  it('extracts variables regardless of spacing', () => {
    expect(
      extractTemplateVariables('Hi {{name}}, order {{ order_id }} confirmed')
    ).toEqual(['name', 'order_id'])
  })

  it('deduplicates repeated variables', () => {
    expect(extractTemplateVariables('{{ a }} and {{a}}')).toEqual(['a'])
  })

  it('flags variables the CSV cannot fill', () => {
    expect(
      findUnknownVariables('Hi {{ name }}, {{ nickname }}', ['name', 'phone'])
    ).toEqual(['nickname'])
  })

  it('renders a row', () => {
    expect(
      renderTemplate('Hi {{ name }}, your order {{ order_id }} is confirmed.', {
        name: 'Alice',
        order_id: 'ORD-1042',
      })
    ).toBe('Hi Alice, your order ORD-1042 is confirmed.')
  })

  it('renders unknown or missing placeholders as empty', () => {
    expect(renderTemplate('Hi {{ nickname }}!', { name: 'Alice' })).toBe('Hi !')
  })
})

describe('formatFileSize', () => {
  it('never shows raw bytes for large sizes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
    expect(formatFileSize(512 * 1024)).toBe('512 KB')
    expect(formatFileSize(900)).toBe('900 B')
  })
})

// The upload step reads its column list straight from papaparse. These pin the
// specific parser behaviour that made reading keys off the first data row
// wrong, so a future refactor back to Object.keys(data[0]) fails here.
describe('csv column extraction', () => {
  const csv = 'name,phone,city\nAlice\nBob,+14155550101,Denver'

  it('meta.fields keeps every header even when the first row is short', () => {
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    })

    expect(parsed.meta.fields).toEqual(['name', 'phone', 'city'])
  })

  it('the first data row does not list every header', () => {
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    })

    // This is the bug: papaparse only assigns keys for values present in the
    // row, so a short first row silently hides real columns from the mapping
    // dropdown and the phone column becomes unselectable.
    expect(Object.keys(parsed.data[0])).toEqual(['name'])
    expect(Object.keys(parsed.data[0])).not.toContain('phone')
  })

  it('still detects the phone column from the full header list', () => {
    const parsed = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    })

    expect(detectRecipientColumn(parsed.meta.fields ?? [])).toBe('phone')
    // Whereas the short first row offers nothing to detect.
    expect(detectRecipientColumn(Object.keys(parsed.data[0]))).toBeUndefined()
  })
})

describe('formatSendDuration', () => {
  // The phone paces sends, so the review step quotes the batch in time. These
  // are the boundaries where the unit changes.
  it('reports sub-minute sends without a number', () => {
    expect(formatSendDuration(20_000)).toBe('under a minute')
    // Just under the boundary. Rounding before comparing called this 1 minute.
    expect(formatSendDuration(59_999)).toBe('under a minute')
  })

  it('reports minutes up to the 90 minute boundary', () => {
    expect(formatSendDuration(60_000)).toBe('about 1 minute')
    expect(formatSendDuration(5 * 60_000)).toBe('about 5 minutes')
    expect(formatSendDuration(89 * 60_000)).toBe('about 89 minutes')
  })

  it('switches to hours past 90 minutes', () => {
    // Just under the boundary, so still minutes.
    expect(formatSendDuration(89 * 60_000 + 59_999)).toBe('about 90 minutes')
    expect(formatSendDuration(90 * 60_000)).toBe('about 1.5 hours')
    // 2500 recipients at the default 5 second pacing, the case this exists for
    expect(formatSendDuration(2_500 * 5 * 1000)).toBe('about 3.5 hours')
  })

  it('switches to days past 24 hours', () => {
    expect(formatSendDuration(30 * 3_600_000)).toBe('about 1.3 days')
  })
})
