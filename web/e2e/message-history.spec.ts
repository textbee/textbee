import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'

test.describe('message history (mocked API, no real backend)', () => {
  test('groups messages under day headings', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging/history')

    // Fixtures: one message 2h old, one 30h old.
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Yesterday' })).toBeVisible()
    await expect(page.getByText('Hello from textbee')).toBeVisible()
    await expect(page.getByText('Reply from a customer')).toBeVisible()
  })

  // Checked at both widths: the mobile break was a header pinned to the same
  // offset as the search bar, and the desktop one was a header covering rows
  // and swallowing their clicks.
  for (const viewport of [
    { name: 'mobile', width: 390, height: 700 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`day headers never overlap message rows on ${viewport.name}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await authenticate(context)
      await mockApi(page)

      // Enough messages across several days to force scrolling.
      const at = (days: number, hours: number) =>
        new Date(Date.now() - days * 86400000 - hours * 3600000).toISOString()
      await page.route('**/api/v1/gateway/messages*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: Array.from({ length: 12 }).map((_, i) => ({
              _id: `m${i}`,
              sender: `+120255501${40 + i}`,
              message: 'A message long enough to wrap onto a second line here',
              status: 'received',
              type: 'received',
              receivedAt: at(Math.floor(i / 3), i),
              createdAt: at(Math.floor(i / 3), i),
            })),
            meta: { total: 12, page: 1, limit: 20, totalPages: 1 },
          }),
        })
      )

      await page.goto('/dashboard/messaging/history')
      await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 420))

      const headers = await page.locator('h3').all()
      const rows = await page.getByRole('button', { name: /\+1202555/ }).all()

      for (const header of headers) {
        const hb = await header.boundingBox()
        if (!hb) continue
        for (const row of rows) {
          const rb = await row.boundingBox()
          if (!rb) continue
          const overlap =
            Math.min(hb.y + hb.height, rb.y + rb.height) - Math.max(hb.y, rb.y)
          expect(
            overlap,
            'a day header must not cover a message row'
          ).toBeLessThanOrEqual(1)
        }
      }

      // A covering header also swallowed the row's click, so the row must
      // still be clickable after scrolling.
      await page.getByRole('button', { name: /\+1202555/ }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })
  }

  test('search is sent to the server, not applied to the loaded page', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    const requested: string[] = []
    // fallback(), not continue(): continue() would send the request to the
    // network instead of chaining to the mockApi handler registered earlier.
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await expect(page.getByText('Hello from textbee')).toBeVisible()

    await page.getByLabel('Search messages').fill('customer')

    // The whole point of the backend param: a request must carry the term, so
    // results come from all history rather than the 20 rows already loaded.
    await expect
      .poll(() => requested.some((url) => url.includes('search=customer')), {
        message: 'a request carrying search=customer should be issued',
      })
      .toBe(true)
  })

  test('debounces so typing does not fire a request per keystroke', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    let searchRequests = 0
    await page.route('**/api/v1/gateway/messages*', (route) => {
      if (route.request().url().includes('search=')) searchRequests += 1
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await expect(page.getByText('Hello from textbee')).toBeVisible()

    // Type quickly; a naive implementation would fire one request per letter.
    await page.getByLabel('Search messages').pressSequentially('customer', {
      delay: 20,
    })
    await page.waitForTimeout(700)

    expect(searchRequests).toBeGreaterThan(0)
    expect(searchRequests).toBeLessThan(4)
  })

  test('offers a way out when a search matches nothing', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    await page.route('**/api/v1/gateway/messages*', (route) => {
      if (route.request().url().includes('search=')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
          }),
        })
      }
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await page.getByLabel('Search messages').fill('zzzznothing')

    await expect(page.getByText(/No messages match/)).toBeVisible()
    await page.getByRole('button', { name: 'Show all messages' }).click()

    // Clearing restores the unfiltered list.
    await expect(page.getByText('Hello from textbee')).toBeVisible()
  })

  test('a row opens the details dialog with the message body', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging/history')

    await page.getByRole('button', { name: /Hello from textbee/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Hello from textbee')).toBeVisible()
    // Exact timestamp is text here, since the list tooltip is hover-only.
    await expect(dialog.getByText(/\d{4} at \d{1,2}:\d{2}/)).toBeVisible()
  })

  test('each detail field copies its own value', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    await page.route('**/api/v1/gateway/messages*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            {
              _id: 'copy_1',
              recipient: '+15557654321',
              message: 'Copy me exactly',
              status: 'delivered',
              type: 'sent',
              gatewayMessageId: '665f1c2a9b1e4a0012ab34cd',
              device: { _id: 'device_1', brand: 'Google', model: 'Pixel 8' },
              requestedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        }),
      })
    )

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('button', { name: /Copy me exactly/ }).click()

    const dialog = page.getByRole('dialog')
    const read = () => page.evaluate(() => navigator.clipboard.readText())

    // One button per field, each named for what it copies, replacing a single
    // footer "Copy text" whose target had to be inferred.
    await dialog.getByRole('button', { name: 'Copy number' }).click()
    expect(await read()).toBe('+15557654321')

    await dialog.getByRole('button', { name: 'Copy message' }).click()
    expect(await read()).toBe('Copy me exactly')

    await dialog.getByRole('button', { name: 'Copy gateway ID' }).click()
    expect(await read()).toBe('665f1c2a9b1e4a0012ab34cd')
  })

  // Support alerts carry a full conversation URL, which has no break
  // opportunity. That single token used to set a min-content floor on the
  // dialog's grid track, pushing the message box, the error panel and the
  // action button hundreds of pixels outside the card.
  for (const viewport of [
    { name: 'mobile', width: 375, height: 800 },
    { name: 'desktop', width: 1280, height: 800 },
  ]) {
    test(`a long unbreakable URL stays inside the details dialog on ${viewport.name}`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      await authenticate(context)
      await mockApi(page)

      await page.route('**/api/v1/gateway/messages*', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                _id: 'longurl_1',
                recipient: '+12025550123',
                message:
                  'Support request - textbee support\nUrgency: Urgent\nView conversation:\nhttps://dash.supporthq.app/dashboard/projects/69a591f28bdb2cda5452246b/conversations/69c2a0a058b1a815140a9be5',
                status: 'failed',
                type: 'sent',
                errorCode: '1',
                errorMessage:
                  'SMS failed on device. Common causes: no SMS credit on SIM, weak signal, or carrier blocked. Check SIM balance and signal, then try again. (code 0)',
                device: { _id: 'device_1', brand: 'samsung', model: 'SM-A346E' },
                requestedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
              },
            ],
            meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
          }),
        })
      )

      await page.goto('/dashboard/messaging/history')
      await page.getByRole('button', { name: /Support request/ }).click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      const overflows = await dialog.evaluate(
        (el) => el.scrollWidth > el.clientWidth + 1
      )
      expect(overflows, 'details dialog must not scroll sideways').toBe(false)

      // The visible symptom was the action button rendering outside the card,
      // which a scrollWidth check alone would miss if a parent clipped it.
      const dialogBox = await dialog.boundingBox()
      const buttonBox = await dialog
        .getByRole('button', { name: 'Follow up' })
        .boundingBox()
      expect(dialogBox && buttonBox).toBeTruthy()
      expect(
        buttonBox!.x + buttonBox!.width,
        'the action button must stay inside the dialog'
      ).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1)

      // The page must not gain a sideways scrollbar either.
      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      )
      expect(pageOverflow, 'page must not scroll sideways').toBeLessThanOrEqual(
        0
      )
    })
  }

  test('replying from a received message keeps a device selected', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging/history')

    await page.getByRole('button', { name: /Reply from a customer/ }).click()
    await page.getByRole('button', { name: 'Reply' }).click()

    // Without a device the composer cannot send, so this must never be empty.
    await expect(page.getByLabel('Send from')).toContainText('Pixel 8')
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(
      '+15551234567'
    )
  })

  test('filters by direction', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)

    const requested: string[] = []
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('tab', { name: 'Received' }).click()

    await expect
      .poll(() => requested.some((url) => url.includes('direction=received')))
      .toBe(true)
  })

  // The old dropdown opened with every device checked, so this click widened
  // the scope instead of narrowing it, and dismissed the list on the way out.
  test('picking a device narrows the request and leaves the list open', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    const requested: string[] = []
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('button', { name: /^Devices:/ }).click()
    await page.getByRole('option', { name: /Google Pixel 8/ }).click()

    await expect
      .poll(() => requested.some((url) => url.includes('deviceIds=device_1')), {
        message: 'a request scoped to the picked device should be issued',
      })
      .toBe(true)

    await expect(
      page.getByRole('option', { name: /Samsung Galaxy S23/ })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /^Devices:/ })).toContainText(
      'Pixel 8'
    )
  })

  test('the filters popover narrows the request and counts what is applied', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    const requested: string[] = []
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('button', { name: 'Failed' }).click()
    await page.getByRole('button', { name: 'Oldest first' }).click()
    await page.getByRole('button', { name: 'Apply' }).click()

    await expect
      .poll(() =>
        requested.some(
          (url) => url.includes('status=failed') && url.includes('order=asc')
        )
      )
      .toBe(true)
    await expect(
      page.getByRole('button', { name: 'Filters, 2 applied' })
    ).toBeVisible()
    await expect(page).toHaveURL(/status=failed/)

    await page
      .getByRole('button', { name: 'Remove filter: Status: Failed' })
      .click()
    await expect(
      page.getByRole('button', { name: 'Filters, 1 applied' })
    ).toBeVisible()
    await expect(page).not.toHaveURL(/status=/)
  })

  test('the filters popover holds a bad batch id back', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByLabel('Batch ID').fill('not-a-batch')
    await expect(page.getByText('A batch ID has 24 characters: digits 0-9 and letters a-f.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  test('a batch that is not on the account gets its own way out', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.route('**/api/v1/gateway/messages*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Batch not found: 665f1c2a9b1e4a0012ab34cd',
        }),
      })
    )

    await page.goto(
      '/dashboard/messaging/history?batch=665f1c2a9b1e4a0012ab34cd'
    )
    await expect(page.getByText('This batch is not on your account')).toBeVisible()
    await expect(page.getByText(/^Error:/)).toHaveCount(0)
  })

  test('filters survive a refresh through the URL', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    await page.goto('/dashboard/messaging/history')
    await page.getByRole('button', { name: /^Devices:/ }).click()
    await page.getByRole('option', { name: /Google Pixel 8/ }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: 'Received' }).click()
    await page.getByLabel('Search messages').fill('customer')

    await expect(page).toHaveURL(
      /devices=device_1&direction=received&search=customer/
    )

    const requested: string[] = []
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })
    await page.reload()

    await expect(page.getByRole('button', { name: /^Devices:/ })).toContainText(
      'Pixel 8'
    )
    await expect(page.getByRole('tab', { name: 'Received' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByLabel('Search messages')).toHaveValue('customer')
    await expect
      .poll(() =>
        requested.some(
          (url) =>
            url.includes('deviceIds=device_1') &&
            url.includes('direction=received') &&
            url.includes('search=customer')
        )
      )
      .toBe(true)
  })

  // The debounce used to reset the page on mount, which silently dropped the
  // page a shared link asked for 300ms after it loaded.
  test('a shared link applies its filters on the first request', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    const requested: string[] = []
    await page.route('**/api/v1/gateway/messages*', (route) => {
      requested.push(route.request().url())
      return route.fallback()
    })

    await page.goto(
      '/dashboard/messaging/history?devices=device_2&direction=sent&search=hello&page=2'
    )
    await expect
      .poll(() => requested.length, { message: 'a request should be issued' })
      .toBeGreaterThan(0)

    expect(requested[0]).toContain('deviceIds=device_2')
    expect(requested[0]).toContain('direction=sent')
    expect(requested[0]).toContain('search=hello')
    expect(requested[0]).toContain('page=2')

    // Give the debounce time to fire before asserting it did not reset.
    await page.waitForTimeout(600)
    expect(requested.some((url) => url.includes('page=1'))).toBe(false)
    await expect(page).toHaveURL(/page=2/)
  })
})
