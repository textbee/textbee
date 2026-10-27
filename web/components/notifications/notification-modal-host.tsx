'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ServedNotification } from '@/lib/api'
import { LegacyModalHost } from './legacy-modal-host'
import { useNotifications } from './notification-provider'

const isExternal = (href: string) => /^https?:\/\//i.test(href)

/** The span "Don't ask again" buys, in hours. The server clamps it. */
const SNOOZE_HOURS = 30 * 24

const CLOSED_KEY = 'textbee.notifications.modalClosed'

// Component state alone brought a closed dialog back on every full load.
const readClosedIds = (): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(CLOSED_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

const rememberClosedId = (id: string): void => {
  try {
    const next = Array.from(new Set([...readClosedIds(), id]))
    window.sessionStorage.setItem(CLOSED_KEY, JSON.stringify(next))
  } catch {
    // Private windows and blocked site data throw.
  }
}

// At most one modal, and only the highest ranked one the feed returned. The cap
// is applied server side, but this also refuses to stack: two dialogs at once is
// never the right answer.
export function NotificationModalHost() {
  const { mode, modals, recordImpression, recordClick, dismiss } =
    useNotifications()

  const notification: ServedNotification | undefined = modals[0]
  const notificationId = notification?.id

  // Tracked by id rather than as a plain boolean, so nothing has to be reset
  // when the served message changes: a different id is simply not yet revealed
  // and not yet closed.
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [closedIds, setClosedIds] = useState<string[]>(() => readClosedIds())
  // One reveal per mount, or a dismissal refetch chains the next dialog in.
  const [closedAny, setClosedAny] = useState(false)
  const impressionSent = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'engine' || !notificationId || closedAny) return
    if (readClosedIds().includes(notificationId)) return
    // A short delay so a modal does not land on top of a page still painting.
    const timer = setTimeout(() => setRevealedId(notificationId), 900)
    return () => clearTimeout(timer)
  }, [closedAny, mode, notificationId])

  const open = Boolean(
    notification &&
      revealedId === notification.id &&
      !closedIds.includes(notification.id),
  )

  useEffect(() => {
    if (!open || !notification) return
    if (impressionSent.current === notification.id) return
    impressionSent.current = notification.id
    recordImpression(notification)
  }, [notification, open, recordImpression])

  if (mode === 'loading') return null
  if (mode === 'legacy') return <LegacyModalHost />
  if (!notification) return null

  const markClosed = (id: string) => {
    setClosedIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    setClosedAny(true)
    rememberClosedId(id)
  }

  const close = () => {
    markClosed(notification.id)
    // Closing a modal is a dismissal. Without this it would reappear on the
    // next navigation, which is the behaviour these replace.
    if (notification.dismissible) dismiss(notification)
  }

  const snooze = () => {
    markClosed(notification.id)
    dismiss(notification, SNOOZE_HOURS)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{notification.title}</DialogTitle>
          {notification.body ? (
            <DialogDescription>{notification.body}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className='flex-col gap-2 sm:flex-row'>
          {notification.actions.map((action, index) => {
            const external = isExternal(action.href) || action.target === 'blank'
            return (
              <Button
                key={`${action.label}-${index}`}
                variant={index > 0 ? 'outline' : 'default'}
                asChild
                onClick={() => {
                  recordClick(notification)
                  markClosed(notification.id)
                  // Acting on it is a stronger signal than closing it, so it
                  // must not come back on the next load either.
                  if (notification.dismissible) dismiss(notification)
                }}
              >
                {external ? (
                  <a href={action.href} target='_blank' rel='noopener noreferrer'>
                    {action.label}
                  </a>
                ) : (
                  // Client navigation, or the unload cancels the posts above.
                  <Link href={action.href}>{action.label}</Link>
                )}
              </Button>
            )
          })}
          {notification.dismissible ? (
            <Button variant='ghost' onClick={snooze}>
              Don&apos;t ask again
            </Button>
          ) : null}
          <Button variant='ghost' onClick={close}>
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
