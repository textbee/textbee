'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
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
  isDismissing: (id: string) => boolean
  recordImpression: (notification: ServedNotification) => void
  recordClick: (notification: ServedNotification) => void
  dismiss: (notification: ServedNotification, snoozeHours?: number) => void
}

const NotificationContext = createContext<NotificationContextValue>({
  mode: 'loading',
  tiles: [],
  modals: [],
  isDismissing: () => false,
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
  const queryClient = useQueryClient()
  const { data, isLoading, isError } = useNotificationFeed()
  const trackEvents = useTrackNotificationEvents()
  const dismissMutation = useDismissNotification()

  // One impression per notification per page session. Without this, every
  // refetch and every remount would count as another view.
  const reportedImpressions = useRef(new Set<string>())
  // Posts still in the air, so a concurrent render cannot double count.
  const impressionsInFlight = useRef(new Set<string>())
  const [dismissingIds, setDismissingIds] = useState<string[]>([])

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
    (
      events: NotificationEvent[],
      onDelivered?: () => void,
      onFailed?: () => void,
    ) => {
      if (!events.length) return
      // mutateAsync, not mutate: callbacks handed to mutate fire only for the
      // most recent call, so overlapping posts would lose their completion.
      // Measurement must never break the page, so a failed post is dropped.
      void trackEvents
        .mutateAsync(events)
        .then(() => onDelivered?.())
        .catch(() => onFailed?.())
    },
    [trackEvents],
  )

  const recordImpression = useCallback(
    (notification: ServedNotification) => {
      const { id } = notification
      if (reportedImpressions.current.has(id)) return
      if (impressionsInFlight.current.has(id)) return
      impressionsInFlight.current.add(id)
      send(
        [
          {
            notificationId: id,
            type: 'impression',
            variantId: notification.variantId,
          },
        ],
        // Counted on success only, so a failed post can be tried again.
        () => {
          impressionsInFlight.current.delete(id)
          reportedImpressions.current.add(id)
        },
        () => impressionsInFlight.current.delete(id),
      )
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
      const { id } = notification
      setDismissingIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
      // mutateAsync, so a dismissal started while another is still in the air
      // keeps its own completion and does not stay disabled after a rollback.
      void dismissMutation
        .mutateAsync({ id, snoozeHours })
        // The hook's onError already raises the toast.
        .catch(() => undefined)
        .finally(() =>
          setDismissingIds((ids) => ids.filter((each) => each !== id)),
        )
    },
    [dismissMutation],
  )

  const isDismissing = useCallback(
    (id: string) => dismissingIds.includes(id),
    [dismissingIds],
  )

  // Carry this browser's existing dismissals up to the account, once, the first
  // time the engine answers. Runs on the feed rather than on mount because it
  // needs the pairings the feed sends to know what to dismiss.
  const migrationAttempted = useRef(false)
  useEffect(() => {
    if (mode !== 'engine' || migrationAttempted.current) return
    const migrations = data?.dismissalMigrations ?? []
    if (!data?.notifications?.length && !migrations.length) return
    if (alreadyMigrated()) {
      migrationAttempted.current = true
      return
    }

    migrationAttempted.current = true
    // The feed's own pairings, which cover records it held back as well as the
    // ones it served, so a dismissal is not dropped for want of a free slot.
    const events = pendingDismissalEvents(migrations)

    if (!events.length) {
      markMigrated()
      return
    }

    // Marked only once the server has the dismissals. Marking it before the post
    // lands would mean a network error lost them permanently, and the engine
    // would then show messages this reader had already cleared. The refetch is
    // what makes it visible on this load rather than the next one.
    send(events, () => {
      markMigrated()
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notificationFeed,
      })
    })
  }, [data, mode, queryClient, send])

  const value = useMemo(
    () => ({
      mode,
      tiles,
      modals,
      isDismissing,
      recordImpression,
      recordClick,
      dismiss,
    }),
    [mode, tiles, modals, isDismissing, recordImpression, recordClick, dismiss],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}
