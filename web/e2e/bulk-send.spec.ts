import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'
import { mockDevices } from '../test/fixtures'

// The defect this guards: the previous implementation mapped every parsed row
// into the payload, so blank cells produced messages addressed to "" and the
// same number appearing twice was texted twice.

const CSV_WITH_PROBLEM_ROWS = [
  'name,phone,order_id,total',
  'Alice Johnson,+14155550101,ORD-1042,49.99',
  'No Number,,ORD-1043,10.00',
  'Bob Martinez,+16475550187,ORD-1044,128.50',
  'Junk Row,call me later,ORD-1045,5.00',
  'Alice Again,+1 (415) 555-0101,ORD-1046,20.00',
].join('\n')

async function uploadCsv(page: import('@playwright/test').Page, csv: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'recipients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  })
}

// The section streams behind a loading.tsx boundary, so the form's HTML can
// paint before React hydrates it, and a file offered during that gap is
// silently discarded (react-dropzone binds its change handler on mount).
// The row cap in the dropzone copy is derived from useSubscription inside this
// page's own hook, so seeing it proves this component hydrated and has data.
// Waiting on the devices response would not: the dashboard layout requests the
// same query key, so it can resolve before this page has hydrated.
async function gotoBulkPage(page: import('@playwright/test').Page) {
  await page.goto('/dashboard/messaging/bulk')
  await expect(
    page.getByText(/Up to 1 MB and [\d,]+ rows on your plan/)
  ).toBeVisible()
}

// Keyboard selection rather than clicking the option: the Radix popper can
// render outside the viewport on a short page, which made the click flaky.
async function selectDevice(page: import('@playwright/test').Page) {
  // Fixtures: Google Pixel 8 is the enabled device.
  await page.getByLabel('Send from', { exact: true }).press('Enter')
  await page.getByRole('option', { name: /Google Pixel 8/ }).press('Enter')
  await expect(page.getByLabel('Send from', { exact: true })).toContainText('Google Pixel 8')
}

test.describe('bulk send (mocked API, no real backend)', () => {
  test('sends only valid, deduplicated recipients', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    // Capture what the app actually posts to the gateway.
    let payload: any = null
    await page.route('**/api/v1/gateway/send-bulk-sms', (route) => {
      payload = route.request().postDataJSON()
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { success: true } }),
      })
    })

    await gotoBulkPage(page)

    await uploadCsv(page, CSV_WITH_PROBLEM_ROWS)

    // Parse summary and auto-detected phone column.
    await expect(page.getByText('5 rows, 4 columns')).toBeVisible()
    await expect(page.getByText('2 will receive a message')).toBeVisible()
    await expect(page.getByText('1 with no number')).toBeVisible()
    await expect(page.getByText('1 invalid')).toBeVisible()
    await expect(page.getByText('1 duplicate')).toBeVisible()

    await selectDevice(page)

    await page
      .getByLabel('Message template')
      .fill('Hi {{ name }}, order {{ order_id }} confirmed.')

    await page.getByRole('button', { name: /send 2 messages/i }).click()

    await expect(page.getByText('2 messages queued')).toBeVisible()

    // The payload is the real assertion.
    expect(payload).not.toBeNull()
    expect(payload.messages).toHaveLength(2)
    // The device is no longer in the URL, so the body is the only thing
    // carrying the explicit selection.
    expect(payload.deviceId).toBe(mockDevices[0]._id)

    const recipients = payload.messages.flatMap((m: any) => m.recipients)
    expect(recipients).toEqual(['+14155550101', '+16475550187'])
    // No empty recipient may ever be sent.
    expect(recipients.some((r: string) => !r || !r.trim())).toBe(false)

    // Template interpolation actually happened per row.
    expect(payload.messages[0].message).toBe(
      'Hi Alice Johnson, order ORD-1042 confirmed.'
    )
  })

  test('offers a downloadable sample CSV', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    const link = page.getByRole('link', { name: /download a sample csv/i })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('download', '')

    // The file must actually be served, not just linked.
    const response = await page.request.get('/samples/bulk-sms-sample.csv')
    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).toContain('name,phone,order_id,total')
    expect(body).toContain('+14155550101')
  })

  test('states the file size limit in human terms', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    // The old copy printed the raw byte count ("max 1048576 bytes").
    await expect(page.getByText('1048576')).toHaveCount(0)
    await expect(page.getByText(/Up to 1 MB/)).toBeVisible()
  })

  test('the parsed-CSV table does not widen the page at 375px', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    // A wide table is the obvious way to reintroduce the sideways-scroll bug,
    // and it only exists once a file has been parsed.
    await uploadCsv(page, CSV_WITH_PROBLEM_ROWS)
    await expect(page.getByText('5 rows, 4 columns')).toBeVisible()

    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
  })

  test('warns when the template references a missing column', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    await uploadCsv(page, CSV_WITH_PROBLEM_ROWS)
    await selectDevice(page)

    await page.getByLabel('Message template').fill('Hi {{ nickname }}')

    await expect(page.getByText(/Unknown column reference/)).toBeVisible()
    await expect(page.getByText(/no column named "nickname"/)).toBeVisible()
  })

  // The columns used to be read off the first parsed row rather than the
  // header. papaparse only assigns keys for values actually present, so a
  // short first row made every column after it vanish: the phone column could
  // not be selected and the whole file was unusable.
  test('keeps every column when the first data row is short', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    await uploadCsv(
      page,
      [
        'name,phone,order_id',
        'Missing Everything Else',
        'Bob Martinez,+16475550187,ORD-1044',
      ].join('\n')
    )

    await expect(page.getByText('2 rows, 3 columns')).toBeVisible()

    // The real proof: the phone column was still detected and mapped, which is
    // impossible if the column list came from that first row.
    await expect(page.getByLabel('Phone number column')).toContainText('phone')
    await expect(page.getByText('1 will receive a message')).toBeVisible()
  })

  test('explains why a non-CSV file was rejected', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await gotoBulkPage(page)

    // Rejected drops used to return silently, so nothing happened and nothing
    // said why.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'contacts.xlsx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('not a csv'),
    })

    await expect(page.getByText(/is not a CSV/)).toBeVisible()
  })
})
