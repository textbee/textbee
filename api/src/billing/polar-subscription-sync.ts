// Decides how one Polar subscription event changes the local subscription rows.
//
// Polar delivers webhooks out of order and more than once. An update sent
// before a revoke can arrive after it, and a plan change can be followed by a
// late event that still carries the old product. So a decision only trusts the
// newest state of each Polar subscription, and an ended subscription stays
// ended: Polar never restarts one, a new purchase gets a new id.

/**
 * Polar statuses after which the subscription gives no access. unpaid is left
 * out on purpose: the card can still be fixed, and a revoke ends it anyway.
 */
export const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired'])

export type PolarSnapshot = {
  productId?: string | null
  status?: string | null
  modifiedAt?: Date | null
  endedAt?: Date | null
  /** The event was subscription.revoked. */
  revoked?: boolean
}

/** A local row already linked to the same Polar subscription. */
export type LinkedRow = {
  plan: unknown
  isActive: boolean
  status?: string | null
  polarProductId?: string | null
  polarEventAt?: Date | null
  polarEndedAt?: Date | null
}

export type SyncDecision =
  | { action: 'ignore'; reason: 'ended' | 'stale' }
  | { action: 'end'; endedAt: Date }
  /**
   * keepPlan is set when an active row already holds this product: the plan
   * on that row stays, even when it differs from the product's plan. That is
   * how a plan an admin set by hand survives renewals.
   */
  | { action: 'activate'; keepPlan?: unknown }

const time = (value?: Date | null): number | undefined => {
  if (!value) return undefined
  const t = new Date(value).getTime()
  return Number.isNaN(t) ? undefined : t
}

export function snapshotHasEnded(snapshot: PolarSnapshot, now: Date): boolean {
  if (snapshot.revoked) return true
  if (snapshot.status && ENDED_STATUSES.has(snapshot.status)) return true
  const ended = time(snapshot.endedAt)
  return ended !== undefined && ended <= now.getTime()
}

export function decideSync({
  snapshot,
  rows,
  now,
}: {
  snapshot: PolarSnapshot
  rows: LinkedRow[]
  now: Date
}): SyncDecision {
  if (snapshotHasEnded(snapshot, now)) {
    return { action: 'end', endedAt: snapshot.endedAt ? new Date(snapshot.endedAt) : now }
  }

  const ended = rows.some(
    (row) => row.polarEndedAt || (row.status && ENDED_STATUSES.has(row.status)),
  )
  if (ended) return { action: 'ignore', reason: 'ended' }

  // An event without a time cannot be ordered, so it never overrides one that has one.
  const latest = Math.max(
    ...rows.map((row) => time(row.polarEventAt) ?? -Infinity),
  )
  const modified = time(snapshot.modifiedAt) ?? -Infinity
  if (modified < latest) {
    return { action: 'ignore', reason: 'stale' }
  }

  const holder = rows.find(
    (row) =>
      row.isActive &&
      row.polarProductId &&
      row.polarProductId === snapshot.productId,
  )
  return holder ? { action: 'activate', keepPlan: holder.plan } : { action: 'activate' }
}
