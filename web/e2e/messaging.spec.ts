import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'

test.describe('messaging (mocked API, no real backend)', () => {
  test('renders the send view with route tabs', async ({ page, context }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging')

    await expect(
      page.getByRole('heading', { name: 'Messaging', level: 2 })
    ).toBeVisible()
    // Route tabs are links now.
    const nav = page.getByRole('navigation', { name: 'Section navigation' })
    await expect(nav.getByRole('link', { name: 'Send', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'History' })).toBeVisible()
    // Send is the active tab on the index route.
    await expect(
      nav.getByRole('link', { name: 'Send', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })

  test('history tab navigates to its own URL and renders mocked messages', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging')

    await page
      .getByRole('navigation', { name: 'Section navigation' })
      .getByRole('link', { name: 'History' })
      .click()

    await expect(page).toHaveURL(/\/dashboard\/messaging\/history/)
    await expect(page.getByText('Hello from textbee')).toBeVisible()
  })

  test('history deep link survives refresh (route-based tabs)', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    // Load the subroute directly: this is the refresh-survival guarantee.
    await page.goto('/dashboard/messaging/history')

    const nav = page.getByRole('navigation', { name: 'Section navigation' })
    await expect(nav.getByRole('link', { name: 'History' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByText('Hello from textbee')).toBeVisible()
    // Never fell through to an error boundary.
    await expect(page.getByText('This page couldn')).toHaveCount(0)
  })

  test('every tab renders in the same content column', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await authenticate(context)
    await mockApi(page)

    // Each subroute used to set its own width (Send xl, Bulk 3xl, API 4xl,
    // History none), so the layout jumped on every tab change.
    const columns: Record<string, number> = {}
    let available = 0
    for (const path of [
      '/dashboard/messaging',
      '/dashboard/messaging/bulk',
      '/dashboard/messaging/history',
      '/dashboard/messaging/api-guide',
    ]) {
      await page.goto(path)
      await expect(
        page.getByRole('navigation', { name: 'Section navigation' })
      ).toBeVisible()

      // Measure the view rendered beneath the tabs, not the layout column.
      // The column is identical on every tab by construction, so measuring it
      // cannot detect a page that re-constrains its own content.
      const measured = await page.evaluate(() => {
        const nav = document.querySelector(
          'nav[aria-label="Section navigation"]'
        )
        const content = nav!.nextElementSibling as HTMLElement
        const parent = nav!.parentElement!.parentElement!
        const style = getComputedStyle(parent)
        return {
          content: Math.round(content.getBoundingClientRect().width),
          // Content width, with the parent's padding subtracted. Using the
          // border box would include that padding, so an unconstrained
          // full-width column would still measure as narrower than its parent.
          available: Math.round(
            parent.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight)
          ),
        }
      })
      columns[path] = measured.content
      available = measured.available
    }

    const widths = Object.values(columns)
    expect(
      new Set(widths).size,
      `tabs should share one column width, got ${JSON.stringify(columns)}`
    ).toBe(1)

    // Compared against the space actually available, not the viewport:
    // dropping the constraint makes every tab equally full-bleed, which would
    // otherwise satisfy the equality check above.
    expect(
      widths[0],
      'the column should be constrained, not stretched to fill'
    ).toBeLessThan(available)
  })

  test('breadcrumbs name the page and link back up', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/messaging/history')

    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' })
    await expect(crumbs.getByRole('listitem')).toHaveText([
      'Dashboard',
      'Messaging',
      'History',
    ])
    await expect(crumbs.getByText('History')).toHaveAttribute(
      'aria-current',
      'page'
    )

    await crumbs.getByRole('link', { name: 'Messaging' }).click()
    await expect(page).toHaveURL(/\/dashboard\/messaging$/)
    await expect(crumbs.getByRole('listitem').last()).toHaveText('Send')
  })
})
