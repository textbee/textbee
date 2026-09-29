import { expect, test } from '@playwright/test'
import { authenticate } from './session'
import { mockApi } from './mock-api'
import { mockFreeSubscription, mockSubscription } from '../test/fixtures'

test.describe('account settings (mocked API, no real backend)', () => {
  test('/dashboard/account redirects to billing and shows the subscription', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account')

    await expect(page).toHaveURL(/\/dashboard\/account\/billing/)
    const nav = page.getByRole('navigation', { name: 'Section navigation' })
    await expect(
      nav.getByRole('link', { name: 'Billing & plan' })
    ).toHaveAttribute('aria-current', 'page')
    // Mocked subscription plan name renders.
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible()
  })

  test('a subscriber sees their status, price and the next tier up', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account/billing')

    await expect(page.getByText('Active')).toBeVisible()
    await expect(page.getByText('$9.99')).toBeVisible()
    await expect(
      page.getByRole('link', { name: /Upgrade to Scale/ })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /Manage subscription/i })
    ).toBeVisible()
  })

  test('a subscriber scheduled to cancel sees when access ends', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page, {
      subscription: { ...mockSubscription, cancelAtPeriodEnd: true },
    })
    await page.goto('/dashboard/account/billing')

    await expect(page.getByText('Access ends')).toBeVisible()
    await expect(page.getByText('Next payment')).toHaveCount(0)
    await expect(page.getByText(/will not renew/)).toBeVisible()
  })

  // A free user has no subscription, so the payload carries no status. The
  // page used to read that as a subscription whose status was unknown and
  // told them so, alongside two "N/A" billing dates.
  test('a free user is never told their status is unknown', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page, { subscription: mockFreeSubscription })
    await page.goto('/dashboard/account/billing')

    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible()
    await expect(page.getByText('Unknown')).toHaveCount(0)
    await expect(page.getByText('N/A')).toHaveCount(0)
    await expect(page.getByText('Start date')).toHaveCount(0)

    // Sold the next tier, not offered a portal for a subscription they do not
    // have.
    await expect(
      page.getByRole('link', { name: /Upgrade to Pro/ })
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /Manage subscription/i })
    ).toHaveCount(0)
  })

  // The sidebar used to link to /dashboard/account, whose page is a server
  // redirect stub, so every click paid navigation + redirect + navigation.
  test('the sidebar Account link goes straight to billing with no redirect hop', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    const stubHits: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/dashboard/account') {
        stubHits.push(request.url())
      }
    })

    await page.goto('/dashboard')
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Account' })
      .click()

    await expect(page).toHaveURL(/\/dashboard\/account\/billing$/)
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible()
    expect(stubHits).toEqual([])
  })

  test('the pricing page is reachable from billing on any plan', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page, { subscription: mockFreeSubscription })
    await page.goto('/dashboard/account/billing')

    await expect(
      page.getByRole('link', { name: /Compare all plans/ })
    ).toHaveAttribute('href', 'https://textbee.dev/pricing')
  })

  // Password managers key off autoComplete to tell the three password boxes
  // apart. Without it they fill the saved password into the wrong field.
  test('password fields declare their autocomplete roles', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account/security')

    await expect(page.getByLabel('Old Password')).toHaveAttribute(
      'autocomplete',
      'current-password'
    )
    await expect(page.getByLabel('New Password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    )
    await expect(page.getByLabel('Confirm Password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    )
  })

  // The most destructive action in the app had a label pointing at an id that
  // did not exist and an email field with no label at all.
  test('the delete-account fields are reachable by their labels', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account/security')

    await page.getByRole('button', { name: 'Delete Account' }).click()
    const dialog = page.getByRole('dialog')

    await dialog.getByLabel('Reason for deletion').fill('Testing labels')
    await dialog
      .getByLabel('Type your email address to confirm')
      .fill('test@example.com')

    await expect(dialog.getByLabel('Reason for deletion')).toHaveValue(
      'Testing labels'
    )
  })

  test('security deep link survives refresh and separates the danger zone', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account/security')

    const nav = page.getByRole('navigation', { name: 'Section navigation' })
    await expect(nav.getByRole('link', { name: 'Security' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await expect(page.getByText('Password', { exact: true })).toBeVisible()
    await expect(page.getByText('Danger zone')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Delete Account' })
    ).toBeVisible()
  })

  test('legacy routes redirect into the merged settings', async ({
    page,
    context,
  }) => {
    await authenticate(context)
    await mockApi(page)

    await page.goto('/dashboard/account/change-password')
    await expect(page).toHaveURL(/\/dashboard\/account\/security/)

    await page.goto('/dashboard/account/edit-profile')
    await expect(page).toHaveURL(/\/dashboard\/account\/profile/)
  })

  test('a deep link on a phone keeps the page at the top and the tab in view', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 375, height: 500 })
    await authenticate(context)
    await mockApi(page)
    await page.goto('/dashboard/account/support')

    const tab = page
      .getByRole('navigation', { name: 'Section navigation' })
      .getByRole('link', { name: 'Support' })
    await expect(tab).toHaveAttribute('aria-current', 'page')
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' })
    ).toBeInViewport()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    const strip = page.getByRole('navigation', { name: 'Section navigation' })
    await expect
      .poll(async () => {
        const [outer, inner] = await Promise.all([
          strip.boundingBox(),
          tab.boundingBox(),
        ])
        return Boolean(
          outer &&
            inner &&
            inner.x >= outer.x &&
            inner.x + inner.width <= outer.x + outer.width + 1
        )
      })
      .toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
