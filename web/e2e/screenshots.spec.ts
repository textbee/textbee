import { test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { authenticate } from './session'
import { mockApi, type MockApiOverrides } from './mock-api'
import { mockFreeSubscription } from '../test/fixtures'

// Marketing/README asset capture. This is NOT an assertion suite: it drives the
// real dashboard against the same mocked backend the e2e specs use (no real
// backend, no login) and writes PNGs for the public README and marketing site.
// It is gated behind CAPTURE=1 so `pnpm test:e2e` and CI skip it:
//   CAPTURE=1 pnpm exec playwright test e2e/screenshots.spec.ts
// Output goes to web/.screenshots (gitignored); curate from there.

const OUT_DIR =
  process.env.SCREENSHOT_DIR || path.join(process.cwd(), '.screenshots')

// Third-party scripts (GA, Clarity) are injected on every app page and are not
// under /api/v1, so mockApi does not catch them. Aborting them keeps shots
// deterministic and avoids network waits that never settle.
async function blockThirdParties(page: Page) {
  await page.route(
    /googletagmanager|google-analytics|clarity\.ms|tawk\.to|supporthq/,
    (route) => route.abort()
  )
}

// The dashboard layout stacks dismissible alerts (update-app, upgrade-to-pro,
// verify-email, ...) in the div directly above <main>. They dominate marketing
// shots and one upsells Pro to a Pro fixture, so hide the whole stack.
async function hideChrome(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector('main#main-content')
    const banners = main?.previousElementSibling as HTMLElement | null
    if (banners && banners.tagName === 'DIV') banners.style.display = 'none'
  })
}

// Force light theme regardless of the OS setting: seed the next-themes store
// (default storageKey 'theme') before any script runs. colorScheme is also set
// at the project level below as a belt-and-suspenders for defaultTheme='system'.
async function forceLightTheme(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'light')
  })
}

// Deterministic content-ready wait shared with mobile-overflow.spec.ts: the
// page's own <h2> is laid out and every loading placeholder has cleared. More
// reliable than networkidle, which link prefetching keeps re-arming.
async function waitForContent(page: Page) {
  await page
    .locator('main#main-content h2')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page
    .locator('main#main-content [role="status"]')
    .first()
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {})
  // Small settle for chart/entrance transitions to finish before the frame.
  await page.waitForTimeout(600)
}

async function capture(
  page: Page,
  context: import('@playwright/test').BrowserContext,
  opts: {
    route: string
    name: string
    fullPage?: boolean
    overrides?: MockApiOverrides
    ready?: (page: Page) => Promise<void>
    prepare?: (page: Page) => Promise<void>
    keepChrome?: boolean
  }
) {
  await forceLightTheme(page)
  await blockThirdParties(page)
  await authenticate(context)
  await mockApi(page, opts.overrides)

  await page.goto(opts.route)
  if (opts.ready) await opts.ready(page)
  else await waitForContent(page)

  if (!opts.keepChrome) await hideChrome(page)
  // Best-effort: a fill failure should degrade to the empty state, not lose the shot.
  if (opts.prepare) await opts.prepare(page).catch(() => {})
  await page.waitForTimeout(300)

  await page.screenshot({
    path: path.join(OUT_DIR, `${opts.name}.png`),
    fullPage: !!opts.fullPage,
    animations: 'disabled',
  })
}

type Shot = {
  route: string
  name: string
  fullPage?: boolean
  overrides?: MockApiOverrides
  ready?: (page: Page) => Promise<void>
  prepare?: (page: Page) => Promise<void>
  keepChrome?: boolean
}

// Pre-fill the send view so the shot shows a real message being composed.
async function fillSendSms(page: Page) {
  const to = page.locator('#sms-recipient')
  await to.fill('+14155550134')
  await to.press('Enter')
  await page
    .locator('#sms-message')
    .fill('Your textbee code is 481920. It expires in 10 minutes.')
  await page.locator('#sms-message').blur()
}

// Auth pages have no main#main-content h2, so they carry their own ready check.
const authReady =
  (text: string) =>
  async (page: Page) => {
    await page.getByText(text).first().waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(400)
  }

const DASHBOARD_SHOTS: Shot[] = [
  { route: '/dashboard', name: 'dashboard-overview', fullPage: true },
  { route: '/dashboard/messaging', name: 'send-sms', prepare: fillSendSms },
  { route: '/dashboard/messaging/history', name: 'message-history' },
  { route: '/dashboard/messaging/bulk', name: 'bulk-send' },
  { route: '/dashboard/messaging/api-guide', name: 'api-guide', fullPage: true },
  { route: '/dashboard/webhooks', name: 'webhooks' },
  { route: '/dashboard/account/billing', name: 'billing-pro', fullPage: true },
  {
    route: '/dashboard/account/billing',
    name: 'billing-free',
    fullPage: true,
    overrides: { subscription: mockFreeSubscription },
  },
]

const AUTH_SHOTS: Shot[] = [
  { route: '/login', name: 'login', ready: authReady('Welcome back') },
  { route: '/register', name: 'register', ready: authReady('Create') },
]

// A curated subset that reads well at phone width (for the device frame + gifs).
const MOBILE_SHOTS: Shot[] = [
  { route: '/dashboard', name: 'm-dashboard-overview', fullPage: true },
  { route: '/dashboard/messaging', name: 'm-send-sms', fullPage: true, prepare: fillSendSms },
  { route: '/dashboard/messaging/history', name: 'm-message-history', fullPage: true },
  { route: '/dashboard/webhooks', name: 'm-webhooks', fullPage: true },
]

// Asset capture, not a behaviour test: keep it out of CI and the default run.
test.beforeEach(() => {
  test.skip(!process.env.CAPTURE, 'asset-capture spec; run with CAPTURE=1')
})

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true })
})

test.describe('README assets: desktop (1440w @2x, light)', () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })

  for (const shot of [...DASHBOARD_SHOTS, ...AUTH_SHOTS]) {
    test(`desktop ${shot.name}`, async ({ page, context }) => {
      await capture(page, context, shot)
    })
  }
})

test.describe('README assets: mobile (390w @3x, light)', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: 'light',
  })

  for (const shot of MOBILE_SHOTS) {
    test(`mobile ${shot.name}`, async ({ page, context }) => {
      await capture(page, context, shot)
    })
  }
})
