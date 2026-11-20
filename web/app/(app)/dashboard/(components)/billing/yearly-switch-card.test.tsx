import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import YearlySwitchCard from './yearly-switch-card'

const useBillingPlans = vi.fn()
vi.mock('@/lib/api', () => ({
  useBillingPlans: () => useBillingPlans(),
}))

const post = vi.fn()
vi.mock('@/lib/httpBrowserClient', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}))

// Fixture prices: Pro $19.00 or $120.00 yearly.
const monthlyPro = {
  plan: { name: 'Pro' },
  status: 'active',
  recurringInterval: 'month',
  cancelAtPeriodEnd: false,
}

const originalLocation = window.location

beforeEach(() => {
  vi.clearAllMocks()
  useBillingPlans.mockReturnValue({ data: mockBillingPlans, isPending: false })
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  })
})
afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

describe('YearlySwitchCard', () => {
  it('offers the sale price when a live promotion covers yearly', () => {
    useBillingPlans.mockReturnValue({
      data: mockBillingPlansWithPromotion(),
      isPending: false,
    })
    render(<YearlySwitchCard subscription={monthlyPro} />)

    expect(screen.getByText('$120.00').tagName).toBe('S')
    expect(screen.getByText('$96.00')).toBeInTheDocument()
    expect(screen.getByText(/Spring offer: 20% off/)).toBeInTheDocument()
  })

  it('tells the server the sale price was confirmed', async () => {
    useBillingPlans.mockReturnValue({
      data: mockBillingPlansWithPromotion(),
      isPending: false,
    })
    post.mockResolvedValue({ data: { success: true } })
    render(<YearlySwitchCard subscription={monthlyPro} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    expect(post).toHaveBeenCalledWith(
      '/billing/change-plan',
      expect.objectContaining({ promotionShown: true })
    )
  })

  it('offers the yearly price with its saving', () => {
    render(<YearlySwitchCard subscription={monthlyPro} />)

    expect(
      screen.getByRole('heading', { name: 'Switch to yearly' })
    ).toBeInTheDocument()
    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(screen.getByText(/\$10\.00\/month/)).toBeInTheDocument()
    expect(screen.getByText('Save 47%, 5 months free')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Unused days on your monthly plan are credited by our payment provider.'
      )
    ).toBeInTheDocument()
  })

  it('confirms before switching, then posts the yearly change', async () => {
    post.mockResolvedValue({ data: { success: true } })
    render(<YearlySwitchCard subscription={monthlyPro} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
    expect(post).not.toHaveBeenCalled()
    expect(
      screen.getByText(/\$120\.00 a year, charged now minus the credit/)
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/billing/change-plan', {
      planName: 'pro',
      billingInterval: 'yearly',
      from: 'app_billing_yearly',
    })
    await waitFor(() =>
      expect(window.location.href).toBe(
        '/dashboard/account/billing?plan-change-success=1'
      )
    )
  })

  it('names the email that led to the billing page as the prior source', async () => {
    post.mockResolvedValue({ data: { success: true } })
    document.cookie = `tb_cfrom=${encodeURIComponent(
      JSON.stringify({ from: 'email', ref: 'yearly_switch', at: '2026-10-01T00:00:00.000Z' })
    )}; path=/`
    try {
      render(<YearlySwitchCard subscription={monthlyPro} />)

      await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
      await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

      expect(post).toHaveBeenCalledWith('/billing/change-plan', {
        planName: 'pro',
        billingInterval: 'yearly',
        from: 'app_billing_yearly',
        priorFrom: 'email',
        priorRef: 'yearly_switch',
      })
    } finally {
      document.cookie = 'tb_cfrom=; path=/; max-age=0'
    }
  })

  it('posts once when confirm is pressed twice quickly', async () => {
    post.mockReturnValue(new Promise(() => undefined))
    render(<YearlySwitchCard subscription={monthlyPro} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
    const confirm = screen.getByRole('button', { name: 'Confirm switch' })
    act(() => {
      fireEvent.click(confirm)
      fireEvent.click(confirm)
    })

    expect(post).toHaveBeenCalledTimes(1)
  })

  it('still posts the change with a malformed stored value', async () => {
    post.mockResolvedValue({ data: { success: true } })
    document.cookie = 'tb_cfrom=%E0; path=/'
    try {
      render(<YearlySwitchCard subscription={monthlyPro} />)

      await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
      await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

      expect(post).toHaveBeenCalledWith('/billing/change-plan', {
        planName: 'pro',
        billingInterval: 'yearly',
        from: 'app_billing_yearly',
      })
    } finally {
      document.cookie = 'tb_cfrom=; path=/; max-age=0'
    }
  })

  // The request may have charged the card, so it is never resent on its own.
  it('shows the server message and does not retry', async () => {
    post.mockRejectedValue({
      response: {
        data: {
          message:
            'Your card was declined. Update your payment method, then try again.',
        },
      },
    })
    render(<YearlySwitchCard subscription={monthlyPro} />)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to yearly' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm switch' }))

    expect(
      await screen.findByText(
        'Your card was declined. Update your payment method, then try again.'
      )
    ).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('')
  })

  it.each([
    ['a yearly subscription', { ...monthlyPro, recurringInterval: 'year' }],
    ['a past due subscription', { ...monthlyPro, status: 'past_due' }],
    ['a discounted charge where yearly costs more', { ...monthlyPro, amount: 900 }],
    ['a saving that rounds to 0', { ...monthlyPro, amount: 1002 }],
    ['a canceling subscription', { ...monthlyPro, cancelAtPeriodEnd: true }],
    ['a custom plan', { ...monthlyPro, plan: { name: 'custom-acme' } }],
    ['a free account', { plan: { name: 'free' } }],
  ])('stays hidden for %s', (_label, subscription) => {
    const { container } = render(
      <YearlySwitchCard subscription={subscription} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the saving against an older, lower monthly price', () => {
    render(<YearlySwitchCard subscription={{ ...monthlyPro, amount: 1100 }} />)

    expect(screen.getByText('Save 9%, 1 month free')).toBeInTheDocument()
  })

  it('leaves out months free when the saving is under a month', () => {
    render(<YearlySwitchCard subscription={{ ...monthlyPro, amount: 1050 }} />)

    expect(screen.getByText('Save 5%')).toBeInTheDocument()
  })

  it('shows the list saving to a list-price payer', () => {
    render(<YearlySwitchCard subscription={{ ...monthlyPro, amount: 1900 }} />)

    expect(screen.getByText('Save 47%, 5 months free')).toBeInTheDocument()
  })

  it('stays hidden while prices are unknown', () => {
    useBillingPlans.mockReturnValue({ data: undefined, isPending: false })
    const { container } = render(
      <YearlySwitchCard subscription={monthlyPro} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
