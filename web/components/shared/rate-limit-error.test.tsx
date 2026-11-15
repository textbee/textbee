import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { formatError } from '@/lib/utils/errorHandler'
import { RateLimitError, formatRateLimitMessageForToast } from './rate-limit-error'

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

describe('formatRateLimitMessageForToast', () => {
  it('adds the upgrade hint to a plan limit only', () => {
    expect(formatRateLimitMessageForToast(planLimit)).toBe(
      'Your account has used all 50 messages. Please upgrade your plan or wait for your limit to reset.'
    )
    expect(formatRateLimitMessageForToast(unpaid)).toBe('Your last payment did not go through.')
  })
})
