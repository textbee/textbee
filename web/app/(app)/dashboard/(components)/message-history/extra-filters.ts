// Filters behind the Filters popover. Values mirror the GET /gateway/messages
// query parameters.

export const STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'sent', label: 'Sent' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
  { value: 'unknown', label: 'Unknown' },
  { value: 'received', label: 'Received' },
] as const

export type Order = 'desc' | 'asc'

export type ExtraFilters = {
  status: string
  // Calendar days (YYYY-MM-DD) in the viewer's time zone, both inclusive.
  from: string
  to: string
  order: Order
  batchId: string
}

export const DEFAULT_EXTRA_FILTERS: ExtraFilters = {
  status: '',
  from: '',
  to: '',
  order: 'desc',
  batchId: '',
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const BATCH_ID_PATTERN = /^[a-f\d]{24}$/i

export const isStatus = (value: string) =>
  STATUSES.some((status) => status.value === value)

export function isDay(value: string) {
  if (!DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  // Years outside this range serialize to ISO forms the API rejects.
  if (year < 1970 || year > 9999) return false
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day
}

export const isBatchId = (value: string) => BATCH_ID_PATTERN.test(value)

// Received messages only ever carry the received status, and sent ones never do.
export function statusesFor(direction: string) {
  if (direction === 'received') {
    return STATUSES.filter((status) => status.value === 'received')
  }
  if (direction === 'sent') {
    return STATUSES.filter((status) => status.value !== 'received')
  }
  return [...STATUSES]
}

export const statusLabel = (value: string) =>
  STATUSES.find((status) => status.value === value)?.label ?? value

// The date range counts as one filter, like it reads in the popover.
export function countExtraFilters(filters: ExtraFilters) {
  return [
    filters.status,
    filters.from || filters.to,
    filters.order !== 'desc',
    filters.batchId,
  ].filter(Boolean).length
}

const localMidnight = (day: string, addDays = 0) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date + addDays).toISOString()
}

// The API bound `to` is exclusive, so the end day becomes the next midnight.
export function toApiRange(from: string, to: string) {
  return {
    from: from ? localMidnight(from) : undefined,
    to: to ? localMidnight(to, 1) : undefined,
  }
}

export function formatDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function rangeLabel(from: string, to: string) {
  if (from && to)
    return from === to
      ? formatDay(from)
      : `${formatDay(from)} to ${formatDay(to)}`
  if (from) return `From ${formatDay(from)}`
  return `Until ${formatDay(to)}`
}
