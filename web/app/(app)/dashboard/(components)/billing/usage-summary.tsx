'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays, Clock, Infinity as InfinityIcon } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { useSubscription } from '@/lib/api'
import { deriveUsage, type UsageWindow } from '@/lib/usage'
import { cn } from '@/lib/utils'

// The question a dashboard should answer first is "how much of my quota is
// left", which the all-time counters could never answer. Every value here
// comes from the subscription response; nothing is estimated.
// Tiles render straight into the overview grid, beside the all-time totals.
const tileClass = 'col-span-2 bg-card px-4 py-3.5 lg:col-start-1'

function UsageTile({
  title,
  window: usageWindow,
  icon: Icon,
  isLoading,
}: {
  title: string
  window: UsageWindow
  icon: typeof Clock
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className={cn(tileClass, 'space-y-2.5')}>
        <Skeleton className='h-4 w-24' />
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-1.5 w-full' />
      </div>
    )
  }

  const { used, limit, remaining, percentage, unlimited, nearLimit, atLimit } =
    usageWindow

  return (
    <div className={tileClass}>
      <div className='flex items-center justify-between gap-3'>
        <p className='label-mono truncate'>{title}</p>
        <Icon className='h-4 w-4 shrink-0 text-muted-foreground' />
      </div>

      {unlimited ? (
        <>
          <div className='mt-2 flex items-baseline gap-2'>
            <span className='num text-2xl font-semibold leading-none tracking-tight'>
              {used.toLocaleString()}
            </span>
            <span className='text-sm text-muted-foreground'>
              message{used === 1 ? '' : 's'}
            </span>
          </div>
          <p className='mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
            <InfinityIcon className='h-3.5 w-3.5' />
            Unlimited on your plan
          </p>
        </>
      ) : (
        <>
          <div className='mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
            <div className='flex items-baseline gap-1.5'>
              <span className='num text-2xl font-semibold leading-none tracking-tight'>
                {used.toLocaleString()}
              </span>
              <span className='text-sm text-muted-foreground'>
                / {limit?.toLocaleString() ?? '-'}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <p
                className={cn(
                  'text-xs',
                  atLimit
                    ? 'font-medium text-destructive'
                    : nearLimit
                      ? 'font-medium text-warning'
                      : 'text-muted-foreground'
                )}
              >
                {atLimit
                  ? 'Limit reached'
                  : `${remaining.toLocaleString()} remaining`}
              </p>
              {(nearLimit || atLimit) && (
                <Link
                  href='/dashboard/account/billing'
                  className='inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline'
                >
                  Upgrade
                  <ArrowRight className='h-3 w-3' />
                </Link>
              )}
            </div>
          </div>

          <div
            className='mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted'
            role='progressbar'
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${title} usage`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-300',
                atLimit
                  ? 'bg-destructive'
                  : nearLimit
                    ? 'bg-warning'
                    : 'bg-primary'
              )}
              style={{ width: `${percentage}%` }}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default function UsageSummary() {
  const { data: subscription, isPending } = useSubscription()
  const { daily, monthly } = deriveUsage(subscription)

  return (
    <>
      <UsageTile
        title='Today'
        window={daily}
        icon={Clock}
        isLoading={isPending}
      />
      {/* "Last 30 days", not "This month": the backend counts from
          setMonth(-1), a rolling window, not the calendar month. */}
      <UsageTile
        title='Last 30 days'
        window={monthly}
        icon={CalendarDays}
        isLoading={isPending}
      />
    </>
  )
}
