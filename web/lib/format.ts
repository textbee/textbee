import { format } from 'date-fns'

// Shared formatting helpers. These were previously duplicated inline across
// subscription-info, device-list, overview and others.

// A plan limit of -1 means unlimited; null/undefined render as 0.
export function formatLimit(value: number | null | undefined): string {
  if (value === -1) return 'Unlimited'
  if (value == null) return '0'
  return value.toLocaleString()
}

// Amounts come from the backend in minor units (cents). Null amount = Free.
export function formatPrice(
  amount: number | null | undefined,
  currency: string | null | undefined
): string {
  // Only a missing amount means free. A missing currency used to fall through
  // to "Free" as well, so a paying customer whose payload omitted the currency
  // was shown the badge "Free / monthly" on their own billing page.
  if (amount == null) return 'Free'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency?.toUpperCase() || 'USD',
    minimumFractionDigits: 2,
  }).format(amount / 100)
}

export function getBillingInterval(
  interval: string | null | undefined
): string {
  if (!interval) return ''
  return interval.toLowerCase() === 'month' ? 'monthly' : 'yearly'
}

export function formatDate(value: string | number | Date | null | undefined) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// Local date and time, e.g. "Oct 17, 10:15 PM".
export function formatDateTime(value: string | number | Date) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Date and time with the year, e.g. "Oct 17, 2025 10:15 PM"; '' when missing or invalid.
export function formatTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, 'MMM dd, yyyy h:mm a')
}

// "past_due" -> "Past Due"
export function titleCaseStatus(status: string | null | undefined): string {
  if (!status) return ''
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
