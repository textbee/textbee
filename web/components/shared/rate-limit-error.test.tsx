import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import { formatError } from '@/lib/utils/errorHandler'
import { RateLimitError, formatRateLimitMessageForToast } from './rate-limit-error'

const useSubscription = vi.fn()
const useBillingPlans = vi.fn()

vi.mock('@/lib/api', () => ({
  useSubscription: () => useSubscription(),
  useBillingPlans: () => useBillingPlans(),
}))

beforeEach(() => {
  useSubscription.mockReturnValue({ data: { plan: { name: 'free' } } })
  useBillingPlans.mockReturnValue({ data: mockBillingPlans })
})

const limitError = (data: Record<string, unknown>) => ({
  response: { status: 429, data },
})

const planLimit = formatError(
  limitError({ message: 'Your account has used all 50 messages.', hasReachedLimit: true })
).rateLimitData
const unpaid = formatError(
  limitError({
    message: 'Your last payment did not go through.',
    hasReachedLimit: true,
    paymentHold: true,
  })
).rateLimitData

describe('formatError on a limit error', () => {
  it('carries the unpaid renewal flag only when the API sends true', () => {
    expect(planLimit?.paymentHold).toBe(false)
    expect(unpaid?.paymentHold).toBe(true)
    expect(
      formatError(limitError({ message: 'x', paymentHold: 'yes' })).rateLimitData?.paymentHold
    ).toBe(false)
  })
})

describe('RateLimitError', () => {
  it.each(['alert', 'inline'] as const)('offers an upgrade on a plan limit (%s)', (variant) => {
    render(<RateLimitError errorData={planLimit} variant={variant} />)

    const link = screen.getByRole('link', { name: 'Upgrade Plan' })
    expect(link.getAttribute('href')).toContain('/checkout/pro')
    expect(screen.getByText('or wait for your limit to reset')).toBeTruthy()
  })

  it.each(['alert', 'inline'] as const)(
    'links the billing page while a renewal is unpaid (%s)',
    (variant) => {
      render(<RateLimitError errorData={unpaid} variant={variant} />)

      expect(
        screen.getByRole('link', { name: 'Update payment' }).getAttribute('href')
      ).toBe('/dashboard/account/billing')
      expect(screen.queryByRole('link', { name: 'Upgrade Plan' })).toBeNull()
      expect(screen.queryByText('or wait for your limit to reset')).toBeNull()
      expect(screen.getByText('Your last payment did not go through.')).toBeTruthy()
    }
  )
})

describe('RateLimitError with a live promotion', () => {
  beforeEach(() => {
    useBillingPlans.mockReturnValue({ data: mockBillingPlansWithPromotion() })
  })

  it.each(['alert', 'inline'] as const)('adds the sale line and offer button (%s)', (variant) => {
    render(<RateLimitError errorData={planLimit} variant={variant} />)

    expect(screen.getByText('Spring offer: 20% off Pro, forever. Ends March 31.')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'Upgrade for 20% off' }).getAttribute('href')
    ).toBe('/checkout/pro?billingInterval=yearly&from=app_limit_error')
    expect(screen.getByText('or wait for your limit to reset')).toBeTruthy()
  })

  it('shows no offer to a paid account', () => {
    useSubscription.mockReturnValue({ data: { plan: { name: 'pro' }, status: 'active' } })
    render(<RateLimitError errorData={planLimit} />)

    expect(screen.queryByText(/% off/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Upgrade Plan' })).toBeTruthy()
  })

  it('shows no offer while a renewal is unpaid', () => {
    render(<RateLimitError errorData={unpaid} />)

    expect(screen.queryByText(/% off/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Update payment' })).toBeTruthy()
  })
})

describe('formatRateLimitMessageForToast', () => {
  it('adds the upgrade hint to a plan limit only', () => {
    expect(formatRateLimitMessageForToast(planLimit)).toBe(
      'Your account has used all 50 messages. Please upgrade your plan or wait for your limit to reset.'
    )
    expect(formatRateLimitMessageForToast(unpaid)).toBe('Your last payment did not go through.')
  })
})
