// Every sign-out of the app. The login library builds its own next address
// from its site setting, which can be another site than the app, so it never
// picks the address: it signs out with redirect: false, and the browser then
// loads a path on its own origin with a full page load.

import { signOut } from 'next-auth/react'
import { Routes } from '@/config/routes'
import { safeRedirect } from '@/lib/auth-redirect'
import { loadPage } from '@/lib/device-link'

export const SIGN_OUT_FAILED_TEXT =
  'Could not log out. Check your connection and try again.'

// The login library answers a sign-out it refused for a missing or wrong CSRF
// token with its own sign-out page and csrf=true, and keeps the session. A
// real sign-out answers with the callback address. Its getSession is no
// check either: it answers null on a network error too.
export function signOutRefused(answer: unknown): boolean {
  const url = (answer as { url?: unknown } | null | undefined)?.url
  if (typeof url !== 'string') return true
  try {
    const parsed = new URL(url, 'http://localhost')
    return (
      parsed.pathname.endsWith('/signout') &&
      parsed.searchParams.get('csrf') === 'true'
    )
  } catch {
    return true
  }
}

/**
 * Signs out, then loads the given same-site path; anything else loads the
 * login page. Answers whether the sign-out worked. After a failure the page
 * stays, unless loadOnFailure is set: with a login that still works, the
 * login page sends the visitor back to the dashboard, which can loop.
 */
export async function signOutTo(
  path: string = Routes.login,
  { loadOnFailure = false }: { loadOnFailure?: boolean } = {}
): Promise<boolean> {
  let signedOut = false
  try {
    signedOut = !signOutRefused(await signOut({ redirect: false }))
  } catch {
    signedOut = false
  }
  if (signedOut || loadOnFailure) {
    loadPage(safeRedirect(path, window.location.origin) ?? Routes.login)
  }
  return signedOut
}
