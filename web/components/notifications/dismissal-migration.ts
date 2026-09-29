import type { NotificationEvent } from '@/lib/api'

// Copies the dismissals the built-in messages kept in this browser up to the
// server, once, so switching to the engine does not resurrect something the
// reader already cleared.
//
// It copies and does NOT clear. The built-in components read these keys and
// nothing else, so clearing them here would mean that turning the engine back
// off brought every dismissed message back. They are cleared when those
// components are finally removed.

const MIGRATION_MARKER = 'textbee.notifications.migrated'

/** Legacy storage key to the notification key it corresponds to. */
const LEGACY_DISMISSALS: Array<{ storageKey: string; matches: (value: string) => boolean; notificationKey: string }> = [
  {
    storageKey: 'discord_banner_dismissed',
    matches: (value) => value === '1',
    notificationKey: 'join-discord',
  },
  {
    storageKey: 'discord_modal_has_joined',
    matches: (value) => value === 'true',
    notificationKey: 'join-community-modal',
  },
  {
    storageKey: 'survey_modal_has_submitted',
    matches: (value) => value === 'true',
    notificationKey: 'survey-invite',
  },
  {
    storageKey: 'contribute_modal_has_contributed',
    matches: (value) => value === 'true',
    notificationKey: 'github-star',
  },
]

const read = (key: string): string | null => {
  // Private windows and blocked site data both throw rather than return null.
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function alreadyMigrated(): boolean {
  return read(MIGRATION_MARKER) === '1'
}

export function markMigrated(): void {
  try {
    window.localStorage.setItem(MIGRATION_MARKER, '1')
  } catch {
    // Nothing to do. Worst case the copy is attempted again next load, and the
    // server upserts, so a repeat is harmless.
  }
}

/**
 * Dismiss events for messages this browser had already cleared, resolved
 * against the ids in the current feed. Keys the feed does not mention are
 * skipped: there is nothing to dismiss.
 */
export function pendingDismissalEvents(
  keyToId: Map<string, string>,
): NotificationEvent[] {
  if (typeof window === 'undefined') return []

  const events: NotificationEvent[] = []
  for (const entry of LEGACY_DISMISSALS) {
    const value = read(entry.storageKey)
    if (value === null || !entry.matches(value)) continue
    const id = keyToId.get(entry.notificationKey)
    if (!id) continue
    events.push({ notificationId: id, type: 'dismiss' })
  }
  return events
}

export const LEGACY_DISMISSAL_KEYS = LEGACY_DISMISSALS.map((e) => e.storageKey)
export { MIGRATION_MARKER }
