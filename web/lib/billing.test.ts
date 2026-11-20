import { describe, expect, it } from 'vitest'
import {
  mockBillingPlans,
  mockBillingPlansWithPromotion,
} from '@/test/fixtures'
import {
  billingPriceLabel,
  deriveBillingState,
  freePromotionEligible,
  promotionEligible,
  yearlySwitchTier,
} from './billing'

// The exact shape billing.service.ts synthesises when findOne turns up no
// subscription: a plan and usage, no status, no amount, no dates.
const freePayload = {
  plan: { name: 'free', dailyLimit: 50, monthlyLimit: 300 },
  isActive: true,
  usage: { processedSmsToday: 3 },
}

const proPayload = {
  plan: { name: 'Pro' },
  status: 'active',
  amount: 999,
  currency: 'usd',
  recurringInterval: 'month',
  subscriptionStartDate: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-08-01T00:00:00.000Z',
}

describe('deriveBillingState', () => {
  // The defect this helper exists for: a free user was shown "Unknown".
  it('reads the no-subscription payload as Free, not as unknown', () => {
    const state = deriveBillingState(freePayload)

    expect(state.isFree).toBe(true)
    expect(state.status).toBeUndefined()
    expect(state.planName).toBe('Free')
  })

  it('treats a missing subscription entirely as Free', () => {
    expect(deriveBillingState(undefined).isFree).toBe(true)
    expect(deriveBillingState({}).isFree).toBe(true)
  })

  // Absence of a status means "no subscription". A status that is absent from
  // a payload that clearly IS a paid plan is a different thing, and must not
  // be quietly downgraded to Free.
  it('does not flatten a paid plan with a missing status into Free', () => {
    const state = deriveBillingState({ plan: { name: 'Pro' } })

    expect(state.isFree).toBe(false)
    expect(state.planName).toBe('Pro')
  })

  it('reads a real subscription without changing its status', () => {
    const state = deriveBillingState(proPayload)

    expect(state.isFree).toBe(false)
    expect(state.status).toBe('active')
    expect(state.planName).toBe('Pro')
  })

  it('uses the marketing casing rather than whatever the DB stored', () => {
    expect(deriveBillingState(freePayload).planName).toBe('Free')
    expect(deriveBillingState({ plan: { name: '  SCALE ' } }).planName).toBe(
      'Scale'
    )
  })

  describe('upgradeTier', () => {
    it('sells Pro to a free user', () => {
      expect(deriveBillingState(freePayload).upgradeTier?.id).toBe('pro')
    })

    it('sells Scale to a Pro user', () => {
      expect(deriveBillingState(proPayload).upgradeTier?.id).toBe('scale')
    })

    it('sells nothing at the top of the ladder', () => {
      const state = deriveBillingState({
        plan: { name: 'Scale' },
        status: 'active',
      })
      expect(state.upgradeTier).toBeUndefined()
    })

    // A bespoke arrangement is not on the self-serve ladder, so pushing it up
    // one rung would be wrong in both directions.
    it('sells nothing for an unrecognised plan', () => {
      const state = deriveBillingState({
        plan: { name: 'Enterprise' },
        status: 'active',
      })
      expect(state.upgradeTier).toBeUndefined()
      expect(state.planName).toBe('Enterprise')
    })
  })

  describe('hasBillingDates', () => {
    it('is false for a free account, which has no dates to show', () => {
      expect(deriveBillingState(freePayload).hasBillingDates).toBe(false)
    })

    it('is true once a subscription carries a date', () => {
      expect(deriveBillingState(proPayload).hasBillingDates).toBe(true)
    })
  })

  describe('isCanceling', () => {
    it('is true for a paid subscription set to cancel at period end', () => {
      expect(
        deriveBillingState({ ...proPayload, cancelAtPeriodEnd: true })
          .isCanceling
      ).toBe(true)
    })

    it('is false when the subscription renews', () => {
      expect(deriveBillingState(proPayload).isCanceling).toBe(false)
      expect(
        deriveBillingState({ ...proPayload, cancelAtPeriodEnd: false })
          .isCanceling
      ).toBe(false)
    })

    it('is false for a free account', () => {
      expect(
        deriveBillingState({ ...freePayload, cancelAtPeriodEnd: true })
          .isCanceling
      ).toBe(false)
    })
  })

  describe('canManageBilling', () => {
    it('is false for a free account with nothing to manage', () => {
      expect(deriveBillingState(freePayload).canManageBilling).toBe(false)
    })

    it('is true for a subscriber', () => {
      expect(deriveBillingState(proPayload).canManageBilling).toBe(true)
    })
  })
})

describe('billingPriceLabel', () => {
  it('returns the amount for a paying customer', () => {
    expect(billingPriceLabel(proPayload)).toBe(999)
  })

  it('returns nothing when there is no charge', () => {
    expect(billingPriceLabel(freePayload)).toBeNull()
    expect(billingPriceLabel({ amount: 0 })).toBeNull()
    expect(billingPriceLabel(undefined)).toBeNull()
  })
})

describe('yearlySwitchTier', () => {
  const monthly = {
    plan: { name: 'Pro' },
    status: 'active',
    recurringInterval: 'month',
    cancelAtPeriodEnd: false,
  }

  it('offers the current tier, priced, to an active monthly subscriber', () => {
    const tier = yearlySwitchTier(monthly, mockBillingPlans)
    expect(tier?.id).toBe('pro')
    expect(tier?.yearlyPrice).toBe(120)
    expect(
      yearlySwitchTier({ ...monthly, recurringInterval: 'monthly' }, mockBillingPlans)?.id
    ).toBe('pro')
  })

  it.each([
    ['no subscription', undefined],
    ['a yearly subscription', { ...monthly, recurringInterval: 'year' }],
    ['a past due subscription', { ...monthly, status: 'past_due' }],
    ['a canceling subscription', { ...monthly, cancelAtPeriodEnd: true }],
    ['a custom plan', { ...monthly, plan: { name: 'custom-acme' } }],
    ['a free account', { plan: { name: 'free' } }],
  ])('offers nothing for %s', (_label, subscription) => {
    expect(yearlySwitchTier(subscription, mockBillingPlans)).toBeUndefined()
  })

  describe('saving against the current monthly charge', () => {
    it('uses the list saving for a list-price payer', () => {
      expect(yearlySwitchTier({ ...monthly, amount: 1900 }, mockBillingPlans)).toMatchObject({
        id: 'pro',
        savingPercent: 47,
        monthsFree: 5,
      })
    })

    it('uses the list price when the charge is unknown', () => {
      expect(yearlySwitchTier(monthly, mockBillingPlans)).toMatchObject({
        savingPercent: 47,
        monthsFree: 5,
      })
      expect(yearlySwitchTier({ ...monthly, amount: 0 }, mockBillingPlans)).toMatchObject({
        savingPercent: 47,
      })
    })

    it('shows a lower saving to a payer on an older, lower price', () => {
      expect(yearlySwitchTier({ ...monthly, amount: 1100 }, mockBillingPlans)).toMatchObject({
        id: 'pro',
        savingPercent: 9,
        monthsFree: 1,
      })
    })

    it('offers nothing when yearly would cost a discounted payer more', () => {
      expect(yearlySwitchTier({ ...monthly, amount: 900 }, mockBillingPlans)).toBeUndefined()
    })

    it('offers nothing when the saving rounds to 0', () => {
      expect(yearlySwitchTier({ ...monthly, amount: 1002 }, mockBillingPlans)).toBeUndefined()
    })
  })

  it('offers nothing while either price is unknown', () => {
    expect(yearlySwitchTier(monthly, undefined)).toBeUndefined()
    expect(
      yearlySwitchTier(monthly, [{ name: 'pro', monthlyPrice: 1900 }])
    ).toBeUndefined()
    expect(
      yearlySwitchTier(monthly, [{ name: 'pro', yearlyPrice: 12000 }])
    ).toBeUndefined()
  })
})

describe('promotionEligible', () => {
  it('is false while the subscription is loading', () => {
    expect(promotionEligible(undefined)).toBe(false)
  })

  it('is true for a free account', () => {
    expect(promotionEligible(freePayload)).toBe(true)
  })

  it('is true for a paid subscription without a discount', () => {
    expect(promotionEligible(proPayload)).toBe(true)
  })

  it('is false for a paid subscription that has a discount', () => {
    expect(promotionEligible({ ...proPayload, discountId: 'disc_1' })).toBe(false)
  })

  it('is false for a custom plan', () => {
    expect(promotionEligible({ ...proPayload, plan: { name: 'custom-100' } })).toBe(false)
  })
})

describe('freePromotionEligible', () => {
  it('is true only for a free account', () => {
    expect(freePromotionEligible(undefined)).toBe(false)
    expect(freePromotionEligible(freePayload)).toBe(true)
    expect(freePromotionEligible(proPayload)).toBe(false)
  })
})

describe('yearlySwitchTier with a live promotion', () => {
  it('prices the switch at the sale price', () => {
    const tier = yearlySwitchTier(proPayload, mockBillingPlansWithPromotion())

    expect(tier?.salePrice).toBe(96)
    expect(tier?.savingPercent).toBe(20)
  })

  it('keeps the list price for a subscription that has a discount', () => {
    const tier = yearlySwitchTier(
      { ...proPayload, discountId: 'disc_1' },
      mockBillingPlansWithPromotion()
    )

    expect(tier?.salePrice).toBeUndefined()
  })
})
