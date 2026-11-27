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
  let signedOut = true
  try {
    await signOut({ redirect: false })
  } catch {
    signedOut = false
  }
  if (signedOut || loadOnFailure) {
    loadPage(safeRedirect(path, window.location.origin) ?? Routes.login)
  }
  return signedOut
}
