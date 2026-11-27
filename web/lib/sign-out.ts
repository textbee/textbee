// Every sign-out of the app. The login library builds its own next address
// from its site setting, which can be another site than the app, so it never
// picks the address: it signs out with redirect: false, and the browser then
// loads a path on its own origin with a full page load.

import { signOut } from 'next-auth/react'
import { Routes } from '@/config/routes'
import { safeRedirect } from '@/lib/auth-redirect'
import { loadPage } from '@/lib/device-link'

/** Signs out, then loads the given same-site path; anything else loads the login page. */
export async function signOutTo(path: string = Routes.login): Promise<void> {
  try {
    await signOut({ redirect: false })
  } catch {
    // The next page shows the login state it finds
  }
  loadPage(safeRedirect(path, window.location.origin) ?? Routes.login)
}
