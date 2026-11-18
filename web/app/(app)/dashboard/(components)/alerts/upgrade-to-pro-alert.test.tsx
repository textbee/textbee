import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import UpgradeToProAlert from './upgrade-to-pro-alert'

const useSubscription = vi.fn()
const useBillingPlans = vi.fn()

vi.mock('@/lib/api', () => ({
  useSubscription: () => useSubscription(),
  useBillingPlans: () => useBillingPlans(),
}))

const freeAt = (monthlyUsagePercentage: number) => ({
  data: {
    plan: { name: 'free' },
    usage: { monthlyUsagePercentage, monthlyLimit: 300, processedSmsLastMonth: 30 },
  },
  isLoading: false,
  error: null,
})

beforeEach(() => {
  useSubscription.mockReturnValue(freeAt(10))
  // Pro on sale: $96.00 instead of $120.00 yearly, 20% off forever.
  useBillingPlans.mockReturnValue({ data: mockBillingPlansWithPromotion() })
})

describe('UpgradeToProAlert', () => {
  it('shows the promotion banner to a free account, every time', () => {
    const { unmount } = render(<UpgradeToProAlert />)

    expect(screen.getByText('Spring offer: 20% off Pro, forever')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Pro is $96.00 a year instead of $120.00, for as long as you stay subscribed. Applied at checkout. Ends March 31.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Get 20% off' })).toHaveAttribute(
      'href',
      '/checkout/pro?billingInterval=yearly&from=app_usage_alert'
    )
    unmount()

    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    render(<UpgradeToProAlert />)
    expect(screen.getByText('Spring offer: 20% off Pro, forever')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('names the duration of a promotion that does not last forever', () => {
    useBillingPlans.mockReturnValue({
      data: mockBillingPlansWithPromotion({ duration: 'repeating', durationInMonths: 3 }),
    })
    render(<UpgradeToProAlert />)

    expect(screen.getByText('Spring offer: 20% off Pro, for 3 months')).toBeInTheDocument()
    expect(screen.getByText(/instead of \$120\.00, for 3 months\./)).toBeInTheDocument()
  })

  it.each([
    [80, /Approaching limit/],
    [100, /Monthly limit exceeded/],
  ])('keeps the limit headline at %i%% and adds the sale line', (percent, headline) => {
    useSubscription.mockReturnValue(freeAt(percent))
    render(<UpgradeToProAlert />)

    expect(screen.getByText(headline)).toBeInTheDocument()
    expect(
      screen.getByText('Spring offer: 20% off Pro, forever. Ends March 31.')
    ).toBeInTheDocument()
  })

  it('keeps the Scale message without a sale line for a paid Pro account', () => {
    useSubscription.mockReturnValue({
      data: {
        plan: { name: 'pro' },
        status: 'active',
        usage: { monthlyUsagePercentage: 90, monthlyLimit: 5000, processedSmsLastMonth: 4500 },
      },
      isLoading: false,
      error: null,
    })
    render(<UpgradeToProAlert />)

    expect(screen.getByText(/Approaching Pro limit/)).toBeInTheDocument()
    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
  })

  it('shows the usual upgrade message and no offer when no promotion is live', () => {
    useBillingPlans.mockReturnValue({ data: mockBillingPlans })
    render(<UpgradeToProAlert />)

    expect(
      screen.getByText('Unlock premium features, priority support, and advanced capabilities with Pro!')
    ).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/discount/i)).not.toBeInTheDocument()
  })
})
