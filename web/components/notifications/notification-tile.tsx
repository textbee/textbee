'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { NotificationAction, ServedNotification } from '@/lib/api'

// Presentational. Everything it shows was decided server side, so it holds no
// targeting logic and takes no data of its own. The markup is deliberately
// plain semantic utilities: this same shape is rendered elsewhere on an older
// Tailwind, and utilities like bg-linear-to-r would not survive the trip.

const isExternal = (href: string) => /^https?:\/\//i.test(href)

function ActionButton({
  action,
  index,
  onActivate,
}: {
  action: NotificationAction
  index: number
  onActivate: () => void
}) {
  const variant = action.style === 'secondary' || index > 0 ? 'outline' : 'default'
  const external = isExternal(action.href) || action.target === 'blank'

  return (
    <Button
      variant={variant}
      size='sm'
      asChild
      className='h-7 px-2.5 text-xs'
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
  onImpression,
  onClick,
  onDismiss,
}: {
  notification: ServedNotification
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

  return (
    // One line on a desktop width. The message and its detail sit together on the
    // left rather than in separate columns, which is what made these tall and
    // left a gap down the middle of the bar.
    <Alert variant={notification.tone} className='px-3 py-2'>
      <AlertDescription className='flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2'>
          <span className='text-sm font-medium leading-snug'>
            {notification.title}
          </span>
          {notification.body ? (
            <span className='text-xs leading-snug text-muted-foreground'>
              {notification.body}
            </span>
          ) : null}
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {notification.actions.map((action, index) => (
            <ActionButton
              key={`${action.label}-${index}`}
              action={action}
              index={index}
              onActivate={() => onClick(notification)}
            />
          ))}
          {notification.dismissible && canDismiss ? (
            <button
              type='button'
              aria-label={`Dismiss: ${notification.title}`}
              onClick={() => onDismiss(notification)}
              className='rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60'
            >
              <X className='h-3.5 w-3.5' />
            </button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  )
}
