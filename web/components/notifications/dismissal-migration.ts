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

/** Which record a locally stored dismissal belongs to, decided server side. */
export interface DismissalMigration {
  notificationId: string
  storageKey: string
}

// The built-in components wrote either '1' or 'true', so both count. Nothing
// else does: '', '0' and 'false' are the flag being absent or explicitly unset.
const isDismissedValue = (value: string): boolean =>
  value === '1' || value === 'true'

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
 * Dismiss events for messages this browser had already cleared. The pairing of
 * storage key to record id comes from the feed, which lists every record
 * carrying a legacy key and not only the ones it served, so a dismissal is not
 * lost because its record sat beyond the cap.
 */
export function pendingDismissalEvents(
  migrations: DismissalMigration[],
): NotificationEvent[] {
  if (typeof window === 'undefined') return []

  const events: NotificationEvent[] = []
  for (const { notificationId, storageKey } of migrations) {
    const value = read(storageKey)
    if (value === null || !isDismissedValue(value)) continue
    events.push({ notificationId, type: 'dismiss', source: 'migration' })
  }
  return events
}

export { MIGRATION_MARKER }
