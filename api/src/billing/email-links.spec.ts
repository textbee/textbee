import { BillingService } from './billing.service'
import { signLink } from '../mail/email-render'

describe('BillingService - signed email links', () => {
  const secret = 'link-secret'
  const env = { ...process.env }
  const nowS = () => Math.floor(Date.now() / 1000)
  const BILLING = 'https://app.textbee.dev/dashboard/account/billing'

  const build = ({
    subscription = null as any,
    session = null as any,
    plan = null as any,
    promotion = null as any,
  } = {}) => {
    const subscriptionModel = { findOne: jest.fn().mockResolvedValue(subscription) }
    const checkoutSessionModel = { findOne: jest.fn().mockResolvedValue(session) }
    const service = new BillingService(
      { findOne: jest.fn().mockResolvedValue(plan) } as any,
      subscriptionModel as any,
      {} as any,
      {} as any,
      {} as any,
      checkoutSessionModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getLivePromotion: async () => promotion } as any,
    )
    const create = jest.fn().mockResolvedValue({
      customer_portal_url: 'https://polar.test/portal/abc',
    })
    ;(service as any).polarApi = { customerSessions: { create } }
    return { service, subscriptionModel, checkoutSessionModel, create }
  }

  beforeEach(() => {
    process.env = { ...env, EMAIL_LINK_SECRET: secret }
    delete process.env.APP_PUBLIC_URL
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    process.env = env
    jest.restoreAllMocks()
  })

  describe('card update', () => {
    const token = (exp = nowS() + 3600) => signLink(secret, 'card', 'sub_1', exp)

    it('opens the customer portal for a valid link', async () => {
      const { service, subscriptionModel, create } = build({
        subscription: { polarCustomerId: 'cus_1' },
      })

      await expect(service.cardUpdateRedirect(token())).resolves.toBe(
        'https://polar.test/portal/abc',
      )
      expect(subscriptionModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ polarSubscriptionId: 'sub_1' }),
      )
      expect(create).toHaveBeenCalledWith({ customer_id: 'cus_1', return_url: BILLING })
    })

    it.each([
      ['expired', () => token(nowS() - 1)],
      ['tampered', () => token().slice(0, -2) + 'xx'],
      ['for another purpose', () => signLink(secret, 'unsubscribe', 'sub_1', 0)],
      ['missing', () => undefined],
    ])('sends an %s link to the billing page', async (_label, make) => {
      const { service, create } = build({ subscription: { polarCustomerId: 'cus_1' } })

      await expect(service.cardUpdateRedirect(make())).resolves.toBe(BILLING)
      expect(create).not.toHaveBeenCalled()
    })

    it('sends the reader to the billing page when the provider call fails', async () => {
      const { service, create } = build({ subscription: { polarCustomerId: 'cus_1' } })
      create.mockRejectedValue(new Error('down'))

      await expect(service.cardUpdateRedirect(token())).resolves.toBe(BILLING)
    })

    it('does nothing without a secret', async () => {
      delete process.env.EMAIL_LINK_SECRET
      const { service, subscriptionModel } = build()

      await expect(service.cardUpdateRedirect(token())).resolves.toBe(BILLING)
      expect(subscriptionModel.findOne).not.toHaveBeenCalled()
    })
  })

  describe('checkout resume', () => {
    const token = (exp = nowS() + 3600) => signLink(secret, 'checkout-resume', 'co_1', exp)
    const open = {
      checkoutUrl: 'https://polar.test/checkout/co_1',
      planName: 'scale',
      billingInterval: 'yearly',
      expiresAt: new Date(Date.now() + 3600_000),
      isCompleted: false,
      isAbandoned: false,
    }

    it('returns to the open checkout', async () => {
      const { service, checkoutSessionModel } = build({ session: open })

      await expect(service.checkoutResumeRedirect(token())).resolves.toBe(open.checkoutUrl)
      expect(checkoutSessionModel.findOne).toHaveBeenCalledWith({ checkoutSessionId: 'co_1' })
    })

    it.each([
      ['expired', { expiresAt: new Date(Date.now() - 1000) }],
      ['completed', { isCompleted: true }],
    ])('starts a new checkout for the same plan when the session is %s', async (_l, change) => {
      const { service } = build({ session: { ...open, ...change } })

      await expect(service.checkoutResumeRedirect(token())).resolves.toBe(
        'https://app.textbee.dev/checkout/scale?billingInterval=yearly&from=email&ref=checkout_resume',
      )
    })

    describe('with a live promotion', () => {
      const plan = { name: 'scale', polarMonthlyProductId: 'prod_m', polarYearlyProductId: 'prod_y' }
      const promotion = { discount: { id: 'disc_live', products: [{ id: 'prod_y' }] } }
      const fresh =
        'https://app.textbee.dev/checkout/scale?billingInterval=yearly&from=email&ref=checkout_resume'

      it('returns to an open checkout that carries the live discount', async () => {
        const { service } = build({
          session: { ...open, discountId: 'disc_live' },
          plan,
          promotion,
        })

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(open.checkoutUrl)
      })

      it.each([
        ['completed', { isCompleted: true }],
        ['abandoned', { isAbandoned: true }],
        ['expired', { expiresAt: new Date(Date.now() - 1000) }],
      ])('starts a new checkout when the session was %s during the discount check', async (_l, change) => {
        const session = { ...open, discountId: 'disc_live' }
        const { service, checkoutSessionModel } = build({ session, plan, promotion })
        checkoutSessionModel.findOne
          .mockResolvedValueOnce(session)
          .mockResolvedValueOnce({ ...session, ...change })

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(fresh)
        expect(checkoutSessionModel.findOne).toHaveBeenCalledTimes(2)
      })

      it('starts a new checkout when the open one predates the discount', async () => {
        const { service } = build({ session: open, plan, promotion })

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(fresh)
      })

      it('starts a new checkout when the open one carries another discount', async () => {
        const { service } = build({
          session: { ...open, discountId: 'disc_old' },
          plan,
          promotion,
        })

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(fresh)
      })

      it('returns to an open checkout without a discount when the promotion skips its product', async () => {
        const { service } = build({
          session: { ...open, billingInterval: 'monthly', discountId: null },
          plan,
          promotion,
        })

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(open.checkoutUrl)
      })
    })

    it('starts a new checkout when the open one carries a discount that ended', async () => {
      const { service } = build({ session: { ...open, discountId: 'disc_old' } })

      await expect(service.checkoutResumeRedirect(token())).resolves.toBe(
        'https://app.textbee.dev/checkout/scale?billingInterval=yearly&from=email&ref=checkout_resume',
      )
    })

    it('keeps a monthly session monthly', async () => {
      process.env.DEFAULT_BILLING_INTERVAL = 'yearly'
      const { service } = build({
        session: { ...open, billingInterval: 'monthly', isCompleted: true },
      })

      await expect(service.checkoutResumeRedirect(token())).resolves.toBe(
        'https://app.textbee.dev/checkout/scale?billingInterval=monthly&from=email&ref=checkout_resume',
      )
    })

    it.each([
      ['unset', undefined, 'yearly'],
      ['monthly', 'monthly', 'monthly'],
    ])(
      'defaults to Pro on the default interval when the session is gone and the setting is %s',
      async (_l, setting, interval) => {
        delete process.env.DEFAULT_BILLING_INTERVAL
        if (setting) process.env.DEFAULT_BILLING_INTERVAL = setting
        const { service } = build()

        await expect(service.checkoutResumeRedirect(token())).resolves.toBe(
          `https://app.textbee.dev/checkout/pro?billingInterval=${interval}&from=email&ref=checkout_resume`,
        )
      },
    )

    it('uses the default interval when the session has none', async () => {
      process.env.DEFAULT_BILLING_INTERVAL = 'monthly'
      const { service } = build({
        session: { ...open, billingInterval: undefined, isCompleted: true },
      })

      await expect(service.checkoutResumeRedirect(token())).resolves.toBe(
        'https://app.textbee.dev/checkout/scale?billingInterval=monthly&from=email&ref=checkout_resume',
      )
    })

    it.each([
      ['expired', () => token(nowS() - 1)],
      ['tampered', () => token().replace(/^./, 'x')],
    ])('sends an %s link to the billing page', async (_l, make) => {
      const { service, checkoutSessionModel } = build({ session: open })

      await expect(service.checkoutResumeRedirect(make())).resolves.toBe(BILLING)
      expect(checkoutSessionModel.findOne).not.toHaveBeenCalled()
    })
  })

  describe('switch to yearly', () => {
    const token = (exp = nowS() + 3600) => signLink(secret, 'yearly', 'sub_1', exp)
    const plan = {
      name: 'pro',
      monthlyPrice: 1500,
      yearlyPrice: 12000,
      polarYearlyProductId: 'prod_pro_y',
    }
    const active = {
      status: 'active',
      recurringInterval: 'month',
      polarCustomerId: 'cus_1',
      plan,
    }
    const YEARLY =
      'https://app.textbee.dev/checkout/pro?billingInterval=yearly&from=email&ref=yearly_switch'
    const BILLING_RETURN = `${BILLING}?from=email&ref=yearly_switch`

    const buildYearly = (subscription: any) => {
      const built = build()
      const populate = jest.fn().mockResolvedValue(subscription)
      built.subscriptionModel.findOne = jest.fn(() => ({ populate })) as any
      return { ...built, populate }
    }

    it.each([
      ['expired', () => token(nowS() - 1)],
      ['tampered', () => token().slice(0, -2) + 'xx'],
      ['for another purpose', () => signLink(secret, 'card', 'sub_1', nowS() + 3600)],
      ['missing', () => undefined],
    ])('sends an %s link to the billing page', async (_label, make) => {
      const { service, subscriptionModel } = buildYearly(active)

      await expect(service.yearlySwitchRedirect(make())).resolves.toBe(BILLING)
      expect(subscriptionModel.findOne).not.toHaveBeenCalled()
    })

    it('loads the active subscription by its provider id, with its plan', async () => {
      const { service, subscriptionModel, populate } = buildYearly(active)

      await service.yearlySwitchRedirect(token())

      expect(subscriptionModel.findOne).toHaveBeenCalledWith({
        polarSubscriptionId: 'sub_1',
        isActive: true,
      })
      expect(populate).toHaveBeenCalledWith('plan')
    })

    it.each([
      ['there is no subscription', null],
      ['the plan is custom', { ...active, plan: { ...plan, name: 'custom-acme' } }],
      ['the plan has no yearly product', { ...active, plan: { name: 'pro' } }],
      ['yearly costs a discounted payer more', { ...active, amount: 900 }],
      ['the saving rounds to 0', { ...active, amount: 1002 }],
      ['the subscription is yearly', { ...active, recurringInterval: 'year', amount: 12000 }],
      ['the billing period is unknown', { ...active, recurringInterval: undefined }],
      ['the subscription is canceling', { ...active, cancelAtPeriodEnd: true }],
      ['the subscription is unpaid', { ...active, status: 'unpaid' }],
      ['the subscription is incomplete', { ...active, status: 'incomplete' }],
      ['the plan has no yearly price', { ...active, plan: { ...plan, yearlyPrice: undefined } }],
    ])('sends the reader to the billing page when %s', async (_label, subscription) => {
      const { service, create } = buildYearly(subscription)

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(BILLING)
      expect(create).not.toHaveBeenCalled()
    })

    it('opens the yearly confirm screen for the current plan', async () => {
      const { service, create } = buildYearly(active)

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(YEARLY)
      expect(create).not.toHaveBeenCalled()
    })

    it.each([
      ['a list-price payer', 1500],
      ['a payer on an older, lower price', 1100],
      ['a payer with no stored charge', undefined],
    ])('opens the yearly confirm screen for %s', async (_label, amount) => {
      const { service } = buildYearly({ ...active, amount })

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(YEARLY)
    })

    it('encodes the plan name in the checkout path', async () => {
      const { service } = buildYearly({ ...active, plan: { ...plan, name: 'pro plus' } })

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(
        'https://app.textbee.dev/checkout/pro%20plus?billingInterval=yearly&from=email&ref=yearly_switch',
      )
    })

    it('sends a past due customer to fix the card first, then to the billing page', async () => {
      const { service, create } = buildYearly({ ...active, status: 'past_due' })

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(
        'https://polar.test/portal/abc',
      )
      expect(create).toHaveBeenCalledWith({ customer_id: 'cus_1', return_url: BILLING_RETURN })
    })

    it('skips the portal for a past due subscription with no customer id', async () => {
      const { service, create } = buildYearly({
        ...active,
        status: 'past_due',
        polarCustomerId: undefined,
      })

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(YEARLY)
      expect(create).not.toHaveBeenCalled()
    })

    it.each([
      ['the provider call fails', (create: jest.Mock) => create.mockRejectedValue(new Error('down'))],
      [
        'the portal url is not https',
        (create: jest.Mock) =>
          create.mockResolvedValue({ customer_portal_url: 'http://polar.test/portal/abc' }),
      ],
    ])('goes straight to the yearly confirm screen when %s', async (_label, arrange) => {
      const { service, create } = buildYearly({ ...active, status: 'past_due' })
      arrange(create)

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(YEARLY)
    })

    it('sends the reader to the billing page when the lookup fails', async () => {
      const { service, populate } = buildYearly(active)
      populate.mockRejectedValue(new Error('db down'))

      await expect(service.yearlySwitchRedirect(token())).resolves.toBe(BILLING)
    })
  })
})
