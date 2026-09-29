'use client'

import { LegacyAlertStack } from './legacy-alert-stack'
import { useNotifications } from './notification-provider'
import { rendererFor } from './renderers'

// The single switch for the top-of-dashboard slot. Exactly one implementation is
// mounted, never both: each built-in alert runs its own subscription and account
// queries, so keeping them mounted but hidden would both pay for them and risk
// the two stacks painting over each other.
export function NotificationTileStack() {
  const { mode, tiles, recordImpression, recordClick, dismiss } =
    useNotifications()

  // Nothing while the feed is in flight. That is already how this slot behaves:
  // every built-in alert returns null until its own query resolves, so there is
  // no new gap and no flash of one implementation before the other.
  if (mode === 'loading') return null

  // The slot owns its own spacing so that an account with nothing to see gets no
  // element at all, rather than an empty band of padding above the page.
  if (mode === 'legacy') {
    return (
      <div className='space-y-1.5 px-4 pt-3'>
        <LegacyAlertStack />
      </div>
    )
  }

  if (!tiles.length) return null

  return (
    <div className='space-y-1.5 px-4 pt-3'>
      {tiles.map((notification) => {
        const Renderer = rendererFor(notification)
        return (
          <Renderer
            key={notification.id}
            notification={notification}
            onImpression={recordImpression}
            onClick={recordClick}
            onDismiss={dismiss}
          />
        )
      })}
    </div>
  )
}
