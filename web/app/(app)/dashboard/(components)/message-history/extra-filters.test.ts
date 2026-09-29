import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTRA_FILTERS,
  countExtraFilters,
  isDay,
  rangeLabel,
  statusesFor,
  toApiRange,
} from './extra-filters'

describe('extra filters', () => {
  it('counts the date range as one filter', () => {
    expect(countExtraFilters(DEFAULT_EXTRA_FILTERS)).toBe(0)
    expect(
      countExtraFilters({
        ...DEFAULT_EXTRA_FILTERS,
        status: 'failed',
        from: '2026-09-01',
        to: '2026-09-25',
      })
    ).toBe(2)
    expect(countExtraFilters({ ...DEFAULT_EXTRA_FILTERS, order: 'asc' })).toBe(
      1
    )
  })

  it('offers only the statuses a direction can carry', () => {
    expect(statusesFor('received').map((s) => s.value)).toEqual(['received'])
    expect(statusesFor('sent').map((s) => s.value)).not.toContain('received')
    expect(statusesFor('all')).toHaveLength(7)
  })

  it('sends local midnights, with the end day made exclusive', () => {
    const range = toApiRange('2026-09-01', '2026-09-25')
    expect(range.from).toBe(new Date(2026, 8, 1).toISOString())
    expect(range.to).toBe(new Date(2026, 8, 26).toISOString())
    expect(toApiRange('', '')).toEqual({ from: undefined, to: undefined })
  })

  it('rejects impossible calendar days', () => {
    expect(isDay('2026-09-25')).toBe(true)
    expect(isDay('2026-02-30')).toBe(false)
    expect(isDay('2026-9-5')).toBe(false)
    expect(isDay('0026-09-25')).toBe(false)
    expect(isDay('10000-09-25')).toBe(false)
  })

  it('labels open and closed ranges', () => {
    expect(rangeLabel('2026-09-01', '2026-09-25')).toBe(
      'Sep 1, 2026 to Sep 25, 2026'
    )
    expect(rangeLabel('2026-09-01', '2026-09-01')).toBe('Sep 1, 2026')
    expect(rangeLabel('2026-09-01', '')).toBe('From Sep 1, 2026')
    expect(rangeLabel('', '2026-09-25')).toBe('Until Sep 25, 2026')
  })
})
