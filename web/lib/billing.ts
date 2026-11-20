import type { Plan, Subscription, SubscriptionStatus } from '@/lib/api/types'
import {
  PLAN_TIERS,
  findPlanTier,
  priceTiers,
  type PlanTier,
  type PricedPlanTier,
} from '@/lib/plans'

export type BillingState = {
  /** Display name for the current plan. Always populated. */
  planName: string
  /** The matching marketing tier, when the plan is one of ours. */
  tier: PlanTier | undefined
  /** True when the user has no subscription record at all. */
  isFree: boolean
  /** Present only for a real subscription. */
  status: SubscriptionStatus | undefined
  /** The tier to sell next, or undefined at the top of the ladder. */
  upgradeTier: PlanTier | undefined
  /** Whether a start/renewal date exists worth rendering. */
  hasBillingDates: boolean
  /** Whether the customer portal applies to this account. */
  canManageBilling: boolean
  /** A paid subscription that ends at the period end and will not renew. */
  isCanceling: boolean
}

/**
 * Interpret a /billing/current-subscription payload.
 *
 * The endpoint answers in two different shapes. A subscriber gets the
 * Subscription document, which always carries a `status` because the schema
 * requires one. A user with no subscription gets a synthesised
 * `{ plan, isActive, usage }` with no status, no amount and no dates.
 *
 * The billing page used to read that second shape as a subscription with
 * missing fields, so every free user was told their status was "Unknown" and
 * shown two "N/A" billing dates. Absence of a status is not an unknown status:
 * it means there is nothing to have a status.
 *
 * A paid plan name arriving without a status is still genuinely unknown, and
 * is reported that way rather than being flattened into Free.
 */
export function deriveBillingState(
  subscription: Subscription | undefined
): BillingState {
  const rawName = subscription?.plan?.name
  const normalized = rawName?.trim().toLowerCase()
  const tier = findPlanTier(rawName)
  const status = subscription?.status

  const isFree = !status && (!normalized || normalized === 'free')

  // An unrecognised plan name (a bespoke or enterprise arrangement) has no
  // place on the self-serve ladder, so it gets no upgrade CTA.
  const currentIndex = tier ? PLAN_TIERS.indexOf(tier) : isFree ? 0 : -1
  const upgradeTier =
    currentIndex >= 0 ? PLAN_TIERS[currentIndex + 1] : undefined

  return {
    planName: tier?.name ?? rawName?.trim() ?? 'Free',
    tier,
    isFree,
    status,
    upgradeTier,
    hasBillingDates: Boolean(
      subscription?.subscriptionStartDate || subscription?.currentPeriodEnd
    ),
    canManageBilling: !isFree,
    isCanceling: !isFree && subscription?.cancelAtPeriodEnd === true,
  }
}

/** Whether a free account is shown promotions, for offers that sell Pro. */
export function freePromotionEligible(
  subscription: Subscription | undefined
): boolean {
  return subscription !== undefined && deriveBillingState(subscription).isFree
}

/**
 * Whether the account is shown promotions. A new checkout gets the live
 * promotion, and so does a plan change on a subscription without a discount.
 * A custom plan changes only through billing, and a subscription that has not
 * loaded yet counts as no.
 */
export function promotionEligible(subscription: Subscription | undefined): boolean {
  if (subscription === undefined) return false
  if (deriveBillingState(subscription).isFree) return true
  if (subscription.discountId) return false
  const name = subscription.plan?.name?.trim().toLowerCase()
  return !!name && !name.startsWith('custom')
}

/**
 * Price badge text for the plan header, or null when there is no charge to
 * show. Free accounts carry no amount, and rendering "Free" next to a plan
 * already named Free just says the same thing twice.
 */
export function billingPriceLabel(
  subscription: Subscription | undefined
): number | null {
  const amount = subscription?.amount
  if (amount == null || amount <= 0) return null
  return amount
}

export type YearlySwitchOffer = PricedPlanTier & {
  savingPercent: number
  monthsFree: number
  /** The yearly price after a live promotion, when one applies. */
  salePrice?: number
}

/**
 * The priced tier to offer a switch to yearly billing, with the saving against
 * what this subscriber pays each month now (at the sale price when a live
 * promotion applies), or undefined when the offer does
 * not apply: not an active monthly subscription, a custom plan, a scheduled
 * cancellation, a tier without both prices known, or a yearly price that
 * saves under 1% against the current monthly charge. A past due subscription
 * is excluded by the status check, since the switch would charge the failing
 * card.
 */
export function yearlySwitchTier(
  subscription: Subscription | undefined,
  plans: Plan[] | undefined
): YearlySwitchOffer | undefined {
  if (!subscription || subscription.status !== 'active') return undefined
  if (subscription.cancelAtPeriodEnd === true) return undefined
  const interval = subscription.recurringInterval?.trim().toLowerCase()
  if (interval !== 'month' && interval !== 'monthly') return undefined
  const name = subscription.plan?.name?.trim().toLowerCase()
  if (!name || name.startsWith('custom')) return undefined
  const id = findPlanTier(name)?.id
  const tier = priceTiers(plans).find((t) => t.id === id)
  if (!tier?.hasYearly || !tier.monthlyPrice || !tier.yearlyPrice) {
    return undefined
  }
  const base =
    typeof subscription.amount === 'number' && subscription.amount > 0
      ? subscription.amount / 100
      : tier.monthlyPrice
  const sale = promotionEligible(subscription)
    ? tier.promotion?.yearlyPrice
    : undefined
  const yearlyPrice = sale ?? tier.yearlyPrice
  const yearOfMonthly = base * 12
  const savingPercent = Math.round(
    ((yearOfMonthly - yearlyPrice) / yearOfMonthly) * 100
  )
  if (savingPercent < 1) return undefined
  const monthsFree = Math.floor(12 - yearlyPrice / base)
  return {
    ...tier,
    savingPercent,
    monthsFree,
    salePrice: sale,
  }
}
