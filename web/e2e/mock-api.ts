import type { Page, Route } from '@playwright/test'
import {
  mockApiKeys,
  mockBillingPlans,
  mockDevices,
  mockMessages,
  mockStats,
  mockSubscription,
  mockUser,
  mockWebhookNotifications,
  mockWebhooks,
} from '../test/fixtures'

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

// Intercept EVERY call to the backend (`/api/v1/**`) and serve fixtures. Because
// the app is pointed at a backend host that nothing listens on, this guarantees
// no request ever reaches a real backend during e2e.
export type MockApiOverrides = {
  /** Serve a different subscription payload, e.g. the free-user shape. */
  subscription?: unknown
  /** Fail POST /billing/checkout with this message, to exercise the error state. */
  checkoutError?: string
}

export async function mockApi(page: Page, overrides: MockApiOverrides = {}) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '')

    // Create a per-invocation device-state copy before routing
    const devicesCopy = mockDevices.map((d) => ({ ...d }))

    // Kept in-origin so following the redirect does not leave the test app.
    if (path === '/billing/checkout') {
      if (overrides.checkoutError) {
        return json(route, { message: overrides.checkoutError }, 400)
      }
      return json(route, { redirectUrl: '/dashboard?polar-checkout-mock=1' })
    }

    if (path === '/auth/who-am-i') return json(route, { data: mockUser })
    if (path === '/billing/current-subscription')
      return json(route, overrides.subscription ?? mockSubscription)
    if (path === '/billing/plans') return json(route, mockBillingPlans)
    if (path === '/gateway/devices') return json(route, { data: devicesCopy })
    if (path === '/gateway/stats') return json(route, { data: mockStats })
    if (path === '/webhooks') return json(route, { data: mockWebhooks })
    if (path === '/webhooks/notifications')
      return json(route, mockWebhookNotifications)
    if (path === '/auth/api-keys') return json(route, { data: mockApiKeys })
    if (path === '/gateway/messages') return json(route, mockMessages)

    // Sends are device-agnostic now: the id travels in the body.
    if (path === '/gateway/send-sms' || path === '/gateway/send-bulk-sms')
      return json(route, { data: { success: true } })

    const setDefault = path.match(/\/gateway\/devices\/([^/]+)\/set-default/)
    if (setDefault) {
      const device = devicesCopy.find((d) => d._id === setDefault[1])
      if (!device) {
        return json(route, { error: 'Device not found' }, 404)
      }
      devicesCopy.forEach((d) => {
        d.isDefault = d._id === setDefault[1]
      })
      return json(route, { data: { ...device, isDefault: true } })
    }

    // The dashboard asks which messaging implementation to render. Answering
    // "engine off" keeps these tests on the built-in messages, which is what the
    // localStorage suppression in session.ts silences. Stated explicitly rather
    // than relying on the unmapped fallback below, so a change there cannot
    // quietly move every test onto the engine path.
    if (path === '/notifications/feed')
      return json(route, {
        engineEnabled: false,
        settings: null,
        notifications: [],
      })

    // Any unmapped backend call still gets a benign mocked response so the test
    // cannot fall through to a real backend.
    return json(route, { data: [] })
  })
}
