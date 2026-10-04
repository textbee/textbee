import type { Subscription } from '@/lib/api/types'

// The backend uses -1 to mean "no limit".
export const UNLIMITED = -1

export type UsageWindow = {
  used: number
  limit: number | undefined
  remaining: number
  // 0-100, clamped. Meaningless when unlimited.
  percentage: number
  unlimited: boolean
  // True once the user is close enough to the limit to warrant a nudge.
  nearLimit: boolean
  atLimit: boolean
  // When the window starts over. Only the monthly window reports one.
  resetAt?: string
}

export const NEAR_LIMIT_PERCENT = 80

function buildWindow(
  used: number | undefined,
  limit: number | undefined,
  remaining: number | undefined,
  percentage: number | undefined,
  resetAt?: string
): UsageWindow {
  const unlimited = limit === UNLIMITED
  // The backend reports percentage directly, but it is only meaningful for a
  // real limit and can exceed 100 when a limit was lowered mid-period.
  const pct = unlimited ? 0 : Math.min(100, Math.max(0, percentage ?? 0))

  return {
    used: used ?? 0,
    limit,
    remaining: remaining ?? 0,
    percentage: pct,
    unlimited,
    nearLimit: !unlimited && pct >= NEAR_LIMIT_PERCENT && pct < 100,
    atLimit: !unlimited && pct >= 100,
    resetAt:
      resetAt && !Number.isNaN(new Date(resetAt).getTime()) ? resetAt : undefined,
  }
}

/**
 * Derive the daily and monthly send windows from a subscription.
 *
 * Shared by the dashboard usage cards and the billing page so the two can
 * never disagree about how much quota is left. `usage` values win over `plan`
 * values because they already account for per-account custom overrides.
 */
export function deriveUsage(subscription: Subscription | undefined) {
  const plan = subscription?.plan
  const usage = subscription?.usage

  return {
    daily: buildWindow(
      usage?.processedSmsToday,
      usage?.dailyLimit ?? plan?.dailyLimit,
      usage?.dailyRemaining,
      usage?.dailyUsagePercentage
    ),
    monthly: buildWindow(
      usage?.processedSmsLastMonth,
      usage?.monthlyLimit ?? plan?.monthlyLimit,
      usage?.monthlyRemaining,
      usage?.monthlyUsagePercentage,
      usage?.monthlyResetAt
    ),
  }
}
