import { describe, expect, it, vi } from 'vitest'
import {
  emailLinkApiUrl,
  isAllowedDestination,
  resolveEmailLink,
} from './email-links'

const APP = 'https://app.example.com'
const API = 'https://api.example.com/api/v1'
const BILLING = 'https://app.example.com/dashboard/account/billing'

const answer = (status: number, location?: string) =>
  vi.fn().mockResolvedValue(
    new Response(null, { status, headers: location ? { location } : {} }),
  )

describe('emailLinkApiUrl', () => {
  it('builds the api route with the encoded token', () => {
    expect(emailLinkApiUrl('/billing/card', 'a b&c', `${API}/`)).toBe(
      'https://api.example.com/api/v1/billing/card?t=a%20b%26c',
    )
  })

  it.each([
    ['no token', null, API],
    ['no api base', 'abc', ''],
    ['a plain http api base', 'abc', 'http://api.example.com/api/v1'],
    ['a bad api base', 'abc', 'not a url'],
  ])('is null with %s', (_l, token, base) => {
    expect(emailLinkApiUrl('/billing/card', token, base)).toBeNull()
  })

  it.each(['http://localhost:3001/api/v1', 'http://127.0.0.1:3001/api/v1'])(
    'allows the local api base %s',
    (base) => {
      expect(emailLinkApiUrl('/billing/card', 'abc', base)).toBe(
        `${base}/billing/card?t=abc`,
      )
    },
  )
})

describe('isAllowedDestination', () => {
  it.each([
    ['https://app.example.com/checkout/pro?billingInterval=monthly', true],
    ['https://polar.sh/org/portal?customer_session_token=x', true],
    ['https://buy.polar.sh/polar_c_123', true],
    ['http://app.example.com/dashboard', false],
    ['https://evil.example.org/', false],
    ['https://polar.sh.evil.org/', false],
    ['/dashboard', false],
  ])('%s is %s', (location, allowed) => {
    expect(isAllowedDestination(location, 'app.example.com')).toBe(allowed)
  })
})

describe('resolveEmailLink', () => {
  it('asks the api without following the redirect and returns its destination', async () => {
    const fetchImpl = answer(302, 'https://polar.sh/org/portal?customer_session_token=x')

    await expect(
      resolveEmailLink('/billing/card', 'abc', APP, fetchImpl, API),
    ).resolves.toBe('https://polar.sh/org/portal?customer_session_token=x')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/billing/card?t=abc',
      expect.objectContaining({ redirect: 'manual', cache: 'no-store' }),
    )
  })

  it('returns an app page the api points to', async () => {
    const fetchImpl = answer(302, 'https://app.example.com/checkout/pro?billingInterval=monthly')

    await expect(
      resolveEmailLink('/billing/checkout/resume', 'abc', APP, fetchImpl, API),
    ).resolves.toBe('https://app.example.com/checkout/pro?billingInterval=monthly')
  })

  it.each([
    ['an unknown host', answer(302, 'https://evil.example.org/')],
    ['a non-redirect answer', answer(200)],
    ['a redirect without a location', answer(302)],
    ['a network error', vi.fn().mockRejectedValue(new Error('down'))],
  ])('falls back to the billing page on %s', async (_l, fetchImpl) => {
    await expect(
      resolveEmailLink('/billing/card', 'abc', APP, fetchImpl, API),
    ).resolves.toBe(BILLING)
  })

  it('does not call the api without a token', async () => {
    const fetchImpl = answer(302, 'https://polar.sh/x')

    await expect(
      resolveEmailLink('/billing/card', null, APP, fetchImpl, API),
    ).resolves.toBe(BILLING)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
