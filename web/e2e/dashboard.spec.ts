import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'
import { mockDevices } from '../test/fixtures'

// The dashboard sections stream behind a loading.tsx boundary, so their HTML
// can paint before React hydrates. A click landing in that gap hits a button
// whose handler is not attached yet, the dialog never opens, and the test
// waits out its timeout on a heading that was never going to render. The
// total-sent figure comes from the client-side gateway stats fetch, so its
// presence proves hydration effects have run.
async function gotoDashboard(page: import('@playwright/test').Page) {
  await page.goto('/dashboard')
  await expect(page.getByText('12,840')).toBeVisible()
}

test.describe('dashboard (mocked API, no real backend)', () => {
  test('redirects unauthenticated users to login', async ({ page }) => {
    await mockApi(page)
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/login/)
  })

  test('redirects authenticated users away from login', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('renders the dashboard with mocked data for an authenticated user', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    await page.goto('/dashboard')

    await expect(
      page.getByRole('heading', { name: 'Welcome back, Test', level: 2 })
    ).toBeVisible()
    // Quick actions row.
    await expect(page.getByRole('link', { name: 'Send SMS' })).toBeVisible()
    // Total SMS sent stat from the mocked gateway stats fixture (12,840).
    await expect(page.getByText('12,840')).toBeVisible()
    // Onboarding card shows its progress bar (all 6 steps done in fixtures).
    await expect(
      page.getByRole('progressbar', { name: 'Setup progress' })
    ).toBeVisible()
    await expect(page.getByText('6 of 6')).toBeVisible()
    // Webhooks summary row keeps a mobile path to /dashboard/webhooks
    // (fixtures have 1 active webhook).
    await expect(
      page.getByRole('link', { name: /active webhook/ })
    ).toBeVisible()
  })

  // "Add device" used to open the API key modal directly from the header,
  // handing a first-time user a key with no mention of installing the app or
  // granting SMS permissions. Both entry points now share one flow.
  for (const entry of [
    { name: 'header quick action', nth: 0 },
    { name: 'devices card', nth: 1 },
  ]) {
    test(`add device from the ${entry.name} explains the steps first`, async ({
      page,
      context,
    }) => {
      await authenticate(context)
      await mockApi(page)
      await gotoDashboard(page)

      await page
        .getByRole('button', { name: 'Add device' })
        .nth(entry.nth)
        .click()

      const dialog = page.getByRole('dialog')
      await expect(
        dialog.getByRole('heading', { name: 'Add a device' })
      ).toBeVisible()
      // The prerequisites a key modal never mentioned.
      await expect(dialog.getByText(/allow the SMS permission/i)).toBeVisible()

      // Key generation is still reachable, just no longer the first thing.
      await expect(
        dialog.getByRole('heading', { name: 'Create new API Key' })
      ).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Continue' }).click()
      await expect(
        page.getByRole('heading', { name: 'Create new API Key' })
      ).toBeVisible()
    })
  }

  test('new API key still goes straight to key generation', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoDashboard(page)

    // That button asks for a key, so device instructions would be noise.
    await page.getByRole('button', { name: 'New API key' }).click()
    await expect(
      page.getByRole('heading', { name: 'Create new API Key' })
    ).toBeVisible()
  })

  // These sections used to render a bare "Error: Request failed with status
  // code 500" with no styling and no way to recover.
  test('a failed devices request explains itself and offers a retry', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    // Held failing rather than failing once: react-query retries a failed
    // query several times before surfacing an error, so a single failure would
    // recover on its own and the error state would never render.
    let failDevices = true
    await page.route('**/api/v1/gateway/devices', (route) => {
      if (route.request().method() !== 'GET' || !failDevices)
        return route.fallback()
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Devices are temporarily unavailable' }),
      })
    })

    await page.goto('/dashboard')

    // Generous: the retries back off before the error is shown.
    await expect(page.getByText("Couldn't load your devices")).toBeVisible({
      timeout: 30000,
    })
    // The server's message, not the axios transport string.
    await expect(
      page.getByText('Devices are temporarily unavailable')
    ).toBeVisible()
    await expect(page.getByText(/Request failed with status code/)).toHaveCount(
      0
    )

    failDevices = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText("Couldn't load your devices")).toHaveCount(0)
  })

  test('leads with real quota usage, not invented trends', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard')

    // Daily and monthly windows straight from the subscription fixture:
    // 320 of 5,000 today, 18,450 of 100,000 this month.
    await expect(
      page.getByRole('progressbar', { name: 'Today usage' })
    ).toBeVisible()
    await expect(
      page.getByRole('progressbar', { name: 'Last 30 days usage' })
    ).toBeVisible()
    await expect(page.getByText('/ 5,000')).toBeVisible()
    await expect(page.getByText('4,680 remaining')).toBeVisible()

    // The quota counts inbound messages too (the backend counts SMS documents
    // with no type filter), so the label must not claim these are only sends.
    await expect(
      page.getByText(/Counts messages sent and received/)
    ).toBeVisible()

    // The old page decorated every stat with a green trend arrow and captioned
    // all-time totals "Since last year". Nothing computed either.
    await expect(page.getByText('Since last year')).toHaveCount(0)
    await expect(page.getByText('Connected now')).toHaveCount(0)
  })

  // The default device is what the API sends from when a request omits
  // deviceId, so promoting one has to be visible on the list straight away.
  test('setting a default device moves the badge to that device', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    // Fixtures start with the Pixel 8 as default. Both devices are served
    // enabled because only enabled devices offer the promote action. The list
    // refetches after the mutation, so the flipped flag has to come from the
    // served list too: a 200 alone would leave the badge where it was.
    let defaultDeviceId = mockDevices[0]._id
    await page.route('**/api/v1/gateway/devices', (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: mockDevices.map((device) => ({
            ...device,
            enabled: true,
            isDefault: device._id === defaultDeviceId,
          })),
        }),
      })
    })
    await page.route('**/api/v1/gateway/devices/*/set-default', (route) => {
      // A UI bug posting the Pixel's id would otherwise still move the badge
      expect(route.request().url()).toContain(mockDevices[1]._id)
      expect(route.request().method()).toBe('POST')
      defaultDeviceId = mockDevices[1]._id
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { ...mockDevices[1], enabled: true, isDefault: true },
        }),
      })
    })

    await gotoDashboard(page)

    // The badge sits in the row beside the device name, so the heading's
    // parent is what scopes each assertion to one device.
    const badges = (name: string) =>
      page.getByRole('heading', { name, level: 3 }).locator('xpath=..')
    const pixel = badges('Google Pixel 8')
    const galaxy = badges('Samsung Galaxy S23')

    await expect(pixel).toContainText('Default')
    await expect(galaxy).not.toContainText('Default')

    // Second row is the Galaxy; the already-default Pixel offers no such item.
    await page.getByRole('button', { name: 'Device actions' }).nth(1).click()
    await page.getByRole('menuitem', { name: 'Set as default' }).click()

    await expect(page.getByText('Default device updated')).toBeVisible()
    await expect(galaxy).toContainText('Default')
    await expect(pixel).not.toContainText('Default')
  })
})
