import { test, type Page, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { authenticate } from './session'
import { mockApi } from './mock-api'
import { mockMessages, mockWebhooks } from '../test/fixtures'

// Records short screen-capture videos (.webm) of real dashboard flows against
// the mocked backend, for README GIFs and marketing clips. Playwright writes one
// video per test under test-results/; scripts/make-gifs.sh converts them.
// Gated behind CAPTURE=1 so `pnpm test:e2e` and CI skip it:
//   CAPTURE=1 pnpm exec playwright test e2e/record.spec.ts
// This is capture, not assertion. Timing is everything here: real users pause
// between actions, so every click is led by a hover beat and followed by a hold
// long enough to read the new state. Without those dwells the motion feels
// rushed because Playwright actions are otherwise instant.

const SIZE = { width: 1600, height: 900 }

test.use({
  viewport: SIZE,
  colorScheme: 'light',
  video: { mode: 'on', size: SIZE },
})

// Asset capture, not a behaviour test: keep it out of CI and the default run.
// The deliberate dwells make these flows run well past the 30s default.
test.beforeEach(() => {
  test.skip(!process.env.CAPTURE, 'asset-capture spec; run with CAPTURE=1')
  test.setTimeout(120_000)
})

async function blockThirdParties(page: Page) {
  await page.route(
    /googletagmanager|google-analytics|clarity\.ms|tawk\.to|supporthq/,
    (route) => route.abort()
  )
}

async function forceLightTheme(page: Page) {
  await page.addInitScript(() =>
    window.localStorage.setItem('theme', 'light')
  )
}

async function hideChrome(page: Page) {
  await page.evaluate(() => {
    const main = document.querySelector('main#main-content')
    const banners = main?.previousElementSibling as HTMLElement | null
    if (banners && banners.tagName === 'DIV') banners.style.display = 'none'
  })
}

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
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms)

// A click with human rhythm: settle on the element (hover shows its hover
// state), a short beat, the click, then a hold so the result registers.
async function beatClick(page: Page, target: Locator, hold = 1400) {
  await target.hover()
  await pause(page, 650)
  await target.click()
  await pause(page, hold)
}

async function setup(page: Page, context: import('@playwright/test').BrowserContext) {
  await forceLightTheme(page)
  await blockThirdParties(page)
  await authenticate(context)
  await mockApi(page)
}

test('send-sms flow', async ({ page, context }) => {
  await setup(page, context)
  await page.goto('/dashboard/messaging')
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 1900) // establish the empty compose form

  const to = page.locator('#sms-recipient')
  await to.hover()
  await pause(page, 500)
  await to.click()
  await pause(page, 450)
  await to.pressSequentially('+14155550134', { delay: 120 })
  await pause(page, 550)
  await to.press('Enter')
  await pause(page, 1400) // dwell on the recipient chip

  const msg = page.locator('#sms-message')
  await msg.hover()
  await pause(page, 400)
  await msg.click()
  await pause(page, 350)
  await msg.pressSequentially(
    'Your textbee code is 481920. It expires in 10 minutes.',
    { delay: 45 }
  )
  await pause(page, 2000) // let the composed message be read

  // Hover the send button (its hover state shows) before committing.
  await beatClick(page, page.getByRole('button', { name: /Send message/i }), 3400)
})

test('dashboard tour', async ({ page, context }) => {
  await setup(page, context)
  await page.goto('/dashboard')
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 2200) // establish the dashboard

  // Slow reveal of the stats + devices below the fold.
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 20)
    await pause(page, 28)
  }
  await pause(page, 1600)
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(page, 1800)

  const nav = page.getByRole('navigation', { name: 'Main' })

  await beatClick(page, nav.getByRole('link', { name: 'Messaging' }), 400)
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 2200)

  await beatClick(page, nav.getByRole('link', { name: 'Webhooks' }), 400)
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 2200)

  await beatClick(page, nav.getByRole('link', { name: 'Dashboard' }), 400)
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 1800)
})

test('api guide language tabs', async ({ page, context }) => {
  await setup(page, context)
  await page.goto('/dashboard/messaging/api-guide')
  await waitForContent(page)
  await hideChrome(page)
  // Let hydration settle: the syntax-highlighted code blocks re-render on mount
  // and briefly detach the tablist. Then scroll a tab (not the container) in.
  await pause(page, 1400)
  await page.getByRole('tab', { name: 'cURL', exact: true }).scrollIntoViewIfNeeded()
  await pause(page, 1500)
  for (const lang of ['Node.js', 'Python', 'PHP', 'Go', 'cURL']) {
    await beatClick(page, page.getByRole('tab', { name: lang, exact: true }), 1700)
  }
})

test('create a webhook', async ({ page, context }) => {
  await setup(page, context)
  // Make the mock stateful for webhooks so the created one appears in the list
  // (the shared mock is stateless and would keep showing only the fixture).
  const created: Record<string, unknown>[] = []
  await page.route('**/api/v1/webhooks', (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}')
      created.unshift({
        _id: 'wh_created',
        isActive: true,
        events: ['message.received'],
        createdAt: new Date().toISOString(),
        ...body,
      })
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ data: created[0] }),
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [...created, ...mockWebhooks] }),
    })
  })
  await page.goto('/dashboard/webhooks')
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 1500)

  await beatClick(
    page,
    page.getByRole('button', { name: 'Create Webhook' }).first(),
    900
  )
  const dialog = page.getByRole('dialog')
  const name = dialog.getByPlaceholder('e.g. Production CRM')
  await name.click()
  await name.pressSequentially('Order notifications', { delay: 55 })
  await pause(page, 700)
  const url = dialog.getByPlaceholder('https://api.example.com/webhooks')
  await url.click()
  await url.pressSequentially('https://api.myshop.com/textbee', { delay: 45 })
  await pause(page, 1300)
  await beatClick(page, dialog.getByRole('button', { name: 'Create', exact: true }), 2800)
})

test('message history filter', async ({ page, context }) => {
  await setup(page, context)
  // History filtering is server-side; honour the type/search params so the GIF
  // actually filters instead of clicking controls that never change the list.
  await page.route('**/api/v1/gateway/messages*', (route) => {
    const url = new URL(route.request().url())
    const type = url.searchParams.get('type') || 'all'
    const search = (url.searchParams.get('search') || '').toLowerCase()
    type Msg = {
      type: string
      message: string
      recipient?: string
      sender?: string
    }
    let data = mockMessages.data as unknown as Msg[]
    if (type !== 'all') data = data.filter((m) => m.type === type)
    if (search)
      data = data.filter((m) =>
        `${m.message} ${m.recipient ?? ''} ${m.sender ?? ''}`
          .toLowerCase()
          .includes(search)
      )
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...mockMessages,
        data,
        meta: { ...mockMessages.meta, total: data.length },
      }),
    })
  })
  await page.goto('/dashboard/messaging/history')
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 1600)

  const search = page.getByPlaceholder('Search messages or numbers')
  await search.click()
  await search.pressSequentially('customer', { delay: 95 })
  await pause(page, 1900) // filtered to the received "Reply from a customer"
  await beatClick(page, page.getByRole('button', { name: 'Clear search' }), 1100)

  await beatClick(page, page.getByRole('tab', { name: 'Sent' }), 1700)
  await beatClick(page, page.getByRole('tab', { name: 'Received' }), 1700)
  await beatClick(page, page.getByRole('tab', { name: 'All' }), 1400)
})

test('bulk send', async ({ page, context }) => {
  await setup(page, context)
  await page.goto('/dashboard/messaging/bulk')
  await waitForContent(page)
  await hideChrome(page)
  await pause(page, 1500)

  // Papaparse runs client-side, so a real CSV drives the whole wizard.
  const csv = [
    'name,phone,order_id,total',
    'Amina,+15551234567,A-1043,42.00',
    'Ben,+15559876543,A-1044,18.50',
    'Chidi,+15550112233,A-1045,73.20',
    'Dara,+15557654321,A-1046,9.99',
  ].join('\n')
  const csvPath = join(tmpdir(), 'textbee-bulk-demo.csv')
  writeFileSync(csvPath, csv)
  await page.locator('input[type="file"]').first().setInputFiles(csvPath)
  await pause(page, 2400) // parse + preview table

  // Reveal the auto-detected column mapping (scrollIntoView is deterministic;
  // the earlier wheel loop raced the compose textarea into/out of view).
  await page.getByText('Choose the phone column').scrollIntoViewIfNeeded()
  await pause(page, 1800)

  // Personalise the template with the CSV columns.
  const tpl = page.locator('#message-template')
  await tpl.scrollIntoViewIfNeeded()
  await tpl.waitFor({ state: 'visible' })
  await pause(page, 800)
  // The sticky section tabs overlap the textarea's click point after scrolling,
  // so click/keyboard focus never lands on it. Drive the controlled input
  // through React's native value setter + input event, growing it a few
  // characters at a time so it still reads as typing on screen.
  const template =
    'Hi {{ name }}, your order {{ order_id }} is confirmed. Total: ${{ total }}.'
  for (let i = 4; i <= template.length; i += 4) {
    await tpl.evaluate((el, val) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!
      setter.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, template.slice(0, i))
    await pause(page, 55)
  }
  await pause(page, 2000)

  // End on the review step.
  await page.getByText('Review and send').scrollIntoViewIfNeeded()
  await pause(page, 2400)
})
