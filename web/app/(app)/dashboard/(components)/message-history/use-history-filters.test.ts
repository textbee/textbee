import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  parseHistoryFilters,
  serializeHistoryFilters,
  type HistoryFilters,
} from './use-history-filters'

const parse = (query: string) => parseHistoryFilters(new URLSearchParams(query))

describe('parseHistoryFilters', () => {
  it('falls back to the defaults on an empty query', () => {
    expect(parse('')).toEqual(DEFAULT_FILTERS)
  })

  it('reads a full query', () => {
    expect(parse('devices=a,b&direction=received&search=hi&page=3')).toEqual({
      ...DEFAULT_FILTERS,
      deviceIds: ['a', 'b'],
      direction: 'received',
      search: 'hi',
      page: 3,
    })
  })

  it('reads the popover filters', () => {
    const batch = '665f1c2a9b1e4a0012ab34cd'
    expect(
      parse(`status=failed&from=2026-09-01&to=2026-09-25&order=asc&batch=${batch}`)
    ).toMatchObject({
      status: 'failed',
      from: '2026-09-01',
      to: '2026-09-25',
      order: 'asc',
      batchId: batch,
    })
  })

  it('rejects popover values the API would not accept', () => {
    expect(
      parse('status=bogus&from=2026-02-30&to=yesterday&order=up&batch=123')
    ).toEqual(DEFAULT_FILTERS)
  })

  it('drops a status the direction can never carry', () => {
    expect(parse('direction=received&status=failed').status).toBe('')
    expect(parse('direction=sent&status=failed').status).toBe('failed')
  })

  it('swaps a reversed date range', () => {
    expect(parse('from=2026-09-25&to=2026-09-01')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-25',
    })
  })

  it('drops empty entries and duplicates from the device list', () => {
    expect(parse('devices=a,,b,a').deviceIds).toEqual(['a', 'b'])
    expect(parse('devices= a , b ').deviceIds).toEqual(['a', 'b'])
  })

  it('rejects a direction the API does not accept', () => {
    expect(parse('direction=bogus').direction).toBe('all')
    expect(parse('direction=').direction).toBe('all')
  })

  it('rejects a page that is not a positive integer', () => {
    for (const page of ['0', 'abc', '-2', '1.5', '']) {
      expect(parse(`page=${page}`).page).toBe(1)
    }
  })
})

describe('serializeHistoryFilters', () => {
  it('omits every default, so an unfiltered view is a bare path', () => {
    expect(serializeHistoryFilters(DEFAULT_FILTERS)).toBe('')
  })

  it('keeps a stable key order', () => {
    expect(
      serializeHistoryFilters({
        ...DEFAULT_FILTERS,
        deviceIds: ['a'],
        direction: 'sent',
        search: 'x',
        page: 2,
      })
    ).toBe('devices=a&direction=sent&search=x&page=2')
  })

  it('omits only the fields left at their default', () => {
    expect(
      serializeHistoryFilters({ ...DEFAULT_FILTERS, direction: 'sent' })
    ).toBe('direction=sent')
  })

  it('writes the popover filters after direction', () => {
    expect(
      serializeHistoryFilters({
        ...DEFAULT_FILTERS,
        direction: 'sent',
        status: 'failed',
        from: '2026-09-01',
        to: '2026-09-25',
        order: 'asc',
        batchId: '665f1c2a9b1e4a0012ab34cd',
        page: 2,
      })
    ).toBe(
      'direction=sent&status=failed&from=2026-09-01&to=2026-09-25&order=asc&batch=665f1c2a9b1e4a0012ab34cd&page=2'
    )
  })

  it('round trips a search term full of query syntax', () => {
    const filters: HistoryFilters = {
      ...DEFAULT_FILTERS,
      deviceIds: ['a', 'b'],
      direction: 'sent',
      search: 'a & b=c?d',
      page: 4,
    }
    expect(parse(serializeHistoryFilters(filters))).toEqual(filters)
  })
})
