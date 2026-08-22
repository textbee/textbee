/**
 * Plan definitions for the dashboard, mirroring the marketing site's pricing
 * section (textbee-marketing pricing-section.tsx).
 *
 * Deliberately static rather than fetched. The billing plans endpoint returns
 * raw Plan documents with limits and cents, not the customer-facing copy, and
 * an environment whose plans collection is empty left the onboarding step
 * showing "plans could not be loaded" with nothing to choose. Pricing is
 * marketing copy, so it comes from the same place the pricing page does.
 *
 * If the marketing pricing changes, change it here too. plans.test.ts pins the
 * values so a silent drift shows up as a failing test rather than a wrong
 * price in front of a customer.
 */

export type BillingInterval = 'monthly' | 'yearly'

export type PlanTier = {
  /** Matches the checkout route segment: /checkout/{id}. */
  id: string
  name: string
  description: string
  monthlyPrice: number
  yearlyPrice?: number
  features: string[]
  /** The tier the picker highlights. */
  isPopular?: boolean
}

export const PLAN_TIERS: PlanTier[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic SMS gateway features',
    monthlyPrice: 0,
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
    monthlyPrice: 9.99,
    yearlyPrice: 99.99,
    isPopular: true,
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
    monthlyPrice: 29.99,
    yearlyPrice: 299.99,
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

export function findPlanTier(name: string | undefined | null) {
  if (!name) return undefined
  const key = name.trim().toLowerCase()
  return PLAN_TIERS.find((tier) => tier.id === key)
}

/** The interval an in-app CTA commits to unless the caller says otherwise. */
export const DEFAULT_CHECKOUT_INTERVAL: BillingInterval = 'monthly'

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
  interval: BillingInterval = DEFAULT_CHECKOUT_INTERVAL,
): string {
  return `/checkout/${planId}?billingInterval=${interval}`
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
export function monthlyEquivalent(tier: PlanTier): number | undefined {
  if (!tier.yearlyPrice) return undefined
  return tier.yearlyPrice / 12
}

/** Percentage saved by paying yearly, rounded to a whole number. */
export function yearlySavingPercent(tier: PlanTier): number | undefined {
  if (!tier.yearlyPrice || tier.monthlyPrice <= 0) return undefined
  const yearOfMonthly = tier.monthlyPrice * 12
  return Math.round(((yearOfMonthly - tier.yearlyPrice) / yearOfMonthly) * 100)
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
export function formatPriceCaption(tier: PlanTier): string {
  const perMonth = monthlyEquivalent(tier)
  if (perMonth !== undefined && tier.yearlyPrice !== undefined) {
    return `or ${formatPlanPrice(perMonth)}/month billed yearly at ${formatPlanPrice(
      tier.yearlyPrice,
    )}`
  }
  if (tier.monthlyPrice <= 0) return 'no card required'
  return 'billed monthly'
}
