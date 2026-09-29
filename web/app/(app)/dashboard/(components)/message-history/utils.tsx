import { Check, Timer, X } from 'lucide-react'
import type { ReactNode } from 'react'

// Shared helpers for the message-history screen.

export function formatTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export type StatusBadge = {
  color: string
  icon: ReactNode
  label: string
}

export function getStatusBadge(status: string | undefined): StatusBadge {
  const normalizedStatus = status?.toLowerCase() || 'pending'
  switch (normalizedStatus) {
    case 'pending':
      return {
        color: 'border bg-muted/70 text-warning',
        icon: <Timer className='h-3 w-3' />,
        label: 'Pending',
      }
    case 'sent':
      return {
        color: 'border bg-muted/70 text-foreground',
        icon: <Check className='h-3 w-3' />,
        label: 'Sent',
      }
    case 'delivered':
      return {
        color: 'border bg-muted/70 text-success',
        icon: <Check className='h-3 w-3' />,
        label: 'Delivered',
      }
    case 'failed':
      return {
        color: 'border bg-muted/70 text-destructive',
        icon: <X className='h-3 w-3' />,
        label: 'Failed',
      }
    default:
      return {
        color: 'border bg-muted/70 text-muted-foreground',
        icon: <Timer className='h-3 w-3' />,
        label: normalizedStatus,
      }
  }
}
