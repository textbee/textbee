import type { BrowserContext } from '@playwright/test'
import { encode } from 'next-auth/jwt'
import { TEST_AUTH_SECRET } from '../playwright.config'
import { mockUser, TEST_ACCESS_TOKEN } from '../test/fixtures'

// NextAuth v4 default session cookie name over http (non-secure).
const SESSION_COOKIE = 'next-auth.session-token'

// Two modals can open unprompted over the dashboard: the survey modal (on a
// Math.random() coin flip) and the update-app prompt (whenever a mocked device
// reports an old app version). A Radix dialog marks the rest of the page
// aria-hidden while open, so whenever either fired, every getByRole query on
// that page found nothing and a random test failed. Seeding their dismissal
// flags suppresses both deterministically.
//
// Tests that want to assert on these modals should clear the flags themselves.
//
// These flags only reach the built-in modals. mock-api.ts answers the feed with
// the engine switched off, so those are the ones that render here; a test that
// wants the engine has to say so and suppress its modal through the feed it
// serves instead.
async function suppressInterruptingModals(context: BrowserContext) {
  await context.addInitScript(() => {
    window.localStorage.setItem('survey_modal_has_submitted', 'true')
    // Snooze far enough out that the prompt stays closed for the run.
    window.localStorage.setItem(
      'update_app_prompt_snooze_until',
      String(Date.now() + 365 * 24 * 60 * 60 * 1000)
    )
  })
}

// Mint a valid NextAuth JWT session cookie so middleware's getToken() accepts
// the request and the app treats us as authenticated, without ever running the
// real login flow or contacting a backend.
export async function authenticate(context: BrowserContext) {
  await suppressInterruptingModals(context)

  const token = await encode({
    token: {
      sub: mockUser.id,
      id: mockUser.id,
      name: mockUser.name,
      email: mockUser.email,
      phone: mockUser.phone,
      role: mockUser.role,
      accessToken: TEST_ACCESS_TOKEN,
    },
    secret: TEST_AUTH_SECRET,
  })

  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 60 * 60,
    },
  ])
}
