import { Suspense } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockBillingPlans, mockBillingPlansWithPromotion } from '@/test/fixtures'
import CheckoutPage from './page'

let search = ''
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

let sessionStatus = 'authenticated'
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: sessionStatus }),
}))

let plansData: unknown = mockBillingPlans
let subscriptionData: unknown = { plan: { name: 'free' } }
const useSubscription = vi.fn((options?: { enabled?: boolean }) => ({
  data: options?.enabled === false ? undefined : subscriptionData,
}))
vi.mock('@/lib/api', () => ({
  useBillingPlans: () => ({ data: plansData, isPending: false }),
  useSubscription: (options?: { enabled?: boolean }) => useSubscription(options),
}))

const post = vi.fn()
vi.mock('@/lib/httpBrowserClient', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
}))

const track = vi.fn()
vi.mock('@/lib/analytics/track', () => ({
  track: (...a: unknown[]) => track(...a),
}))

const originalLocation = window.location

const setStored = (value: Record<string, string>) => {
  document.cookie = `tb_cfrom=${encodeURIComponent(
    JSON.stringify({ ...value, at: '2026-10-01T00:00:00.000Z' })
  )}; path=/`
}

const renderPage = async () => {
  const params = Promise.resolve({ planName: 'pro' })
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <CheckoutPage params={params} />
      </Suspense>
    )
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: '' },
  })
})
afterEach(() => {
  document.cookie = 'tb_cfrom=; path=/; max-age=0'
  search = ''
  plansData = mockBillingPlans
  subscriptionData = { plan: { name: 'free' } }
  sessionStatus = 'authenticated'
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  })
})

describe('CheckoutPage source', () => {
  it('sends the link source, the stored one as prior, and tags begin_checkout', async () => {
    search = 'billingInterval=yearly&from=app_billing'
    setStored({ from: 'email', ref: 'U1' })
    post.mockResolvedValue({ data: { redirectUrl: 'https://pay.test/co_1' } })

    await renderPage()

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/billing/checkout', {
      planName: 'pro',
      billingInterval: 'yearly',
      from: 'app_billing',
      priorFrom: 'email',
      priorRef: 'U1',
    })
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('begin_checkout', {
        plan: 'pro',
        billing_interval: 'yearly',
        from: 'app_billing',
      })
    )
  })

  it('falls back to the stored source when the link has none', async () => {
    search = 'billingInterval=monthly'
    setStored({ from: 'notice', ref: 'n1' })
    post.mockResolvedValue({ data: { redirectUrl: 'https://pay.test/co_1' } })

    await renderPage()

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/billing/checkout', {
        planName: 'pro',
        billingInterval: 'monthly',
        from: 'notice',
        ref: 'n1',
        fromCookie: true,
      })
    )
  })

  it('sends no source and no from prop when there is none', async () => {
    search = 'billingInterval=monthly&from=Not%20Valid'
    post.mockResolvedValue({ data: { redirectUrl: 'https://pay.test/co_1' } })

    await renderPage()

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/billing/checkout', {
        planName: 'pro',
        billingInterval: 'monthly',
      })
    )
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('begin_checkout', {
        plan: 'pro',
        billing_interval: 'monthly',
      })
    )
  })

  it('sends the source with the confirmed plan change', async () => {
    search = 'billingInterval=yearly&from=email&ref=U2_paid'
    post
      .mockResolvedValueOnce({
        data: {
          planChange: {
            currentPlan: 'pro',
            currentInterval: 'monthly',
            newPlan: 'pro',
            newInterval: 'yearly',
            isUpgrade: false,
            cancelAtPeriodEnd: false,
          },
        },
      })
      .mockResolvedValueOnce({ data: { success: true, plan: 'pro' } })

    await renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Confirm change' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2))
    expect(post).toHaveBeenLastCalledWith('/billing/change-plan', {
      planName: 'pro',
      billingInterval: 'yearly',
      from: 'email',
      ref: 'U2_paid',
    })
  })

  it('still starts checkout with a malformed stored value', async () => {
    search = 'billingInterval=monthly&from=app_billing'
    document.cookie = 'tb_cfrom=%E0; path=/'
    post.mockResolvedValue({ data: { redirectUrl: 'https://pay.test/co_1' } })

    await renderPage()

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/billing/checkout', {
        planName: 'pro',
        billingInterval: 'monthly',
        from: 'app_billing',
      })
    )
  })

  it('starts checkout once even when the query changes', async () => {
    search = 'billingInterval=monthly'
    post.mockResolvedValue({ data: { redirectUrl: 'https://pay.test/co_1' } })
    const params = Promise.resolve({ planName: 'pro' })
    const tree = () => (
      <Suspense fallback={null}>
        <CheckoutPage params={params} />
      </Suspense>
    )

    let rerender: (ui: React.ReactElement) => void = () => undefined
    await act(async () => {
      rerender = render(tree()).rerender
    })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))

    search = 'billingInterval=yearly&from=app_billing'
    await act(async () => {
      rerender(tree())
    })

    expect(post).toHaveBeenCalledTimes(1)
  })
})

describe('CheckoutPage with a live promotion', () => {
  beforeEach(() => {
    // Pro on sale: $96.00 instead of $120.00 yearly, $15.20 instead of $19.00.
    plansData = mockBillingPlansWithPromotion()
  })

  it('shows struck and sale prices, the offer chip and the note for a free account', async () => {
    await renderPage()

    expect(screen.getByText('20% off')).toBeInTheDocument()
    expect(screen.getByText('$10.00').tagName).toBe('S')
    expect(screen.getByText('$8.00')).toBeInTheDocument()
    expect(screen.getByText(/billed yearly at \$96\.00/)).toBeInTheDocument()
    expect(screen.getByText('$19.00').tagName).toBe('S')
    expect(screen.getByText('$15.20')).toBeInTheDocument()
    expect(
      screen.getByText('Spring offer price applied on the next page. Ends March 31.')
    ).toBeInTheDocument()
  })

  it('shows the sale price while redirecting', async () => {
    search = 'billingInterval=yearly'
    post.mockReturnValue(new Promise(() => undefined))

    await renderPage()

    expect(screen.getByText('Pro, yearly, $96.00 (20% off)')).toBeInTheDocument()
  })

  it('shows list prices only to a paid account', async () => {
    subscriptionData = { plan: { name: 'scale' }, status: 'active' }

    await renderPage()

    expect(screen.queryByText(/% off/)).not.toBeInTheDocument()
    expect(screen.getByText('$10.00/month, billed yearly at $120.00')).toBeInTheDocument()
    expect(screen.queryByText(/price applied on the next page/)).not.toBeInTheDocument()
  })
})

describe('CheckoutPage signed out', () => {
  it('requests no subscription and no checkout, and logs in back to this checkout', async () => {
    sessionStatus = 'unauthenticated'
    search = 'billingInterval=yearly'
    const href = 'http://localhost/checkout/pro?billingInterval=yearly'
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href },
    })

    await renderPage()

    expect(useSubscription).toHaveBeenCalled()
    for (const [options] of useSubscription.mock.calls) {
      expect(options).toEqual({ enabled: false })
    }
    expect(post).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith(`/login?redirect=${encodeURIComponent(href)}`)
  })
})
