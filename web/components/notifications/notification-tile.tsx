'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lock,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  NotificationAction,
  NotificationTone,
  ServedNotification,
} from '@/lib/api'

// Presentational. Everything it shows was decided server side, so it holds no
// targeting logic and takes no data of its own. The markup is deliberately
// plain semantic utilities: this same shape is rendered elsewhere on an older
// Tailwind, and utilities like bg-linear-to-r would not survive the trip.

const isExternal = (href: string) => /^https?:\/\//i.test(href)

/** At most two buttons fit beside the close control at 375px. */
const MAX_ACTIONS = 2

// Icon and left rule per tone, matching what the built-in alerts used. info has
// no hue of its own, so it reads neutral and is told apart by its surface.
const TONE: Record<
  NotificationTone,
  { Icon: typeof Info; icon: string; rule: string }
> = {
  info: { Icon: Info, icon: 'text-foreground', rule: 'border-l-foreground/50' },
  success: {
    Icon: CheckCircle2,
    icon: 'text-success',
    rule: 'border-l-success',
  },
  warning: {
    Icon: AlertTriangle,
    icon: 'text-warning',
    rule: 'border-l-warning',
  },
  critical: {
    Icon: XCircle,
    icon: 'text-destructive',
    rule: 'border-l-destructive',
  },
  promo: { Icon: Sparkles, icon: 'text-primary', rule: 'border-l-primary' },
}

function ActionButton({
  action,
  index,
  compact,
  onActivate,
}: {
  action: NotificationAction
  index: number
  compact: boolean
  onActivate: () => void
}) {
  const variant = action.style === 'secondary' || index > 0 ? 'outline' : 'default'
  const external = isExternal(action.href) || action.target === 'blank'

  return (
    <Button
      variant={variant}
      size='sm'
      asChild
      className={cn(
        'px-2.5 text-xs',
        // Thumb-sized on a phone, tighter on a desktop pointer.
        compact ? 'h-7' : 'h-9 sm:h-8',
      )}
      onClick={onActivate}
    >
      {external ? (
        <a href={action.href} target='_blank' rel='noopener noreferrer'>
          {action.label}
        </a>
      ) : (
        <Link href={action.href}>{action.label}</Link>
      )}
    </Button>
  )
}

export function NotificationTile({
  notification,
  isDismissing = false,
  onImpression,
  onClick,
  onDismiss,
}: {
  notification: ServedNotification
  isDismissing?: boolean
  onImpression: (notification: ServedNotification) => void
  onClick: (notification: ServedNotification) => void
  onDismiss: (notification: ServedNotification) => void
}) {
  const impressionSent = useRef(false)
  useEffect(() => {
    if (impressionSent.current) return
    impressionSent.current = true
    onImpression(notification)
  }, [notification, onImpression])

  // Some messages hold the close control shut briefly, so it cannot be cleared
  // before it has been read.
  const holdSeconds = notification.dismissAfterSeconds ?? 0
  const [canDismiss, setCanDismiss] = useState(holdSeconds <= 0)
  useEffect(() => {
    if (holdSeconds <= 0) return
    const timer = setTimeout(() => setCanDismiss(true), holdSeconds * 1000)
    return () => clearTimeout(timer)
  }, [holdSeconds])

  const tone = TONE[notification.tone] ?? TONE.info
  // Status the reader cannot clear and a message they can are different things,
  // so they are not allowed to look the same.
  const campaign = notification.kind === 'campaign'
  const { Icon } = tone

  const activate = () => {
    onClick(notification)
    // Acting on a message answers it. Status stands until it is resolved.
    if (campaign && notification.dismissible) onDismiss(notification)
  }

  return (
    // One line on a desktop width. The message and its detail sit together on the
    // left rather than in separate columns, which is what made these tall and
    // left a gap down the middle of the bar.
    <Alert
      variant={notification.tone}
      // The stack owns one polite region; role="alert" here interrupts readers.
      role={undefined}
      // tone.rule last, or border-transparent would wipe the left rule too.
      className={cn(
        'border-l-2',
        campaign ? 'border-transparent px-3 py-1.5' : 'px-3 py-2',
        tone.rule,
      )}
    >
      <AlertDescription className='flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3'>
        <div className='flex min-w-0 flex-1 items-start gap-2'>
          <Icon
            aria-hidden='true'
            className={cn(
              'mt-0.5 shrink-0',
              tone.icon,
              campaign ? 'h-3.5 w-3.5' : 'h-4 w-4',
            )}
          />
          <div className='flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2'>
            <span
              className={cn(
                'font-medium leading-snug',
                campaign ? 'text-xs' : 'text-sm',
              )}
            >
              {notification.title}
            </span>
            {notification.body ? (
              <span
                className={cn(
                  'leading-snug',
                  campaign
                    ? 'text-xs text-muted-foreground'
                    : 'text-sm text-foreground/80',
                )}
              >
                {notification.body}
              </span>
            ) : null}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-1.5'>
          {notification.actions.slice(0, MAX_ACTIONS).map((action, index) => (
            <ActionButton
              key={`${action.label}-${index}`}
              action={action}
              index={index}
              compact={campaign}
              onActivate={activate}
            />
          ))}
          {notification.dismissible ? (
            canDismiss ? (
              <button
                type='button'
                aria-label={`Dismiss: ${notification.title}`}
                disabled={isDismissing}
                onClick={() => onDismiss(notification)}
                // 28px of hit area around a 16px glyph.
                className='-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60 disabled:pointer-events-none disabled:opacity-50'
              >
                <X className='h-4 w-4' />
              </button>
            ) : null
          ) : (
            // A blank where the close control would be reads as broken.
            <span
              role='img'
              aria-label='Stays until resolved'
              title='Stays until resolved'
              className='-mr-1 shrink-0 p-1.5 text-muted-foreground'
            >
              <Lock className='h-3.5 w-3.5' aria-hidden='true' />
            </span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
