'use client'

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

// At most one modal, and only the highest ranked one the feed returned. The cap
// is applied server side, but this also refuses to stack: two dialogs at once is
// never the right answer.
export function NotificationModalHost() {
  const { mode, modals, recordImpression, recordClick, dismiss } =
    useNotifications()

  const notification: ServedNotification | undefined = modals[0]

  // Tracked by id rather than as a plain boolean, so nothing has to be reset
  // when the served message changes: a different id is simply not yet revealed
  // and not yet closed.
  const [revealedId, setRevealedId] = useState<string | null>(null)
  const [closedId, setClosedId] = useState<string | null>(null)
  const impressionSent = useRef<string | null>(null)

  useEffect(() => {
    if (mode !== 'engine' || !notification) return
    const { id } = notification
    // A short delay so a modal does not land on top of a page still painting.
    const timer = setTimeout(() => setRevealedId(id), 900)
    return () => clearTimeout(timer)
  }, [mode, notification])

  const open = Boolean(
    notification &&
      revealedId === notification.id &&
      closedId !== notification.id,
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

  const close = () => {
    setClosedId(notification.id)
    // Closing a modal is a dismissal. Without this it would reappear on the
    // next navigation, which is the behaviour these replace.
    if (notification.dismissible) dismiss(notification)
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
                  setClosedId(notification.id)
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
                  <a href={action.href}>{action.label}</a>
                )}
              </Button>
            )
          })}
          <Button variant='ghost' onClick={close}>
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
