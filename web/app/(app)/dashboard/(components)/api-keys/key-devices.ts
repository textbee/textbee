import { toCompactRelativeLabel } from '@/components/shared/relative-time'

// Shown in the revoke dialog when phones still use the key.
export function keyDevicesWarning(count: number): string {
  return count === 1
    ? '1 device used this key in the last 7 days. It stops working with textbee until you enter a new key in the textbee app on it.'
    : `${count} devices used this key in the last 7 days. They stop working with textbee until you enter a new key in the textbee app on each one.`
}

// "last seen 2h ago", or null for a missing or invalid time.
export function lastSeenLabel(value: string | null | undefined): string | null {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return null
  return `last seen ${toCompactRelativeLabel(date)}`
}
