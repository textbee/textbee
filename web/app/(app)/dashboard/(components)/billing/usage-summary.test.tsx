import { describe, expect, it } from 'vitest'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { renderWithProviders, screen, waitFor } from '@/test/render'
import { server } from '@/test/msw/server'
import { API_BASE_URL, mockSubscription } from '@/test/fixtures'
import { formatDateTime } from '@/lib/format'
import UsageSummary from './usage-summary'

// The dashboard must only show numbers the backend actually returns. These
// guard the two ways that can go wrong: inventing a meter for an unlimited
// plan, and failing to warn when a real limit is nearly spent.

const subscriptionResponding = (subscription: JsonBodyType) =>
  server.use(
    http.get(`${API_BASE_URL}/billing/current-subscription`, () =>
      HttpResponse.json(subscription)
    )
  )

describe('UsageSummary', () => {
  it('shows usage against the limit for a metered plan', async () => {
    renderWithProviders(<UsageSummary />)

    await waitFor(() => expect(screen.getByText('320')).toBeInTheDocument())
    // 320 of 5000 sent today.
    expect(screen.getByText('/ 5,000')).toBeInTheDocument()
    expect(screen.getByText('4,680 remaining')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', { name: /today usage/i })
    ).toBeInTheDocument()
  })

  it('shows when the monthly allowance resets', async () => {
    renderWithProviders(<UsageSummary />)

    await waitFor(() =>
      expect(
        screen.getByText(`Resets ${formatDateTime('2026-10-17T22:15:00.000Z')}`)
      ).toBeInTheDocument()
    )
    expect(
      screen.getByRole('progressbar', { name: /billing period usage/i })
    ).toBeInTheDocument()
  })

  it('renders no progress bar for an unlimited plan', async () => {
    subscriptionResponding({
      ...mockSubscription,
      plan: { ...mockSubscription.plan, dailyLimit: -1, monthlyLimit: -1 },
      usage: {
        ...mockSubscription.usage,
        dailyLimit: -1,
        monthlyLimit: -1,
      },
    })

    renderWithProviders(<UsageSummary />)

    await waitFor(() =>
      expect(screen.getAllByText(/Unlimited on your plan/)).toHaveLength(2)
    )
    // A meter would be meaningless with no ceiling to measure against.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('warns and offers an upgrade when close to the limit', async () => {
    subscriptionResponding({
      ...mockSubscription,
      usage: {
        ...mockSubscription.usage,
        processedSmsToday: 4500,
        dailyRemaining: 500,
        dailyUsagePercentage: 90,
      },
    })

    renderWithProviders(<UsageSummary />)

    await waitFor(() =>
      expect(screen.getByText('500 remaining')).toBeInTheDocument()
    )
    expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute(
      'href',
      '/dashboard/account/billing'
    )
  })

  it('says the limit is reached rather than showing a remaining count', async () => {
    subscriptionResponding({
      ...mockSubscription,
      usage: {
        ...mockSubscription.usage,
        processedSmsToday: 5000,
        dailyRemaining: 0,
        dailyUsagePercentage: 100,
      },
    })

    renderWithProviders(<UsageSummary />)

    await waitFor(() =>
      expect(screen.getByText('Limit reached')).toBeInTheDocument()
    )
  })
})
