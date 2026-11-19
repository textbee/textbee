import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import {
  DEFAULT_CHECKOUT_INTERVAL,
  MONEY_BACK_DAYS,
  PLAN_TIERS,
  checkoutPath,
  findPlanTier,
  formatPlanPrice,
  formatPriceCaption,
  formatPromotionEnd,
  monthlyEquivalent,
  monthsFreeSuffix,
  priceTiers,
  promotionChip,
  promotionDurationLabel,
  promotionDurationNote,
  promotionEndNote,
  promotionInterval,
  promotionLine,
  promotionOffer,
  salePriceFor,
  yearlyMonthsFree,
  yearlySavingPercent,
} from './plans'

// Fixture prices: Pro $19.00 or $120.00 yearly, Scale $49.00 or $360.00.
const priced = priceTiers(mockBillingPlans)
const pro = priced.find((t) => t.id === 'pro')!
const scale = priced.find((t) => t.id === 'scale')!
const free = priced.find((t) => t.id === 'free')!

describe('PLAN_TIERS', () => {
  // Prices live in the plan documents, so a price change needs no deploy.
  it('carries no prices of its own', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier).not.toHaveProperty('monthlyPrice')
      expect(tier).not.toHaveProperty('yearlyPrice')
    }
  })

  it('offers the three self-serve tiers, Scale included', () => {
    expect(PLAN_TIERS.map((t) => t.name)).toEqual(['Free', 'Pro', 'Scale'])
  })

  it('highlights exactly one tier', () => {
    expect(PLAN_TIERS.filter((t) => t.isPopular)).toHaveLength(1)
    expect(PLAN_TIERS.find((t) => t.isPopular)?.id).toBe('pro')
  })

  it('gives every tier features to show', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.features.length).toBeGreaterThan(0)
      expect(tier.description).not.toBe('')
    }
  })

  // The id doubles as the /checkout/{id} segment, so it has to stay
  // URL-clean.
  it('uses lowercase ids safe for the checkout route', () => {
    for (const tier of PLAN_TIERS) {
      expect(tier.id).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })
})

describe('priceTiers', () => {
  it('converts plan cents to dollars by plan name', () => {
    expect(priced.map((t) => [t.id, t.monthlyPrice, t.yearlyPrice])).toEqual([
      ['free', 0, undefined],
      ['pro', 19, 120],
      ['scale', 49, 360],
    ])
  })

  it('matches plan names regardless of casing or padding', () => {
    const tiers = priceTiers([{ name: '  PRO ', monthlyPrice: 1500 }])
    expect(tiers.find((t) => t.id === 'pro')?.monthlyPrice).toBe(15)
  })

  // A wrong number is worse than none: the UI links to the pricing page.
  it('leaves a paid price unknown when the plans are missing', () => {
    for (const plans of [undefined, []]) {
      const tiers = priceTiers(plans)
      expect(tiers.map((t) => t.monthlyPrice)).toEqual([0, undefined, undefined])
      expect(tiers.map((t) => t.yearlyPrice)).toEqual([
        undefined,
        undefined,
        undefined,
      ])
    }
  })

  it('treats a zero or missing price on a paid plan as unknown', () => {
    const tiers = priceTiers([
      { name: 'pro', monthlyPrice: 0, yearlyPrice: 0 },
      { name: 'scale' },
    ])
    expect(tiers.find((t) => t.id === 'pro')?.monthlyPrice).toBeUndefined()
    expect(tiers.find((t) => t.id === 'scale')?.yearlyPrice).toBeUndefined()
  })

  it('ignores plans that are not self-serve tiers', () => {
    const tiers = priceTiers([{ name: 'custom-acme', monthlyPrice: 9900 }])
    expect(tiers.map((t) => t.id)).toEqual(['free', 'pro', 'scale'])
  })
})

describe('formatPlanPrice', () => {
  // "$0" not "Free", so the price does not just repeat the tier name above it.
  it('renders the free tier as a price', () => {
    expect(formatPlanPrice(0)).toBe('$0')
  })

  it('always shows cents on a paid plan', () => {
    expect(formatPlanPrice(9.99)).toBe('$9.99')
    expect(formatPlanPrice(30)).toBe('$30.00')
  })
})

// The yearly saving is quoted to customers, so it is derived from PLAN_TIERS
// and asserted here rather than written into the markup as a literal.
describe('yearly pricing', () => {
  it('derives the per-month equivalent of a yearly plan', () => {
    expect(monthlyEquivalent(pro)).toBe(10)
    expect(monthlyEquivalent(scale)).toBe(30)
  })

  it('has no yearly equivalent for a tier without a yearly price', () => {
    expect(monthlyEquivalent(free)).toBeUndefined()
    expect(yearlySavingPercent(free)).toBeUndefined()
  })

  // 12 x $19 = $228 against $120 is 47.4%; 12 x $49 = $588 against $360 is 38.8%.
  it('quotes a saving the arithmetic actually supports', () => {
    expect(yearlySavingPercent(pro)).toBe(47)
    expect(yearlySavingPercent(scale)).toBe(39)
  })

  it('quotes no saving when either price is unknown', () => {
    expect(yearlySavingPercent({ ...pro, monthlyPrice: undefined })).toBeUndefined()
    expect(yearlySavingPercent({ ...pro, yearlyPrice: undefined })).toBeUndefined()
  })

  // Guards the claim itself: paying yearly must never cost more than monthly.
  it('never quotes a saving on a plan that is not cheaper yearly', () => {
    for (const tier of priced) {
      if (!tier.yearlyPrice || !tier.monthlyPrice) continue
      expect(tier.yearlyPrice).toBeLessThan(tier.monthlyPrice * 12)
    }
  })

  // The picker headlines the month-to-month price, so the caption carries the
  // yearly alternative and must not repeat the headline.
  it('captions a headline price without repeating it', () => {
    expect(formatPriceCaption(pro)).toBe(
      'or $10.00/month billed yearly at $120.00'
    )
    expect(formatPriceCaption(scale)).toBe(
      'or $30.00/month billed yearly at $360.00'
    )
    expect(formatPriceCaption(pro)).not.toContain('$19.00')
  })

  it('captions the free tier without quoting a price', () => {
    expect(formatPriceCaption(free)).toBe('no card required')
  })

  it('captions a paid tier that has no yearly option', () => {
    expect(formatPriceCaption({ ...pro, yearlyPrice: undefined })).toBe(
      'billed monthly'
    )
  })

  it('has no caption for a paid tier with unknown prices', () => {
    expect(
      formatPriceCaption({ ...pro, monthlyPrice: undefined, yearlyPrice: undefined })
    ).toBeUndefined()
  })

  // The caption is the only place the yearly total is quoted, so it has to
  // carry both the total and what it works out to per month.
  it('quotes both the yearly total and its per-month equivalent', () => {
    for (const tier of [pro, scale]) {
      expect(formatPriceCaption(tier)).toContain(
        formatPlanPrice(tier.yearlyPrice!)
      )
      expect(formatPriceCaption(tier)).toContain(
        formatPlanPrice(monthlyEquivalent(tier)!)
      )
    }
  })
})

// Made-up prices, so the arithmetic is checked and not the catalogue.
describe('yearlyMonthsFree', () => {
  const tier = (monthlyPrice?: number, yearlyPrice?: number) => ({
    ...pro,
    monthlyPrice,
    yearlyPrice,
  })

  it('counts whole months saved, rounding down', () => {
    expect(yearlyMonthsFree(tier(10, 100))).toBe(2)
    expect(yearlyMonthsFree(tier(10, 95))).toBe(2)
    expect(yearlyMonthsFree(tier(19, 120))).toBe(5)
  })

  it('is zero when yearly saves less than one month', () => {
    expect(yearlyMonthsFree(tier(10, 115))).toBe(0)
  })

  it('is undefined when either price is unknown or zero', () => {
    expect(yearlyMonthsFree(tier(undefined, 100))).toBeUndefined()
    expect(yearlyMonthsFree(tier(10, undefined))).toBeUndefined()
    expect(yearlyMonthsFree(tier(0, 100))).toBeUndefined()
    expect(yearlyMonthsFree(tier(10, 0))).toBeUndefined()
    expect(yearlyMonthsFree(free)).toBeUndefined()
  })

  it('formats a suffix for the saving badge', () => {
    expect(monthsFreeSuffix(tier(10, 100))).toBe(', 2 months free')
    expect(monthsFreeSuffix(tier(10, 105))).toBe(', 1 month free')
    expect(monthsFreeSuffix(tier(10, 115))).toBe('')
    expect(monthsFreeSuffix(tier(10, undefined))).toBe('')
  })
})

describe('findPlanTier', () => {
  it('is forgiving about casing and whitespace', () => {
    expect(findPlanTier('Pro')?.id).toBe('pro')
    expect(findPlanTier('  SCALE ')?.id).toBe('scale')
  })

  it('returns nothing for an unknown or missing name', () => {
    expect(findPlanTier('enterprise')).toBeUndefined()
    expect(findPlanTier(undefined)).toBeUndefined()
    expect(findPlanTier(null)).toBeUndefined()
    expect(findPlanTier('')).toBeUndefined()
  })
})

// A CTA that omits the interval stops on the chooser instead of continuing to
// the payment page, so the interval is pinned here rather than trusted to each
// call site.
describe('checkoutPath', () => {
  it('always names an interval', () => {
    for (const tier of PLAN_TIERS) {
      expect(checkoutPath(tier.id)).toContain('billingInterval=')
    }
  })

  it('defaults to yearly when the setting is unset', () => {
    expect(DEFAULT_CHECKOUT_INTERVAL).toBe('yearly')
    expect(checkoutPath('pro')).toBe('/checkout/pro?billingInterval=yearly')
    expect(checkoutPath('scale')).toBe('/checkout/scale?billingInterval=yearly')
  })

  // Yearly is not on offer there, so the default must not pick it.
  it('falls back to monthly for a tier without yearly billing', () => {
    expect(checkoutPath('free')).toBe('/checkout/free?billingInterval=monthly')
    expect(checkoutPath('custom-acme')).toBe(
      '/checkout/custom-acme?billingInterval=monthly'
    )
  })

  it('adds the placement after the interval', () => {
    expect(checkoutPath('pro', 'monthly', 'app_get_started')).toBe(
      '/checkout/pro?billingInterval=monthly&from=app_get_started'
    )
    expect(checkoutPath('scale', undefined, 'app_usage_alert')).toBe(
      '/checkout/scale?billingInterval=yearly&from=app_usage_alert'
    )
  })

  it('carries an explicit interval through', () => {
    expect(checkoutPath('pro', 'yearly')).toBe(
      '/checkout/pro?billingInterval=yearly'
    )
    expect(checkoutPath('pro', 'monthly')).toBe(
      '/checkout/pro?billingInterval=monthly'
    )
  })
})

// The constant is read once at module load, so each case loads a fresh copy.
describe('NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const load = async (value: string | undefined) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL
    else vi.stubEnv('NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL', value)
    vi.resetModules()
    return import('./plans')
  }

  it('switches the default to monthly when set to exactly monthly', async () => {
    const plans = await load('monthly')
    expect(plans.DEFAULT_CHECKOUT_INTERVAL).toBe('monthly')
    expect(plans.checkoutPath('pro')).toBe('/checkout/pro?billingInterval=monthly')
    expect(plans.checkoutPath('pro', 'yearly')).toBe(
      '/checkout/pro?billingInterval=yearly'
    )
  })

  it.each([undefined, '', 'yearly', 'Monthly', 'weekly'])(
    'defaults to yearly for %j',
    async (value) => {
      const plans = await load(value)
      expect(plans.DEFAULT_CHECKOUT_INTERVAL).toBe('yearly')
      expect(plans.checkoutPath('scale')).toBe(
        '/checkout/scale?billingInterval=yearly'
      )
    }
  )
})

// Mirrors the published refund policy. Quoting a longer window than we honour
// would be a promise we do not keep.
describe('MONEY_BACK_DAYS', () => {
  it('matches the refund policy for each interval', () => {
    expect(MONEY_BACK_DAYS.monthly).toBe(7)
    expect(MONEY_BACK_DAYS.yearly).toBe(14)
  })
})

describe('promotion', () => {
  const promoted = (over: Record<string, unknown> = {}) =>
    priceTiers(mockBillingPlansWithPromotion(over)).find((t) => t.id === 'pro')!

  it('carries the promotion through priceTiers in dollars', () => {
    expect(promoted().promotion).toEqual({
      label: 'Spring offer',
      percentOff: 20,
      endsAt: '2030-04-01T06:59:59.000Z',
      duration: 'forever',
      durationInMonths: null,
      monthlyPrice: 15.2,
      yearlyPrice: 96,
    })
  })

  it('adds no promotion when the API sends none', () => {
    for (const tier of priced) expect(tier).not.toHaveProperty('promotion')
    const tiers = priceTiers(mockBillingPlansWithPromotion())
    expect(tiers.find((t) => t.id === 'scale')).not.toHaveProperty('promotion')
    expect(tiers.find((t) => t.id === 'free')).not.toHaveProperty('promotion')
  })

  it('drops a promotion without a sale price or a percentage', () => {
    expect(promoted({ monthlyPrice: null, yearlyPrice: null }).promotion).toBeUndefined()
    expect(promoted({ percentOff: 0 }).promotion).toBeUndefined()
  })

  it('gives the sale price per interval, and none for an uncovered one', () => {
    const tier = promoted({ monthlyPrice: null })
    expect(salePriceFor(tier, 'yearly')).toBe(96)
    expect(salePriceFor(tier, 'monthly')).toBeUndefined()
    expect(salePriceFor(pro, 'yearly')).toBeUndefined()
  })

  it('sells the yearly interval unless only monthly is on sale', () => {
    expect(promotionInterval(promoted())).toBe('yearly')
    expect(promotionInterval(promoted({ yearlyPrice: null }))).toBe('monthly')
  })

  it('formats the end as a Pacific date', () => {
    expect(formatPromotionEnd('2030-04-01T06:59:59.000Z')).toBe('March 31')
    expect(formatPromotionEnd('2030-06-01T06:59:59.000Z')).toBe('May 31')
    expect(formatPromotionEnd(null)).toBeUndefined()
    expect(formatPromotionEnd('not a date')).toBeUndefined()
  })

  it.each([
    [{}, '', 'Stays while you stay subscribed.'],
    [{ duration: 'repeating', durationInMonths: 3 }, 'for 3 months', 'Sale price for the first 3 months.'],
    [{ duration: 'repeating', durationInMonths: 1 }, 'for 1 month', 'Sale price for the first month.'],
    [{ duration: 'once' }, 'on the first payment', 'Sale price on the first payment.'],
  ])('describes the duration of %j', (over, label, note) => {
    const promotion = promoted(over).promotion!
    expect(promotionDurationLabel(promotion)).toBe(label)
    expect(promotionDurationNote(promotion)).toBe(note)
  })

  it('names the term, not the end, for a discount with a set length', () => {
    const promotion = promoted({ duration: 'repeating', durationInMonths: 3 }).promotion!
    expect(promotionOffer(promotion)).toBe('20% off for 3 months')
    expect(promotionEndNote(promotion)).toBe('Offer ends March 31. Applied at checkout.')
    expect(promotionOffer(promoted({ duration: 'once' }).promotion!)).toBe(
      '20% off on the first payment'
    )
    expect(promotionLine(promotion, 'Pro')).toBe(
      'Spring offer: 20% off Pro, for 3 months. Ends March 31.'
    )
  })

  it('leaves the end out of the offer when asked', () => {
    expect(promotionOffer(promoted().promotion!, false)).toBe('20% off')
  })

  it('builds the chip, end note and limit line from the data', () => {
    const promotion = promoted().promotion!
    expect(promotionChip(promotion)).toBe('Spring offer · 20% off until March 31')
    expect(promotionEndNote(promotion)).toBe('Applied at checkout.')
    expect(promotionLine(promotion, 'Pro')).toBe('Spring offer: 20% off Pro until March 31.')
  })

  it('leaves the date out when the promotion has no end', () => {
    const promotion = promoted({ endsAt: null }).promotion!
    expect(promotionEndNote(promotion)).toBe('Applied at checkout.')
    expect(promotionLine(promotion, 'Pro')).toBe('Spring offer: 20% off Pro.')
    expect(promotionChip(promotion)).toBe('Spring offer · 20% off')
  })
})
