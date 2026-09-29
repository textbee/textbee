'use client'

import type React from 'react'
import type { ServedNotification } from '@/lib/api'
import { NotificationTile } from './notification-tile'

export interface NotificationRendererProps {
  notification: ServedNotification
  onImpression: (notification: ServedNotification) => void
  onClick: (notification: ServedNotification) => void
  onDismiss: (notification: ServedNotification) => void
}

export type NotificationRenderer = (
  props: NotificationRendererProps,
) => React.ReactElement | null

// Most authored messages are a title, a body and up to two buttons, which the
// standard tile covers. A few need markup of their own, and those register here
// against the record's key while still going through the engine for targeting,
// ordering, capping and measurement.
//
// An unrecognised key falls through to the standard renderer on purpose: the
// record can be authored at any time, and the dashboard must never break
// because of one.
const RENDERERS: Record<string, NotificationRenderer> = {}

export function rendererFor(notification: ServedNotification): NotificationRenderer {
  if (notification.renderer && notification.renderer !== 'standard') {
    const custom = RENDERERS[notification.renderer]
    if (custom) return custom
  }
  return NotificationTile
}

export function registerNotificationRenderer(
  key: string,
  renderer: NotificationRenderer,
): void {
  RENDERERS[key] = renderer
}
