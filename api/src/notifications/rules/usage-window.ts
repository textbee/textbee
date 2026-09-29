// The two window boundaries the message quota is measured over. Duplicated
// outside this repository.
//
// These exist as shared pure functions because both apps have to count usage the
// same way and they never call each other. The count itself is one line of Mongo
// in each repo; the part that could silently drift is where the window starts,
// so that part lives here and is pinned by the conformance fixture.
//
// Both definitions mirror billing.service exactly, including the two things
// about them that are surprising:
//
//   - The monthly window SLIDES. It is "one month back from this instant", not
//     the calendar month, so it cannot be tracked by an incrementing counter.
//     That is why these counts are not denormalised onto the user.
//   - The daily window starts at midnight UTC, whatever the server time zone.
//
// If billing's definition ever changes, change it here in the same commit, or
// the quota warnings will describe a wall that does not exist.

export function dailyWindowStart(now: Date): Date {
  const start = new Date(now.getTime())
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export function monthlyWindowStart(now: Date): Date {
  const start = new Date(now.getTime())
  start.setMonth(start.getMonth() - 1)
  return start
}

/**
 * Percentage of an allowance used, or undefined when the question does not
 * apply. An unlimited allowance is -1 by convention, and "0% of unlimited" would
 * be a misleading answer rather than a true one, so usage leaves stay
 * unjudgeable for those accounts.
 */
export function allowancePercent(
  count: number | undefined,
  allowance: number | undefined,
): number | undefined {
  if (count === undefined || count === null) return undefined
  if (allowance === undefined || allowance === null) return undefined
  if (!Number.isFinite(allowance) || allowance <= 0) return undefined
  return Math.round((count / allowance) * 100)
}
