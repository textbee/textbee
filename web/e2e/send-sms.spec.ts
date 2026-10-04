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

  test('rejects a number that cannot be dialled', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoSendPage(page)

    const to = page.getByLabel('To', { exact: true })
    await to.fill('not a number')
    await to.press('Enter')

    await expect(
      page.getByText(/does not look like a phone number/)
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
})
