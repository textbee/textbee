import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'
import { mockDevices } from '../test/fixtures'

async function captureSend(page: import('@playwright/test').Page) {
  const payloads: any[] = []
  await page.route('**/api/v1/gateway/send-sms', (route) => {
    payloads.push(route.request().postDataJSON())
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { success: true } }),
    })
  })
  return payloads
}

// The section streams behind a loading.tsx boundary, so the form's HTML can
// paint before React hydrates it; typing that early into the controlled To
// input is silently wiped when hydration commits. The device name renders
// only after the client-side devices fetch, so its presence proves the form
// is hydrated and its handlers are attached.
// Registered after mockApi, so it answers the devices call first.
async function mockDualSimDevice(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/gateway/devices', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            ...mockDevices[0],
            simInfo: {
              lastUpdated: new Date().toISOString(),
              sims: [
                { subscriptionId: 17, simSlotIndex: 0, carrierName: 'Example Mobile' },
                { subscriptionId: 19, simSlotIndex: 1, carrierName: 'Sample Tel' },
              ],
            },
            simNumbers: [{ slotIndex: 1, phoneNumber: '+15555550177' }],
          },
          mockDevices[1],
        ],
      }),
    })
  )
}

async function gotoSendPage(page: import('@playwright/test').Page) {
  await page.goto('/dashboard/messaging')
  await expect(page.getByLabel('Send from', { exact: true })).toContainText('Pixel 8')
}

test.describe('send sms (mocked API, no real backend)', () => {
  test('commits recipients as chips and posts exactly those numbers', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    const payloads = await captureSend(page)

    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('+1 (415) 555-0101')
    await to.press('Enter')
    await to.fill('+16475550187')
    await to.press('Enter')

    // Both are chips now, each removable.
    await expect(
      page.getByRole('button', { name: 'Remove +14155550101' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Remove +16475550187' })
    ).toBeVisible()

    await page.getByLabel('Message').fill('Hello from the send page')
    await page.getByRole('button', { name: /Send to 2 recipients/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    expect(payloads).toHaveLength(1)
    // Formatting is stripped, because the API schema accepts digits with an
    // optional leading plus.
    expect(payloads[0].recipients).toEqual(['+14155550101', '+16475550187'])
    expect(payloads[0].message).toBe('Hello from the send page')
    // The device is no longer in the URL, so the body is the only thing
    // carrying the explicit selection.
    expect(payloads[0].deviceId).toBe(mockDevices[0]._id)
  })

  test('splits a pasted list into separate chips', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    await page
      .getByLabel('To', { exact: true })
      .fill('+14155550101, +16475550187 +12065550142')
    await page.getByLabel('To', { exact: true }).press('Enter')

    for (const number of ['+14155550101', '+16475550187', '+12065550142']) {
      await expect(
        page.getByRole('button', { name: `Remove ${number}` })
      ).toBeVisible()
    }
  })

  test('keeps a spaced number whole instead of shredding it', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    // Spaces are formatting inside one number here, not separators.
    const to = page.getByLabel('To', { exact: true })
    await to.fill('+1 415 555 0101')
    await to.press('Enter')

    await expect(
      page.getByRole('button', { name: 'Remove +14155550101' })
    ).toBeVisible()
    // Exactly one chip, not four fragments.
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(1)
  })

  test('does not split space-separated numbers into short codes', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('415 555 0101 647 555 0187')
    await to.press('Enter')

    await expect(page.getByText(/too long for one number/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
  })

  test('notes that a short code may need approval on the phone', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('605')
    await to.press('Enter')

    await expect(page.getByText('605 is a short code.', { exact: false })).toBeVisible()
    await expect(page.getByText(/Premium SMS access/)).toBeVisible()
  })

  test('names an invalid character in a formatted number', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('+1 (555) 555#0101')
    await to.press('Enter')

    await expect(page.getByText(/is not a phone number\. Use digits/)).toBeVisible()
  })

  test('says when a number is too short', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('12')
    await to.press('Enter')

    await expect(page.getByText('"12" is too short.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
  })

  test('rejects a number that cannot be dialled', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('not a number')
    await to.press('Enter')

    await expect(
      page.getByText(/contains letters/)
    ).toBeVisible()
  })

  test('does not silently drop a number typed but not committed', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    const payloads = await captureSend(page)

    await gotoSendPage(page)

    // Type a number then go straight to the message without pressing Enter.
    await page.getByLabel('To', { exact: true }).fill('+14155550101')
    await page.getByLabel('Message').fill('Committed on blur')
    await page.getByRole('button', { name: /Send message/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    expect(payloads[0].recipients).toEqual(['+14155550101'])
  })

  test('preselects the only enabled device', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    // Fixtures have one enabled device (Pixel 8) and one disabled. The old
    // implementation computed this in defaultValues before devices loaded, so
    // it never preselected anything.
    await expect(page.getByLabel('Send from', { exact: true })).toContainText('Pixel 8')
  })

  test('counts SMS segments', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    await page.getByLabel('Message').fill('a'.repeat(161))
    await expect(page.getByText(/161 characters, 2 segments/)).toBeVisible()
  })

  test('clears the form after a successful send', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await captureSend(page)

    await gotoSendPage(page)
    const to = page.getByLabel('To', { exact: true })
    await to.fill('+14155550101')
    await to.press('Enter')
    await page.getByLabel('Message').fill('One off')
    await page.getByRole('button', { name: /Send message/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    await expect(page.getByLabel('Message')).toHaveValue('')
    await expect(
      page.getByRole('button', { name: 'Remove +14155550101' })
    ).toHaveCount(0)
    // The device stays selected, since the next message usually goes out the
    // same way.
    await expect(page.getByLabel('Send from', { exact: true })).toContainText('Pixel 8')
  })

  test('sends no SIM field when Default is chosen', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await mockDualSimDevice(page)
    const payloads = await captureSend(page)

    await gotoSendPage(page)
    await expect(page.getByRole('radio', { name: 'Default' })).toHaveAttribute('aria-checked', 'true')
    const to = page.getByLabel('To', { exact: true })
    await to.fill('+14155550101')
    await to.press('Enter')
    await page.getByLabel('Message').fill('From the default SIM')
    await page.getByRole('button', { name: /Send message/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    expect(payloads[0]).not.toHaveProperty('simSlotIndex')
    expect(payloads[0]).not.toHaveProperty('simSubscriptionId')
  })

  test('sends SIM 2 as simSlotIndex 1 and keeps the choice', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await mockDualSimDevice(page)
    const payloads = await captureSend(page)

    await gotoSendPage(page)
    await page.getByRole('radio', { name: /^SIM 2/ }).click()
    await expect(page.getByText('Sends from SIM 2 · Sample Tel · +15555550177')).toBeVisible()

    const to = page.getByLabel('To', { exact: true })
    await to.fill('+14155550101')
    await to.press('Enter')
    await page.getByLabel('Message').fill('From SIM 2')
    await page.getByRole('button', { name: /Send message/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    expect(payloads[0].simSlotIndex).toBe(1)
    expect(payloads[0]).not.toHaveProperty('simSubscriptionId')
    await expect(page.getByRole('radio', { name: /^SIM 2/ })).toHaveAttribute('aria-checked', 'true')
  })

  test('sends a typed subscription ID from the ID option', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await mockDualSimDevice(page)
    const payloads = await captureSend(page)

    await gotoSendPage(page)
    await page.getByRole('radio', { name: 'ID', exact: true }).click()
    await expect(page.getByText('Older option: subscription ID')).toBeVisible()
    await page.getByLabel('SIM subscription ID').fill('19')

    const to = page.getByLabel('To', { exact: true })
    await to.fill('+14155550101')
    await to.press('Enter')
    await page.getByLabel('Message').fill('From an ID')
    await page.getByRole('button', { name: /Send message/ }).click()

    await expect(page.getByText('Message sent')).toBeVisible()
    expect(payloads[0].simSubscriptionId).toBe(19)
    expect(payloads[0]).not.toHaveProperty('simSlotIndex')
  })
})
