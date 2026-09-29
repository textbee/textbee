// Shared, framework-agnostic API fixtures used by BOTH the MSW node server
// (unit/component tests) and the Playwright route-interception layer (e2e).
// These mirror the response envelopes the real backend returns, as consumed
// across the dashboard components. Tests must never hit a live backend, so
// these are the single source of truth for mocked API data.

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api/v1'

export const TEST_ACCESS_TOKEN = 'test-access-token'

export const mockUser = {
  _id: 'user_test_1',
  id: 'user_test_1',
  name: 'Test User',
  email: 'test.user@example.com',
  phone: '+15551234567',
  role: 'user',
  avatar: null,
  emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
}

export const mockStats = {
  totalSentSMSCount: 12840,
  totalReceivedSMSCount: 3120,
  totalDeviceCount: 2,
  totalApiKeyCount: 3,
}

export const mockSubscription = {
  plan: {
    name: 'Pro',
    dailyLimit: 5000,
    monthlyLimit: 100000,
    bulkSendLimit: 1000,
    deviceLimit: 5,
  },
  usage: {
    dailyLimit: 5000,
    monthlyLimit: 100000,
    bulkSendLimit: 1000,
    deviceLimit: 5,
    processedSmsToday: 320,
    processedSmsLastMonth: 18450,
    dailyRemaining: 4680,
    monthlyRemaining: 81550,
    dailyUsagePercentage: 6.4,
    monthlyUsagePercentage: 18.45,
  },
  status: 'active',
  // Cents, and it must match the Pro price on the pricing page. This fixture
  // previously said 1900, a price we do not charge.
  amount: 999,
  currency: 'usd',
  recurringInterval: 'month',
  subscriptionStartDate: new Date('2026-06-01T00:00:00.000Z').toISOString(),
  currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z').toISOString(),
  customDailyLimit: null,
  customMonthlyLimit: null,
  customBulkSendLimit: null,
  customDeviceLimit: null,
}

// What /billing/current-subscription actually returns for a user with no
// subscription record: billing.service.ts synthesises this from the free plan.
// There is deliberately no status, no amount and no dates, because there is no
// subscription for them to belong to.
export const mockFreeSubscription = {
  plan: {
    name: 'free',
    dailyLimit: 50,
    monthlyLimit: 300,
    bulkSendLimit: 50,
    deviceLimit: 1,
  },
  isActive: true,
  usage: {
    dailyLimit: 50,
    monthlyLimit: 300,
    bulkSendLimit: 50,
    deviceLimit: 1,
    processedSmsToday: 4,
    processedSmsLastMonth: 40,
    dailyRemaining: 46,
    monthlyRemaining: 260,
    dailyUsagePercentage: 8,
    monthlyUsagePercentage: 13,
  },
}

export const mockDevices = [
  {
    _id: 'device_1',
    brand: 'Google',
    model: 'Pixel 8',
    enabled: true,
    isDefault: true,
    batteryLevel: 82,
    appVersionCode: 17,
    createdAt: new Date('2026-05-10T00:00:00.000Z').toISOString(),
  },
  {
    _id: 'device_2',
    brand: 'Samsung',
    model: 'Galaxy S23',
    enabled: false,
    isDefault: false,
    batteryLevel: 40,
    appVersionCode: 16,
    createdAt: new Date('2026-05-20T00:00:00.000Z').toISOString(),
  },
]

export const mockApiKeys = [
  {
    _id: 'key_1',
    apiKey: 'tb_live_abcd1234',
    name: 'Production',
    status: 'active',
    lastUsedAt: new Date('2026-07-09T00:00:00.000Z').toISOString(),
    createdAt: new Date('2026-05-01T00:00:00.000Z').toISOString(),
  },
]

export const mockWebhooks = [
  {
    _id: 'wh_1',
    deliveryUrl: 'https://example.com/webhooks/textbee',
    events: ['message.received'],
    isActive: true,
    createdAt: new Date('2026-06-15T00:00:00.000Z').toISOString(),
  },
]

export const mockWebhookNotifications = { data: [], total: 0 }

// The real endpoint populates `device` (select: _id brand model buildId
// enabled), so the fixtures carry it too: replying reads message.device._id,
// and without it the mocked path would not exercise what production does.
// Anchored to local midnight rather than "N hours ago": a message 2 hours old
// falls on the previous day when the suite runs just after midnight, which
// made the Today/Yesterday grouping assertions depend on the wall clock.
const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
// Now is always today and never in the future.
const todayIso = () => new Date().toISOString()
// An hour before local midnight is always yesterday.
const yesterdayIso = () => new Date(startOfToday() - 60 * 60 * 1000).toISOString()

export const mockMessages = {
  data: [
    {
      _id: 'msg_1',
      recipient: '+15557654321',
      message: 'Hello from textbee',
      status: 'sent',
      type: 'sent',
      device: { _id: 'device_1', brand: 'Google', model: 'Pixel 8' },
      requestedAt: todayIso(),
      createdAt: todayIso(),
    },
    {
      _id: 'msg_2',
      sender: '+15551234567',
      message: 'Reply from a customer',
      status: 'received',
      type: 'received',
      device: { _id: 'device_1', brand: 'Google', model: 'Pixel 8' },
      receivedAt: yesterdayIso(),
      createdAt: yesterdayIso(),
    },
  ],
  meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
}

// Shaped like the real /billing/plans response, which returns Plan documents:
// monthlyPrice in cents plus the limits, and no currency or amount. The old
// fixture used amount/currency, fields that endpoint has never sent, so a
// component reading them looked correct in tests and rendered every paid plan
// as free in production.
// The prices are made up so tests never pin the live ones.
export const mockBillingPlans = [
  {
    name: 'free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    dailyLimit: 50,
    monthlyLimit: 500,
    bulkSendLimit: 50,
    deviceLimit: 1,
    isActive: true,
  },
  {
    name: 'pro',
    monthlyPrice: 1900,
    yearlyPrice: 12000,
    dailyLimit: 5000,
    monthlyLimit: 100000,
    bulkSendLimit: 500,
    deviceLimit: 5,
    isActive: true,
  },
  {
    name: 'scale',
    monthlyPrice: 4900,
    yearlyPrice: 36000,
    dailyLimit: -1,
    monthlyLimit: -1,
    bulkSendLimit: 2000,
    deviceLimit: -1,
    isActive: true,
  },
]

// A feed with the engine on and one promo tile. Kept minimal on purpose: the
// ordering and capping are decided server side and tested there, so the client
// fixtures only need to exercise rendering and the flag.
export const mockNotificationFeed = {
  engineEnabled: true,
  settings: { maxTilesAtOnce: 2, maxModalsPerLoad: 1 },
  notifications: [
    {
      id: '6700000000000000000000a1',
      key: 'upgrade-to-pro',
      kind: 'campaign',
      placement: 'tile',
      tone: 'promo',
      renderer: 'standard',
      rank: 1,
      variantId: 'v1',
      title: 'Upgrade to Pro',
      body: 'More messages every month.',
      actions: [{ label: 'See Pro', href: '/checkout/pro' }],
      dismissible: true,
    },
  ],
}

/** The shape returned while the engine is switched off for an account. */
export const mockNotificationFeedDisabled = {
  engineEnabled: false,
  settings: null,
  notifications: [],
}
