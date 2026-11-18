import type { Plan, PlanPromotion } from '@/lib/api/types'

/**
 * Plan definitions for the dashboard, mirroring the marketing site's pricing
 * section (textbee-marketing pricing-section.tsx).
 *
 * The tier copy is static, so an environment whose plans collection is empty
 * still shows every tier to choose from. Prices are not: they come from the
 * plan documents via /billing/plans (see priceTiers), so a price change is a
 * database edit rather than a deploy. A paid tier whose price is unknown shows
 * no number at all rather than a stale one.
 */

export type BillingInterval = 'monthly' | 'yearly'

export type PlanTier = {
  /** Matches the checkout route segment: /checkout/{id}. */
  id: string
  name: string
  description: string
  features: string[]
  /** The tier the picker highlights. */
  isPopular?: boolean
  /** Offered with yearly billing. The price itself comes from the API. */
  hasYearly?: boolean
}

/**
 * A live checkout promotion on a tier, with sale prices in dollars. A sale
 * price is undefined when the promotion does not cover that interval.
 */
export type TierPromotion = {
  label: string
  percentOff: number
  endsAt: string | null
  duration: PlanPromotion['duration']
  durationInMonths: number | null
  monthlyPrice?: number
  yearlyPrice?: number
}

/** A tier with its prices in dollars. Undefined means the price is unknown. */
export type PricedPlanTier = PlanTier & {
  monthlyPrice?: number
  yearlyPrice?: number
  /** Set only while a promotion covers this tier. */
  promotion?: TierPromotion
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic SMS gateway features',
    features: [
      'Send and receive SMS Messages',
      'Register 1 active device',
      'Max 50 messages per day',
      'Up to 300 messages per month',
      'Webhook notifications',
      'Basic support',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For growing projects that send every day',
    isPopular: true,
    hasYearly: true,
    features: [
      'Everything in Free plan',
      'Register up to 5 active devices',
      'Unlimited daily messages',
      'Up to 5,000 messages per month',
      'Message templates with variables',
      'Priority support',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    description: 'For higher volume and more devices',
    hasYearly: true,
    features: [
      'Everything in Pro plan',
      'Register up to 15 active devices',
      'Unlimited daily messages',
      'Up to 25,000 messages per month',
      'Message templates with variables',
      'Priority support',
    ],
  },
]

/**
 * Prices are dollar amounts here, not the cents the API deals in.
 *
 * Free renders as "$0" rather than "Free" so it does not simply repeat the
 * tier name directly above it, matching how the pricing page reads.
 */
export function formatPlanPrice(price: number): string {
  if (price <= 0) return '$0'
  return `$${price.toFixed(2)}`
}

const planKey = (name: string | undefined | null) => name?.trim().toLowerCase()

export function findPlanTier(name: string | undefined | null) {
  const key = planKey(name)
  if (!key) return undefined
  return PLAN_TIERS.find((tier) => tier.id === key)
}

const dollars = (cents: number | undefined | null) =>
  typeof cents === 'number' && cents > 0 ? cents / 100 : undefined

/** The promotion in dollars, or undefined when it is missing or unusable. */
function tierPromotion(
  promotion: PlanPromotion | null | undefined,
  hasYearly: boolean | undefined
): TierPromotion | undefined {
  if (!promotion || !(promotion.percentOff > 0) || !promotion.label) {
    return undefined
  }
  const monthlyPrice = dollars(promotion.monthlyPrice)
  const yearlyPrice = hasYearly ? dollars(promotion.yearlyPrice) : undefined
  if (monthlyPrice === undefined && yearlyPrice === undefined) return undefined
  return {
    label: promotion.label,
    percentOff: promotion.percentOff,
    endsAt: promotion.endsAt ?? null,
    duration: promotion.duration,
    durationInMonths: promotion.durationInMonths ?? null,
    monthlyPrice,
    yearlyPrice,
  }
}

/**
 * PLAN_TIERS with prices from the /billing/plans documents, which hold cents.
 * Free is always $0. A paid tier with no matching plan, or no price on it,
 * gets undefined, so the UI can show "see pricing" instead of a wrong number.
 */
export function priceTiers(plans: Plan[] | undefined): PricedPlanTier[] {
  return PLAN_TIERS.map((tier) => {
    if (isFreeTier(tier)) return { ...tier, monthlyPrice: 0 }
    const plan = plans?.find((p) => planKey(p.name) === tier.id)
    const promotion = tierPromotion(plan?.promotion, tier.hasYearly)
    return {
      ...tier,
      monthlyPrice: dollars(plan?.monthlyPrice),
      yearlyPrice: tier.hasYearly ? dollars(plan?.yearlyPrice) : undefined,
      ...(promotion && { promotion }),
    }
  })
}

export function isFreeTier(tier: PlanTier): boolean {
  return tier.id === 'free'
}

/**
 * The interval an in-app CTA commits to unless the caller says otherwise.
 * Exactly "monthly" in NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL gives monthly;
 * anything else, unset included, gives yearly.
 */
export const DEFAULT_CHECKOUT_INTERVAL: BillingInterval =
  process.env.NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL === 'monthly'
    ? 'monthly'
    : 'yearly'

/** The default interval for one tier: monthly when it has no yearly option. */
export function defaultIntervalFor(planId: string): BillingInterval {
  return findPlanTier(planId)?.hasYearly ? DEFAULT_CHECKOUT_INTERVAL : 'monthly'
}

/**
 * Checkout URL for an upgrade CTA.
 *
 * Naming the interval is not cosmetic: /checkout/{plan} continues straight to
 * the payment page when the URL carries one, and stops on an interval chooser
 * when it does not. Going through this helper keeps a call site from omitting
 * it by accident.
 */
export function checkoutPath(
  planId: string,
  interval: BillingInterval = defaultIntervalFor(planId),
  from?: string,
): string {
  const path = `/checkout/${planId}?billingInterval=${interval}`
  return from ? `${path}&from=${encodeURIComponent(from)}` : path
}

/**
 * Refund window by interval, mirroring the published refund policy
 * (textbee-marketing refund-policy/page.tsx). Quoting the wrong number here
 * would be a promise we do not keep.
 */
export const MONEY_BACK_DAYS: Record<BillingInterval, number> = {
  monthly: 7,
  yearly: 14,
}

/**
 * What a yearly plan works out to per month, so the saving is legible without
 * making the reader divide. Derived rather than stored: a hardcoded figure
 * silently goes wrong the moment a price changes.
 */
export function monthlyEquivalent(tier: PricedPlanTier): number | undefined {
  if (!tier.yearlyPrice) return undefined
  return tier.yearlyPrice / 12
}

/** Percentage saved by paying yearly, rounded to a whole number. */
export function yearlySavingPercent(
  tier: PricedPlanTier,
): number | undefined {
  if (!tier.yearlyPrice || !tier.monthlyPrice) return undefined
  const yearOfMonthly = tier.monthlyPrice * 12
  return Math.round(((yearOfMonthly - tier.yearlyPrice) / yearOfMonthly) * 100)
}

/** Whole months the yearly price saves against twelve monthly payments. */
export function yearlyMonthsFree(tier: PricedPlanTier): number | undefined {
  if (!tier.yearlyPrice || !tier.monthlyPrice) return undefined
  if (tier.yearlyPrice <= 0 || tier.monthlyPrice <= 0) return undefined
  return Math.floor(12 - tier.yearlyPrice / tier.monthlyPrice)
}

/** ", 2 months free", or empty when the saving is under a month. */
export function monthsFreeSuffix(tier: PricedPlanTier): string {
  const months = yearlyMonthsFree(tier)
  if (months === undefined || months < 1) return ''
  return `, ${months} ${months === 1 ? 'month' : 'months'} free`
}

/**
 * The caption under a headline month-to-month price, e.g. "or $8.33/month
 * billed yearly at $99.99".
 *
 * The headline used to be the yearly per-month equivalent, which meant a card
 * reading "$8.33/month" led to a $99.99 charge. The headline now matches what
 * the CTA actually charges, and the yearly option is the discount offered
 * underneath it rather than the number sold on.
 */
export function formatPriceCaption(tier: PricedPlanTier): string | undefined {
  if (isFreeTier(tier)) return 'no card required'
  const perMonth = monthlyEquivalent(tier)
  if (perMonth !== undefined && tier.yearlyPrice !== undefined) {
    return `or ${formatPlanPrice(perMonth)}/month billed yearly at ${formatPlanPrice(
      tier.yearlyPrice,
    )}`
  }
  if (tier.monthlyPrice !== undefined) return 'billed monthly'
  return undefined
}

/** The sale price for one interval, or undefined when there is none. */
export function salePriceFor(
  tier: PricedPlanTier | undefined,
  interval: BillingInterval
): number | undefined {
  const promotion = tier?.promotion
  return interval === 'yearly' ? promotion?.yearlyPrice : promotion?.monthlyPrice
}

/** The interval a promotion CTA sells: yearly when it has a yearly sale price. */
export function promotionInterval(tier: PricedPlanTier): BillingInterval {
  return tier.promotion?.yearlyPrice !== undefined ? 'yearly' : 'monthly'
}

/**
 * The promotion end as a date, such as "March 31". Formatted in Pacific time,
 * the zone the promotion ends in, so an end at 11:59 pm Pacific shows that day.
 */
export function formatPromotionEnd(endsAt: string | null | undefined): string | undefined {
  if (!endsAt) return undefined
  const at = new Date(endsAt)
  if (Number.isNaN(at.getTime())) return undefined
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(at)
}

/** How long the discount lasts, as it follows "20% off": "forever". */
export function promotionDurationLabel(promotion: TierPromotion): string {
  if (promotion.duration === 'once') return 'on the first payment'
  if (promotion.duration === 'repeating') {
    const months = promotion.durationInMonths
    if (!months || months < 1) return 'for a limited time'
    return `for ${months} ${months === 1 ? 'month' : 'months'}`
  }
  return 'forever'
}

/** One sentence on how long the sale price lasts, for a price caption. */
export function promotionDurationNote(promotion: TierPromotion): string {
  if (promotion.duration === 'once') return 'Sale price on the first payment.'
  if (promotion.duration === 'repeating') {
    const months = promotion.durationInMonths
    if (!months || months < 1) return 'Sale price for a limited time.'
    return months === 1
      ? 'Sale price for the first month.'
      : `Sale price for the first ${months} months.`
  }
  return 'Stays while you stay subscribed.'
}

/** Chip text, such as "Spring offer · 20% off forever". */
export function promotionChip(promotion: TierPromotion): string {
  return `${promotion.label} · ${promotion.percentOff}% off ${promotionDurationLabel(promotion)}`
}

/** "Offer ends March 31. Applied at checkout.", without a date when it has no end. */
export function promotionEndNote(promotion: TierPromotion): string {
  const end = formatPromotionEnd(promotion.endsAt)
  return end ? `Offer ends ${end}. Applied at checkout.` : 'Applied at checkout.'
}

/** One line for limit notices, such as "Spring offer: 20% off Pro, forever. Ends March 31." */
export function promotionLine(promotion: TierPromotion, planName: string): string {
  const end = formatPromotionEnd(promotion.endsAt)
  return `${promotion.label}: ${promotion.percentOff}% off ${planName}, ${promotionDurationLabel(
    promotion
  )}.${end ? ` Ends ${end}.` : ''}`
}
