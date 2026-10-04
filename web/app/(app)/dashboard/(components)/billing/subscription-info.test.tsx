import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import SubscriptionInfo from './subscription-info'

const useSubscription = vi.fn()
const useCurrentUser = vi.fn()

vi.mock('@/lib/api', () => ({
  useSubscription: () => useSubscription(),
  useCurrentUser: () => useCurrentUser(),
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

// The payload billing.service.ts synthesises for a user with no subscription:
// a plan and usage, and deliberately no status, amount or dates.
const freeSubscription = {
  plan: {
    name: 'free',
    dailyLimit: 50,
    monthlyLimit: 300,
    bulkSendLimit: 50,
    deviceLimit: 1,
  },
  isActive: true,
  usage: {
    dailyLimit: 50,
    monthlyLimit: 300,
    bulkSendLimit: 50,
    deviceLimit: 1,
    processedSmsToday: 4,
    processedSmsLastMonth: 40,
    dailyRemaining: 46,
    monthlyRemaining: 260,
    dailyUsagePercentage: 8,
    monthlyUsagePercentage: 13,
  },
}

const proSubscription = {
  plan: { name: 'Pro', dailyLimit: -1, monthlyLimit: 5000, deviceLimit: 5 },
  usage: { monthlyLimit: 5000, processedSmsLastMonth: 500 },
  status: 'active',
  amount: 999,
  currency: 'usd',
  recurringInterval: 'month',
  subscriptionStartDate: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-08-01T00:00:00.000Z',
}

const setSubscription = (data: unknown) =>
  useSubscription.mockReturnValue({ data, isLoading: false, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  useCurrentUser.mockReturnValue({ data: { email: 'user@example.com' } })
  setSubscription(proSubscription)
})

describe('SubscriptionInfo', () => {
  describe('a free account', () => {
    beforeEach(() => setSubscription(freeSubscription))

    // The reported defect. A free user has no subscription, so the page was
    // reading a payload with no status as a subscription whose status was
    // unknown.
    it('never says the status is Unknown', () => {
      render(<SubscriptionInfo />)
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
    })

    it('names the plan and says there is nothing to pay', () => {
      render(<SubscriptionInfo />)

      expect(
        screen.getByRole('heading', { name: 'Free' })
      ).toBeInTheDocument()
      expect(screen.getByText('$0')).toBeInTheDocument()
      expect(screen.getByText(/nothing to pay/i)).toBeInTheDocument()
    })

    // Both dates were always "N/A" for a free account, which is noise, not
    // information.
    it('hides the billing dates it has no values for', () => {
      render(<SubscriptionInfo />)

      expect(screen.queryByText('Start date')).not.toBeInTheDocument()
      expect(screen.queryByText('Next payment')).not.toBeInTheDocument()
      expect(screen.queryByText('N/A')).not.toBeInTheDocument()
    })

    it('offers no customer portal, since there is nothing to manage', () => {
      render(<SubscriptionInfo />)
      expect(
        screen.queryByRole('link', { name: /Manage subscription/i })
      ).not.toBeInTheDocument()
    })

    it('sells the next tier up', () => {
      render(<SubscriptionInfo />)
      expect(
        screen.getByRole('link', { name: /Upgrade to Pro/ })
      ).toHaveAttribute('href', '/checkout/pro?billingInterval=monthly')
    })

    it('still shows the plan limits', () => {
      render(<SubscriptionInfo />)
      expect(screen.getByText('Daily')).toBeInTheDocument()
      expect(screen.getByText('Monthly')).toBeInTheDocument()
    })
  })

  describe('a Pro subscriber', () => {
    it('shows the real status with a matching icon', () => {
      render(<SubscriptionInfo />)
      expect(screen.getByText('Active')).toBeInTheDocument()
    })

    it('shows the price actually charged', () => {
      render(<SubscriptionInfo />)
      expect(screen.getByText('$9.99')).toBeInTheDocument()
      expect(screen.getByText(/monthly/)).toBeInTheDocument()
    })

    it('shows both billing dates', () => {
      render(<SubscriptionInfo />)
      expect(screen.getByText('Start date')).toBeInTheDocument()
      expect(screen.getByText('Next payment')).toBeInTheDocument()
    })

    it('sells Scale, not Pro again', () => {
      render(<SubscriptionInfo />)

      expect(
        screen.getByRole('link', { name: /Upgrade to Scale/ })
      ).toHaveAttribute('href', '/checkout/scale?billingInterval=monthly')
      expect(
        screen.queryByRole('link', { name: /Upgrade to Pro/ })
      ).not.toBeInTheDocument()
    })

    it('links the customer portal with the signed-in email', () => {
      render(<SubscriptionInfo />)

      const portal = screen.getByRole('link', { name: /Manage subscription/i })
      expect(portal).toHaveAttribute(
        'href',
        expect.stringContaining('user%40example.com')
      )
      // window.opener would otherwise stay live on an external billing page.
      expect(portal).toHaveAttribute('rel', 'noopener noreferrer')
    })
  })

  describe('a Scale subscriber', () => {
    beforeEach(() =>
      setSubscription({
        plan: { name: 'Scale' },
        status: 'active',
        amount: 2999,
        currency: 'usd',
      })
    )

    it('is not sold a tier that does not exist', () => {
      render(<SubscriptionInfo />)
      expect(
        screen.queryByRole('link', { name: /Upgrade to/ })
      ).not.toBeInTheDocument()
    })

    it('can still reach the portal and the pricing page', () => {
      render(<SubscriptionInfo />)
      expect(
        screen.getByRole('link', { name: /Manage subscription/i })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: /Compare all plans/ })
      ).toBeInTheDocument()
    })
  })

  describe('a subscriber scheduled to cancel', () => {
    beforeEach(() =>
      setSubscription({ ...proSubscription, cancelAtPeriodEnd: true })
    )

    it('shows when access ends instead of a next payment', () => {
      render(<SubscriptionInfo />)

      expect(screen.getByText('Access ends')).toBeInTheDocument()
      expect(screen.queryByText('Next payment')).not.toBeInTheDocument()
    })

    it('says the plan will not renew and when it ends', () => {
      render(<SubscriptionInfo />)

      const notice = screen.getByText(/will not renew/)
      expect(notice).toHaveTextContent('Aug 1, 2026')
      expect(notice).toHaveTextContent('moves to Free')
    })

    it('shows the cancellation in the status pill', () => {
      render(<SubscriptionInfo />)

      expect(screen.getByText('Canceled')).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })

    it('offers to renew through the customer portal', () => {
      render(<SubscriptionInfo />)

      expect(
        screen.getByRole('link', { name: /Renew subscription/ })
      ).toHaveAttribute('href', expect.stringContaining('user%40example.com'))
    })
  })

  describe('a past due subscriber', () => {
    beforeEach(() =>
      setSubscription({ ...proSubscription, status: 'past_due' })
    )

    // The pill used to hardcode a check mark, so bad news arrived with a tick
    // next to it.
    it('reports the real status rather than reassuring the user', () => {
      render(<SubscriptionInfo />)

      expect(screen.getByText('Past Due')).toBeInTheDocument()
      expect(screen.queryByText('Active')).not.toBeInTheDocument()
    })
  })

  // A paid plan whose payload genuinely lost its status is a different case
  // from a free account, and must not be quietly reported as either Active or
  // Free.
  it('still says Unknown for a paid plan missing its status', () => {
    setSubscription({ plan: { name: 'Pro' }, amount: 999, currency: 'usd' })
    render(<SubscriptionInfo />)

    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('always offers the pricing page', () => {
    setSubscription(freeSubscription)
    render(<SubscriptionInfo />)

    expect(
      screen.getByRole('link', { name: /Compare all plans/ })
    ).toHaveAttribute('href', 'https://textbee.dev/pricing')
  })

  // The loading state used to be a 16px spinner alone in the content column,
  // which read as a blank tab while the subscription loaded.
  it('shows a visible loading skeleton while the subscription loads', () => {
    useSubscription.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })
    render(<SubscriptionInfo />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading subscription'
    )
  })

  it('renders an error state rather than an empty card', () => {
    useSubscription.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    })
    render(<SubscriptionInfo />)

    expect(screen.getByText(/Failed to load subscription/i)).toBeInTheDocument()
  })
})
