'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import {
  useDismissNotification,
  useNotificationFeed,
  useTrackNotificationEvents,
  type NotificationEvent,
  type ServedNotification,
} from '@/lib/api'
import {
  alreadyMigrated,
  markMigrated,
  pendingDismissalEvents,
} from './dismissal-migration'

// Which implementation should render. The dashboard has two: the engine, and the
// built-in messages that predate it. Exactly one is mounted.
export type NotificationMode = 'loading' | 'engine' | 'legacy'

interface NotificationContextValue {
  mode: NotificationMode
  tiles: ServedNotification[]
  modals: ServedNotification[]
  recordImpression: (notification: ServedNotification) => void
  recordClick: (notification: ServedNotification) => void
  dismiss: (notification: ServedNotification, snoozeHours?: number) => void
}

const NotificationContext = createContext<NotificationContextValue>({
  mode: 'loading',
  tiles: [],
  modals: [],
  recordImpression: () => undefined,
  recordClick: () => undefined,
  dismiss: () => undefined,
})

export function useNotifications(): NotificationContextValue {
  return useContext(NotificationContext)
}

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const { data, isLoading, isError } = useNotificationFeed()
  const trackEvents = useTrackNotificationEvents()
  const dismissMutation = useDismissNotification()

  // One impression per notification per page session. Without this, every
  // refetch and every remount would count as another view.
  const reportedImpressions = useRef(new Set<string>())

  const mode: NotificationMode = useMemo(() => {
    // An error falls back to the built-in messages rather than to an empty
    // slot. Losing the past-due and verify-email warnings because the feed
    // request failed would be worse than showing the older versions of them.
    if (isError) return 'legacy'
    if (isLoading || !data) return 'loading'
    return data.engineEnabled ? 'engine' : 'legacy'
  }, [data, isError, isLoading])

  const notifications = useMemo(
    () => (mode === 'engine' ? (data?.notifications ?? []) : []),
    [data, mode],
  )

  const tiles = useMemo(
    () => notifications.filter((n) => n.placement === 'tile'),
    [notifications],
  )
  const modals = useMemo(
    () => notifications.filter((n) => n.placement === 'modal'),
    [notifications],
  )

  const send = useCallback(
    (events: NotificationEvent[], onDelivered?: () => void) => {
      if (!events.length) return
      // Measurement must never break the page, so a failed post is dropped.
      trackEvents.mutate(events, {
        onSuccess: () => onDelivered?.(),
        onError: () => undefined,
      })
    },
    [trackEvents],
  )

  const recordImpression = useCallback(
    (notification: ServedNotification) => {
      if (reportedImpressions.current.has(notification.id)) return
      reportedImpressions.current.add(notification.id)
      send([
        {
          notificationId: notification.id,
          type: 'impression',
          variantId: notification.variantId,
        },
      ])
    },
    [send],
  )

  const recordClick = useCallback(
    (notification: ServedNotification) => {
      send([
        {
          notificationId: notification.id,
          type: 'click',
          variantId: notification.variantId,
        },
      ])
    },
    [send],
  )

  const dismiss = useCallback(
    (notification: ServedNotification, snoozeHours?: number) => {
      dismissMutation.mutate({ id: notification.id, snoozeHours })
    },
    [dismissMutation],
  )

  // Carry this browser's existing dismissals up to the account, once, the first
  // time the engine serves anything. Runs on notifications rather than on mount
  // because it needs the feed's ids to know what to dismiss.
  const migrationAttempted = useRef(false)
  useEffect(() => {
    if (mode !== 'engine' || migrationAttempted.current) return
    if (!data?.notifications?.length) return
    if (alreadyMigrated()) {
      migrationAttempted.current = true
      return
    }

    migrationAttempted.current = true
    const keyToId = new Map(data.notifications.map((n) => [n.key, n.id]))
    const events = pendingDismissalEvents(keyToId)

    if (!events.length) {
      markMigrated()
      return
    }

    // Marked only once the server has the dismissals. Marking it before the post
    // lands would mean a network error lost them permanently, and the engine
    // would then show messages this reader had already cleared.
    send(events, markMigrated)
  }, [data, mode, send])

  const value = useMemo(
    () => ({ mode, tiles, modals, recordImpression, recordClick, dismiss }),
    [mode, tiles, modals, recordImpression, recordClick, dismiss],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
