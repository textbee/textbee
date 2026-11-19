import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import PlanPicker from './plan-picker'

const useSubscription = vi.fn()
const useBillingPlans = vi.fn()

vi.mock('@/lib/api', () => ({
  useSubscription: () => useSubscription(),
  useBillingPlans: () => useBillingPlans(),
}))

beforeEach(() => {
  useSubscription.mockReturnValue({ data: { plan: { name: 'Free' } } })
  // Fixture prices: Pro $19.00 or $120.00 yearly, Scale $49.00 or $360.00.
  useBillingPlans.mockReturnValue({ data: mockBillingPlans, isPending: false })
})

describe('PlanPicker', () => {
  const renderPicker = (
    props?: Partial<React.ComponentProps<typeof PlanPicker>>
  ) =>
    render(
      <PlanPicker isLoading={false} isSaving={false} onSkip={() => {}} {...props} />
    )

  // The picker hardcoded Free and Pro inline, so Scale was invisible here no
  // matter what the pricing page offered.
  it('offers every self-serve tier, including Scale', () => {
    renderPicker()

    // By heading, since "Free" is also the Free tier's price.
    expect(
      screen.getAllByRole('heading').map((h) => h.textContent)
    ).toEqual(['Free', 'Pro', 'Scale'])
  })

  // The headline must be what the CTA charges, not the yearly per-month
  // equivalent. Yearly is the default interval.
  it('leads with the yearly price its CTA actually charges', () => {
    renderPicker()

    expect(screen.getByText('$120.00')).toBeInTheDocument()
    expect(screen.getByText('$360.00')).toBeInTheDocument()
    expect(screen.getAllByText('/year')).toHaveLength(2)
    expect(screen.queryByText('$19.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$10.00')).not.toBeInTheDocument()
  })

  it('captions the yearly price with its per-month equivalent', () => {
    renderPicker()

    expect(screen.getByText('$10.00/month, billed yearly')).toBeInTheDocument()
    expect(screen.getByText('$30.00/month, billed yearly')).toBeInTheDocument()
  })

  // Quoting a yearly charge with no yearly price to show would mislead, so
  // such a tier sells month to month, headline and CTA alike.
  it('sells monthly when a tier has no yearly price', () => {
    useBillingPlans.mockReturnValue({
      data: mockBillingPlans.map((p) =>
        p.name === 'pro' ? { ...p, yearlyPrice: 0 } : p
      ),
      isPending: false,
    })
    renderPicker()

    expect(screen.getByText('$19.00')).toBeInTheDocument()
    expect(screen.getByText('billed monthly')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Upgrade to Pro/ })).toHaveAttribute(
      'href',
      '/checkout/pro?billingInterval=monthly&from=app_get_started'
    )
    expect(
      screen.getByRole('link', { name: /Upgrade to Scale/ })
    ).toHaveAttribute('href', '/checkout/scale?billingInterval=yearly&from=app_get_started')
  })

  it('waits for prices instead of flashing cards without them', () => {
    useBillingPlans.mockReturnValue({ data: undefined, isPending: true })
    renderPicker()

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  // A failed or empty plans response must never fall back to a made-up price.
  it('points to the pricing page when prices are unknown', () => {
    useBillingPlans.mockReturnValue({ data: undefined, isPending: false })
    renderPicker()

    expect(screen.getAllByRole('link', { name: /See pricing/ })).toHaveLength(2)
    expect(screen.queryByText(/billed yearly/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Save \d+% yearly/)).not.toBeInTheDocument()
    expect(screen.getByText('$0')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Upgrade to Pro/ })
    ).toBeInTheDocument()
  })

  // The reassurance has to match the interval the CTA commits to.
  it('quotes the refund window its CTA actually gives you', () => {
    renderPicker()

    expect(
      screen.getAllByText(/14-day money-back guarantee/)
    ).toHaveLength(2)
  })

  it('quotes the yearly saving on each paid tier, in months too', () => {
    renderPicker()

    expect(
      screen.getByText('Save 47% yearly, 5 months free')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Save 39% yearly, 4 months free')
    ).toBeInTheDocument()
  })

  // Naming the interval is what makes checkout redirect straight to Polar
  // instead of stopping on the chooser.
  it('links each paid tier at its own checkout route, interval named', () => {
    renderPicker()

    expect(screen.getByRole('link', { name: /Upgrade to Pro/ })).toHaveAttribute(
      'href',
      '/checkout/pro?billingInterval=yearly&from=app_get_started'
    )
    expect(
      screen.getByRole('link', { name: /Upgrade to Scale/ })
    ).toHaveAttribute('href', '/checkout/scale?billingInterval=yearly&from=app_get_started')
  })

  it('marks the subscribed tier as current and does not sell it again', () => {
    useSubscription.mockReturnValue({ data: { plan: { name: 'Pro' } } })
    renderPicker()

    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Upgrade to Pro/ })
    ).not.toBeInTheDocument()
    // Other tiers stay available.
    expect(
      screen.getByRole('link', { name: /Upgrade to Scale/ })
    ).toBeInTheDocument()
  })

  it('matches the current plan regardless of casing or padding', () => {
    useSubscription.mockReturnValue({ data: { plan: { name: '  SCALE ' } } })
    renderPicker()

    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Upgrade to Scale/ })
    ).not.toBeInTheDocument()
  })

  it('renders without a subscription rather than blanking the step', () => {
    useSubscription.mockReturnValue({ data: undefined })
    renderPicker()

    expect(screen.getByRole('heading', { name: 'Scale' })).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
  })

  it('hides Skip once the step is done', () => {
    renderPicker({ isDone: true })
    expect(screen.queryByText(/Skip for now/)).not.toBeInTheDocument()
  })

  it('offers Skip while the step is unfinished', () => {
    renderPicker({ isDone: false })
    expect(screen.getByText(/Skip for now/)).toBeInTheDocument()
  })
})

// The default is read once at module load, so this block loads a fresh copy.
describe('PlanPicker with NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL=monthly', () => {
  let MonthlyPicker: typeof PlanPicker

  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_DEFAULT_BILLING_INTERVAL', 'monthly')
    vi.resetModules()
    MonthlyPicker = (await import('./plan-picker')).default
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const renderPicker = () =>
    render(
      <MonthlyPicker isLoading={false} isSaving={false} onSkip={() => {}} />
    )

  it('leads with the monthly price its CTA actually charges', () => {
    renderPicker()

    expect(screen.getByText('$19.00')).toBeInTheDocument()
    expect(screen.getByText('$49.00')).toBeInTheDocument()
    expect(screen.queryByText('/year')).not.toBeInTheDocument()
    expect(screen.queryByText('$10.00')).not.toBeInTheDocument()
  })

  it('still offers the yearly alternative underneath', () => {
    renderPicker()

    expect(
      screen.getByText('or $10.00/month billed yearly at $120.00')
    ).toBeInTheDocument()
    expect(
      screen.getByText('or $30.00/month billed yearly at $360.00')
    ).toBeInTheDocument()
  })

  it('quotes the monthly refund window', () => {
    renderPicker()

    expect(
      screen.getAllByText(/7-day money-back guarantee/)
    ).toHaveLength(2)
  })

  it('links each paid tier at its monthly checkout', () => {
    renderPicker()

    expect(screen.getByRole('link', { name: /Upgrade to Pro/ })).toHaveAttribute(
      'href',
      '/checkout/pro?billingInterval=monthly&from=app_get_started'
    )
    expect(
      screen.getByRole('link', { name: /Upgrade to Scale/ })
    ).toHaveAttribute('href', '/checkout/scale?billingInterval=monthly&from=app_get_started')
  })
})

describe('PlanPicker with a live promotion', () => {
  const renderPicker = () =>
    render(<PlanPicker isLoading={false} isSaving={false} onSkip={() => {}} />)

  beforeEach(() => {
    // Pro on sale: $96.00 instead of $120.00 yearly.
    useBillingPlans.mockReturnValue({
      data: mockBillingPlansWithPromotion(),
      isPending: false,
    })
  })

  it('strikes the list price and leads with the sale price for a free account', () => {
    renderPicker()

    expect(screen.getByText('$120.00').tagName).toBe('S')
    expect(screen.getByText('$96.00')).toBeInTheDocument()
    expect(
      screen.getByText('$8.00/month, billed yearly. Stays while you stay subscribed.')
    ).toBeInTheDocument()
    expect(screen.getByText('Spring offer · 20% off until March 31')).toBeInTheDocument()
    expect(screen.getByText('Applied at checkout.')).toBeInTheDocument()
  })

  it('keeps the yearly saving badge on a tier the promotion does not cover', () => {
    renderPicker()

    expect(screen.getByText('$360.00')).toBeInTheDocument()
    expect(screen.getAllByText(/Save \d+% yearly/)).toHaveLength(1)
    expect(screen.getAllByText(/% off until/)).toHaveLength(1)
  })

  it('shows no sale to an account on a paid plan', () => {
    useSubscription.mockReturnValue({
      data: { plan: { name: 'scale' }, status: 'active' },
    })
    renderPicker()

    expect(screen.getByText('$120.00').tagName).not.toBe('S')
    expect(screen.queryByText('$96.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Offer ends/)).not.toBeInTheDocument()
  })

  it('shows no sale while the subscription is still loading', () => {
    useSubscription.mockReturnValue({ data: undefined })
    renderPicker()

    expect(screen.queryByText('$96.00')).not.toBeInTheDocument()
  })
})
