// The window boundaries the message quota is measured over. Duplicated
// outside this repository.
//
// These exist as shared pure functions because both apps have to count usage the
// same way and they never call each other. The count itself is one line of Mongo
// in each repo; the part that could silently drift is where the window starts,
// so that part lives here and is pinned by the conformance fixture.
//
// Both definitions mirror billing.service exactly:
//
//   - The monthly allowance runs over a billing period anchored to one date:
//     the start of the account's active plan subscription, or the signup date
//     on the free plan. A period starts on a monthly anniversary of the anchor
//     (same UTC day and time) and ends on the next one. When the anchor day
//     does not exist in a month (the 29th to 31st), that month uses its last day.
//   - The daily window starts at midnight UTC, whatever the server time zone.
//
// If billing's definition ever changes, change it here in the same commit, or
// the quota warnings will describe a wall that does not exist.

export function dailyWindowStart(now: Date): Date {
  const start = new Date(now.getTime())
  start.setUTCHours(0, 0, 0, 0)
  return start
}

export type BillingPeriod = { start: Date; end: Date }

type DateInput = Date | string | number | null | undefined

const validDate = (value: DateInput): Date | undefined => {
  if (value === null || value === undefined || value === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * The date the monthly allowance resets on. An active subscription to any plan
 * other than free anchors to its start; everyone else anchors to signup.
 * Subscription end dates are deliberately ignored: an active subscription
 * keeps its anchor even when its stored period has gone stale.
 */
export function periodAnchor(input: {
  signupAt: DateInput
  subscription?: {
    planName?: string | null
    subscriptionStartDate?: DateInput
    createdAt?: DateInput
  } | null
}): Date | undefined {
  const { subscription } = input
  if (subscription && subscription.planName !== 'free') {
    const start =
      validDate(subscription.subscriptionStartDate) ??
      validDate(subscription.createdAt)
    if (start) return start
  }
  return validDate(input.signupAt)
}

function monthsAfter(anchor: Date, months: number): Date {
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth() + months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(anchor.getUTCDate(), lastDay),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  )
}

/** The billing period that contains `now`: start inclusive, end exclusive. */
export function billingPeriod(anchor: Date, now: Date): BillingPeriod {
  let months =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - anchor.getUTCMonth())
  if (monthsAfter(anchor, months).getTime() > now.getTime()) months -= 1
  return { start: monthsAfter(anchor, months), end: monthsAfter(anchor, months + 1) }
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
