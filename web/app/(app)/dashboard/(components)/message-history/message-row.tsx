'use client'

import { ArrowDownLeft, ArrowUpRight, Smartphone } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import RelativeTime from '@/components/shared/relative-time'
import { cn } from '@/lib/utils'
import { getStatusBadge } from './utils'
import { messageDate, messageDirection } from './group'
import type { Device } from '@/lib/api'
import type { SmsMessage } from './types'

type MessageRowProps = {
  message: SmsMessage
  device?: Device
  // Shown only when the account has more than one device.
  deviceLabel?: string
  onSelect: (message: SmsMessage) => void
}

// One list row rather than one bordered card per message: at 375px the cards
// fitted three or four messages per screen. Rows are buttons so the list is
// keyboard navigable, and stay tall enough to be a comfortable tap target.
export function MessageRow({
  message,
  device,
  deviceLabel,
  onSelect,
}: MessageRowProps) {
  const direction = messageDirection(message)
  const isSent = direction === 'sent'
  const badge = getStatusBadge(message.status)
  const counterparty = isSent
    ? message.recipient || message.recipients?.[0] || 'Unknown'
    : message.sender || 'Unknown'

  // Only devices on app version >= 14 report per-message status, and only for
  // messages created after the rollout date.
  const showStatus =
    isSent &&
    (device?.appVersionCode ?? 0) >= 14 &&
    new Date(message?.createdAt ?? 0) > new Date('2025-06-05')

  return (
    <button
      type='button'
      onClick={() => onSelect(message)}
      className='flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none'
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isSent
            ? 'bg-primary/10 text-primary'
            : 'bg-success/10 text-success'
        )}
        aria-hidden
      >
        {isSent ? (
          <ArrowUpRight className='h-3.5 w-3.5' />
        ) : (
          <ArrowDownLeft className='h-3.5 w-3.5' />
        )}
      </span>

      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline justify-between gap-2'>
          <span className='truncate text-sm font-medium'>
            <span className='sr-only'>{isSent ? 'Sent to' : 'Received from'} </span>
            {counterparty}
          </span>
          <span className='shrink-0 text-xs text-muted-foreground'>
            <RelativeTime value={messageDate(message)} />
          </span>
        </span>

        {/* break-words so a message that is one long URL fills both clamped
            lines instead of being cut off partway through the first. */}
        <span className='mt-0.5 line-clamp-2 block break-words text-sm text-muted-foreground'>
          {message.message}
        </span>

        {(showStatus || deviceLabel) && (
          <span className='mt-1.5 flex min-w-0 items-center gap-2'>
            {showStatus && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  badge.color
                )}
              >
                {badge.icon}
                {badge.label}
              </span>
            )}
            {deviceLabel && (
              <span
                className='inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground'
                title={deviceLabel}
              >
                <Smartphone className='h-3 w-3 shrink-0' aria-hidden />
                <span className='sr-only'>Device: </span>
                <span className='truncate'>{deviceLabel}</span>
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}

export function MessageRowSkeleton() {
  return (
    <div className='flex items-start gap-3 px-3 py-3'>
      <Skeleton className='h-7 w-7 shrink-0 rounded-full' />
      <div className='flex-1 space-y-2'>
        <div className='flex justify-between gap-2'>
          <Skeleton className='h-4 w-32' />
          <Skeleton className='h-3 w-16' />
        </div>
        <Skeleton className='h-3 w-full max-w-sm' />
      </div>
    </div>
  )
}
