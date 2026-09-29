import { NextRequest, NextResponse } from 'next/server'

const BILLING_PATH = '/dashboard/account/billing'
// The api answers with an app page or the payment provider's hosted page.
const PROVIDER_HOSTS = ['polar.sh']

/** https, or http on this machine only. */
export function isAllowedApiBase(base: string): boolean {
  try {
    const url = new URL(base)
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

/** The api route that checks the token, or null when it cannot be called safely. */
export function emailLinkApiUrl(
  apiPath: string,
  token: string | null,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL,
): string | null {
  const base = (apiBase ?? '').replace(/\/+$/, '')
  if (!token || !isAllowedApiBase(base)) return null
  return `${base}${apiPath}?t=${encodeURIComponent(token)}`
}

/** True for an https page on this app or on the payment provider. */
export function isAllowedDestination(location: string, appHost: string): boolean {
  try {
    const url = new URL(location)
    if (url.protocol !== 'https:') return false
    const host = url.hostname
    return (
      url.host === appHost ||
      PROVIDER_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))
    )
  } catch {
    return false
  }
}

/** Asks the api where the link leads, server to server, so the token never reaches a second browser URL. */
export async function resolveEmailLink(
  apiPath: string,
  token: string | null,
  appOrigin: string,
  fetchImpl: typeof fetch = fetch,
  apiBase = process.env.NEXT_PUBLIC_API_BASE_URL,
): Promise<string> {
  const fallback = `${appOrigin}${BILLING_PATH}`
  const apiUrl = emailLinkApiUrl(apiPath, token, apiBase)
  if (!apiUrl) return fallback
  try {
    const res = await fetchImpl(apiUrl, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return fallback
    return isAllowedDestination(location, new URL(appOrigin).host)
      ? location
      : fallback
  } catch {
    return fallback
  }
}

export async function emailLinkRedirect(request: NextRequest, apiPath: string) {
  const target = await resolveEmailLink(
    apiPath,
    request.nextUrl.searchParams.get('t'),
    request.nextUrl.origin,
  )
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
