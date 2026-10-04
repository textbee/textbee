import { describe, expect, it } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatLimit,
  formatPrice,
  getBillingInterval,
  titleCaseStatus,
} from './format'

describe('formatLimit', () => {
  it('renders -1 as Unlimited', () => {
    expect(formatLimit(-1)).toBe('Unlimited')
  })
  it('renders null/undefined as 0', () => {
    expect(formatLimit(null)).toBe('0')
    expect(formatLimit(undefined)).toBe('0')
  })
  it('thousands-separates numbers', () => {
    expect(formatLimit(100000)).toBe('100,000')
  })
})

describe('formatPrice', () => {
  it('formats cents into a currency string', () => {
    expect(formatPrice(1900, 'usd')).toBe('$19.00')
  })
  it('returns Free only when there is no amount', () => {
    expect(formatPrice(null, null)).toBe('Free')
  })

  // A real amount with a missing currency used to render as "Free", which put
  // the badge "Free / monthly" in front of paying customers.
  it('falls back to USD rather than claiming a paid plan is free', () => {
    expect(formatPrice(1900, null)).toBe('$19.00')
    expect(formatPrice(1900, '')).toBe('$19.00')
  })
})

describe('getBillingInterval', () => {
  it('maps month to monthly and anything else to yearly', () => {
    expect(getBillingInterval('month')).toBe('monthly')
    expect(getBillingInterval('year')).toBe('yearly')
    expect(getBillingInterval(null)).toBe('')
  })
})

describe('formatDateTime', () => {
  it('shows a short local date and time', () => {
    expect(formatDateTime('2026-10-17T22:15:00.000Z')).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}\s?[AP]M$/
    )
  })
})

describe('formatDate', () => {
  it('returns N/A for empty values', () => {
    expect(formatDate(null)).toBe('N/A')
    expect(formatDate(undefined)).toBe('N/A')
  })
  it('formats an ISO date', () => {
    expect(formatDate('2026-08-01T00:00:00.000Z')).toMatch(/2026/)
  })
})

describe('titleCaseStatus', () => {
  it('title-cases underscore separated statuses', () => {
    expect(titleCaseStatus('past_due')).toBe('Past Due')
    expect(titleCaseStatus('active')).toBe('Active')
    expect(titleCaseStatus(null)).toBe('')
  })
})
