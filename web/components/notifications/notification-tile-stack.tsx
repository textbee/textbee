'use client'

import { useState } from 'react'
import type { ServedNotification } from '@/lib/api'
import { LegacyAlertStack } from './legacy-alert-stack'
import { useNotifications } from './notification-provider'
import { rendererFor } from './renderers'

// The page gutter, so the slot lines up with the breadcrumb and the content.
const GUTTER = 'px-4 pt-3 sm:px-6 md:px-8'

// The single switch for the top-of-dashboard slot. Exactly one implementation is
// mounted, never both: each built-in alert runs its own subscription and account
// queries, so keeping them mounted but hidden would both pay for them and risk
// the two stacks painting over each other.
export function NotificationTileStack() {
  const { mode, tiles, isDismissing, recordImpression, recordClick, dismiss } =
    useNotifications()
  const [expanded, setExpanded] = useState(false)

  // Nothing while the feed is in flight. That is already how this slot behaves:
  // every built-in alert returns null until its own query resolves, so there is
  // no new gap and no flash of one implementation before the other.
  if (mode === 'loading') return null

  // The slot owns its own spacing so that an account with nothing to see gets no
  // element at all, rather than an empty band of padding above the page.
  if (mode === 'legacy') {
    return (
      <div className={`space-y-1.5 ${GUTTER}`}>
        <LegacyAlertStack />
      </div>
    )
  }

  if (!tiles.length) return null

  const held = tiles.filter((n) => n.overflow)
  const shown = expanded ? tiles : tiles.filter((n) => !n.overflow)
  const system = shown.filter((n) => n.kind === 'system')
  const campaign = shown.filter((n) => n.kind !== 'system')

  const render = (notification: ServedNotification) => {
    const Renderer = rendererFor(notification)
    return (
      <Renderer
        key={notification.id}
        notification={notification}
        isDismissing={isDismissing(notification.id)}
        onImpression={recordImpression}
        onClick={recordClick}
        onDismiss={dismiss}
      />
    )
  }

  return (
    <section aria-label='Notifications' className={GUTTER}>
      {/* One polite region for the slot, not one per message. */}
      <div aria-live='polite' className='space-y-3'>
        {system.length ? (
          <div className='space-y-1.5'>{system.map(render)}</div>
        ) : null}
        {campaign.length ? (
          <div className='space-y-1.5'>{campaign.map(render)}</div>
        ) : null}
      </div>
      {held.length ? (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className='mt-2 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60'
        >
          {expanded
            ? 'Show fewer'
            : `${held.length} more notification${held.length === 1 ? '' : 's'}`}
        </button>
      ) : null}
    </section>
  )
}
