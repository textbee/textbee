'use client'

import {
  format,
  formatDistanceStrict,
  formatDistanceToNowStrict,
  isValid,
} from 'date-fns'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Anything under this reads as "Just now" rather than "34 seconds ago".
const JUST_NOW_MS = 60 * 1000

export function toRelativeLabel(date: Date, now: Date = new Date()): string {
  if (now.getTime() - date.getTime() < JUST_NOW_MS) return 'Just now'
  // Strict, so it says "3 minutes ago" instead of "about 3 minutes ago".
  return formatDistanceToNowStrict(date, { addSuffix: true })
}

const COMPACT_UNITS: Record<string, string> = {
  second: 's',
  minute: 'm',
  hour: 'h',
  day: 'd',
  month: 'mo',
  year: 'y',
}

// "9h ago" for tight rows where "9 hours ago" would wrap.
export function toCompactRelativeLabel(date: Date, now: Date = new Date()): string {
  if (now.getTime() - date.getTime() < JUST_NOW_MS) return 'just now'
  return formatDistanceStrict(date, now, { addSuffix: true }).replace(
    /(\d+) (second|minute|hour|day|month|year)s?/,
    (_, count: string, unit: string) => `${count}${COMPACT_UNITS[unit]}`
  )
}

export function toExactLabel(date: Date): string {
  return format(date, "MMM d, yyyy 'at' h:mm a")
}

/**
 * A timestamp shown as "7 days ago", with the exact date and time on hover.
 *
 * Long absolute timestamps ("May 18, 2023, 1:42 PM") wrapped and dominated the
 * device and API key cards at mobile widths. Formatting is delegated to
 * date-fns; the only local rule is the "Just now" threshold.
 */
export default function RelativeTime({
  value,
  fallback = '-',
  compact = false,
  className,
}: {
  value: string | number | Date | null | undefined
  fallback?: string
  // Short label ("9h ago") without the dotted underline.
  compact?: boolean
  className?: string
}) {
  if (value === null || value === undefined || value === '') {
    return <span className={className}>{fallback}</span>
  }

  const date = value instanceof Date ? value : new Date(value)
  if (!isValid(date)) {
    return <span className={className}>{fallback}</span>
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A real <time> keeps the machine-readable value in the DOM, and
              tabIndex means keyboard users can reach the exact timestamp too. */}
          <time
            dateTime={date.toISOString()}
            tabIndex={0}
            className={cn(
              'cursor-default',
              !compact && 'underline decoration-dotted underline-offset-2',
              className
            )}
          >
            {compact ? toCompactRelativeLabel(date) : toRelativeLabel(date)}
          </time>
        </TooltipTrigger>
        <TooltipContent>{toExactLabel(date)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
