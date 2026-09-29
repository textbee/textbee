import { http, HttpResponse, type JsonBodyType } from 'msw'
import { ApiEndpoints } from '@/config/api'
import {
  API_BASE_URL,
  mockApiKeys,
  mockBillingPlans,
  mockDevices,
  mockMessages,
  mockNotificationFeed,
  mockStats,
  mockSubscription,
  mockUser,
  mockWebhookNotifications,
  mockWebhooks,
  TEST_ACCESS_TOKEN,
} from '../fixtures'

// Build an absolute URL for an ApiEndpoints path so MSW can match the
// axios baseURL-prefixed requests the app issues.
const url = (path: string) => `${API_BASE_URL}${path.split('?')[0]}`

// Envelope helpers matching the real API's response shapes.
const dataEnvelope = (data: JsonBodyType) => HttpResponse.json({ data })
const raw = (body: JsonBodyType) => HttpResponse.json(body)

export const handlers = [
  // --- auth ---
  http.get(url(ApiEndpoints.auth.whoAmI()), () => dataEnvelope(mockUser)),
  http.post(url(ApiEndpoints.auth.login()), () =>
    dataEnvelope({ user: mockUser, accessToken: TEST_ACCESS_TOKEN })
  ),
  http.post(url(ApiEndpoints.auth.register()), () =>
    dataEnvelope({ user: mockUser, accessToken: TEST_ACCESS_TOKEN })
  ),
  http.post(url(ApiEndpoints.auth.signInWithGoogle()), () =>
    dataEnvelope({ user: mockUser, accessToken: TEST_ACCESS_TOKEN })
  ),
  http.get(url(ApiEndpoints.auth.listApiKeys()), () =>
    dataEnvelope(mockApiKeys)
  ),
  http.post(url('/auth/api-keys'), () =>
    dataEnvelope({ ...mockApiKeys[0], apiKey: 'tb_live_new0000' })
  ),
  http.patch(url(ApiEndpoints.auth.updateOnboarding()), () =>
    dataEnvelope({})
  ),
  http.post(url(ApiEndpoints.auth.sendEmailVerificationEmail()), () =>
    dataEnvelope({})
  ),

  // --- gateway ---
  http.get(url(ApiEndpoints.gateway.listDevices()), () =>
    dataEnvelope(mockDevices)
  ),
  http.get(url(ApiEndpoints.gateway.getStats()), () =>
    dataEnvelope(mockStats)
  ),
  http.get(url(ApiEndpoints.gateway.smsPermissionStatus()), () =>
    dataEnvelope({
      needsSmsPermission: false,
      hoursSinceFailure: null,
      deviceId: null,
      deviceName: null,
      failedAt: null,
    })
  ),
  http.get(url(ApiEndpoints.gateway.getWebhooks()), () =>
    dataEnvelope(mockWebhooks)
  ),
  http.get(url(ApiEndpoints.gateway.getWebhookNotifications()), () =>
    raw(mockWebhookNotifications)
  ),

  // --- billing ---
  http.get(url(ApiEndpoints.billing.currentSubscription()), () =>
    raw(mockSubscription)
  ),
  http.get(url(ApiEndpoints.billing.plans()), () => raw(mockBillingPlans)),

  // Account-level message history; device scoping travels as a query param.
  http.get(`${API_BASE_URL}/gateway/messages`, () => raw(mockMessages)),

  // --- dashboard notifications ---
  http.get(url(ApiEndpoints.notifications.feed()), () =>
    raw(mockNotificationFeed)
  ),
  http.post(url(ApiEndpoints.notifications.events()), () =>
    raw({ recorded: 1 })
  ),
]
