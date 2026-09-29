import {
  AlertTriangle,
  Check,
  CircleHelp,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import type { SubscriptionStatus } from '@/lib/api/types'

// Subscription status colors, previously repeated across subscription-info's
// badge, icon and text. Returns semantic tone classes for text + background.
export type StatusTone = {
  text: string
  bg: string
}

export function subscriptionStatusTone(
  status: SubscriptionStatus | null | undefined
): StatusTone {
  switch (status) {
    case 'active':
      return {
        text: 'text-success',
        bg: 'bg-success/10',
      }
    case 'past_due':
      return {
        text: 'text-warning',
        bg: 'bg-warning/10',
      }
    default:
      return {
        text: 'text-muted-foreground',
        bg: 'bg-muted',
      }
  }
}

/**
 * Icon for a subscription status.
 *
 * Picked from the status for the same reason the tone is: the billing card
 * used to hardcode a check mark, so a past_due or canceled subscriber was
 * shown a tick next to the bad news, at exactly the moment they needed a
 * warning instead.
 */
export function subscriptionStatusIcon(
  status: SubscriptionStatus | null | undefined
): LucideIcon {
  switch (status) {
    case 'active':
      return Check
    case 'past_due':
      return AlertTriangle
    case 'canceled':
      return XCircle
    default:
      return CircleHelp
  }
}

// Usage meter color by percentage: green under 80, amber 80-99, red at 100+.
export function usageMeterColor(percentage: number): string {
  if (percentage >= 100) return 'bg-destructive'
  if (percentage >= 80) return 'bg-warning'
  return 'bg-success'
}
