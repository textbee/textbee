'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  DEFAULT_EXTRA_FILTERS,
  isBatchId,
  isDay,
  isStatus,
  statusesFor,
  type ExtraFilters,
} from './extra-filters'

const SEARCH_DEBOUNCE_MS = 300
const PAGE_SIZE = 20
const DIRECTIONS = ['all', 'sent', 'received']

export type HistoryFilters = ExtraFilters & {
  deviceIds: string[]
  direction: string
  search: string
  page: number
}

export const DEFAULT_FILTERS: HistoryFilters = {
  deviceIds: [],
  direction: 'all',
  ...DEFAULT_EXTRA_FILTERS,
  search: '',
  page: 1,
}

// A URL is user input, so every field falls back rather than trusting it.
// Device ids are deliberately not checked against the device list: that list
// loads async, so validating here would drop legitimate ids mid-flight.
export function parseHistoryFilters(params: URLSearchParams): HistoryFilters {
  const direction = params.get('direction') ?? ''
  const page = Number(params.get('page'))
  const status = params.get('status') ?? ''
  let from = params.get('from') ?? ''
  let to = params.get('to') ?? ''
  from = isDay(from) ? from : ''
  to = isDay(to) ? to : ''
  // A reversed range would match nothing, so read it the way it was meant.
  if (from && to && from > to) [from, to] = [to, from]
  const batchId = (params.get('batch') ?? '').trim()
  const safeDirection = DIRECTIONS.includes(direction) ? direction : 'all'

  return {
    deviceIds: Array.from(
      new Set(
        (params.get('devices') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean)
      )
    ),
    direction: safeDirection,
    // A status the direction can never carry would always list nothing.
    status:
      isStatus(status) &&
      statusesFor(safeDirection).some((s) => s.value === status)
        ? status
        : '',
    from,
    to,
    order: params.get('order') === 'asc' ? 'asc' : 'desc',
    batchId: isBatchId(batchId) ? batchId : '',
    search: (params.get('search') ?? '').trim(),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

// Defaults are omitted, so an unfiltered view stays a bare path. Dates are
// calendar days, so a shared link follows the viewer's own time zone.
export function serializeHistoryFilters(filters: HistoryFilters): string {
  const params = new URLSearchParams()
  if (filters.deviceIds.length) params.set('devices', filters.deviceIds.join(','))
  if (filters.direction !== 'all') params.set('direction', filters.direction)
  if (filters.status) params.set('status', filters.status)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.order !== 'desc') params.set('order', filters.order)
  if (filters.batchId) params.set('batch', filters.batchId)
  if (filters.search) params.set('search', filters.search)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params.toString()
}

// Filter state for the message history, mirrored into the URL so a filtered
// view survives a refresh and can be shared.
export function useHistoryFilters() {
  const pathname = usePathname()
  // No Suspense boundary: every (app) route renders dynamically because the
  // layout awaits getServerSession, so this never runs during prerender. If
  // that ever changes, wrap MessageHistory in history/page.tsx.
  const searchParams = useSearchParams()

  // The URL seeds the filters once and is written to from then on. Reading it
  // back every render would let a stale entry clobber an in-flight edit.
  const [filters, setFilters] = useState<HistoryFilters>(() =>
    parseHistoryFilters(new URLSearchParams(searchParams.toString()))
  )

  // Two values: what is typed, and what has been committed to the query.
  // Search is server-side, so it is debounced to avoid a request per keystroke.
  const [searchInput, setSearchInput] = useState(filters.search)

  // Skipped on mount: otherwise a link carrying ?search=x&page=3 loses its page
  // 300ms after load, when the debounce commits and resets it.
  const isFirstRun = useRef(true)
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      return
    }
    const timer = setTimeout(() => {
      const next = searchInput.trim()
      setFilters((f) => (f.search === next ? f : { ...f, search: next, page: 1 }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const query = serializeHistoryFilters(filters)
    const url = query ? `${pathname}?${query}` : pathname
    if (url === window.location.pathname + window.location.search) return
    // replaceState rather than router.replace: these routes are dynamic, so
    // router.replace would refetch the page from the server on every change.
    // Replace rather than push, so Back does not walk through the user's own
    // typing one debounced entry at a time.
    window.history.replaceState(null, '', url)
  }, [filters, pathname])

  const extraFilters: ExtraFilters = {
    status: filters.status,
    from: filters.from,
    to: filters.to,
    order: filters.order,
    batchId: filters.batchId,
  }

  return {
    ...filters,
    extraFilters,
    limit: PAGE_SIZE,
    searchInput,
    setSearchInput,
    clearSearch: () => setSearchInput(''),
    handleDeviceSelectionChange: (deviceIds: string[]) =>
      setFilters((f) => ({ ...f, deviceIds, page: 1 })),
    // A status the new direction can never carry would silently empty the list.
    handleDirectionChange: (direction: string) =>
      setFilters((f) => ({
        ...f,
        direction,
        status: statusesFor(direction).some((s) => s.value === f.status)
          ? f.status
          : '',
        page: 1,
      })),
    handleExtraFiltersChange: (next: Partial<ExtraFilters>) =>
      setFilters((f) => ({ ...f, ...next, page: 1 })),
    // Clears everything that narrows the list except the device selection.
    clearAllFilters: () => {
      setSearchInput('')
      setFilters((f) => ({
        ...f,
        ...DEFAULT_EXTRA_FILTERS,
        direction: 'all',
        search: '',
        page: 1,
      }))
    },
    // Every message of one send, so nothing else may narrow it.
    showBatch: (batchId: string) => {
      setSearchInput('')
      setFilters((f) => ({
        ...f,
        ...DEFAULT_EXTRA_FILTERS,
        batchId,
        direction: 'all',
        search: '',
        page: 1,
      }))
    },
    handlePageChange: (page: number) => setFilters((f) => ({ ...f, page })),
  }
}
