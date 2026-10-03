import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { queryKeys } from './query-keys'
import type {
  ApiKey,
  ApiKeyStatusFilter,
  Device,
  GatewayStats,
  NotificationEvent,
  NotificationFeed,
  Plan,
  SmsPermissionStatus,
  Subscription,
  User,
  WebhookNotification,
  WebhookSubscription,
} from './types'

// Most endpoints wrap their payload as { data: ... }; a few (subscription)
// return the object directly. These helpers keep the unwrapping in one place.
const unwrapData = <T>(res: { data: { data: T } }) => res.data.data
const unwrapBody = <T>(res: { data: T }) => res.data

type QueryOpts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>

// List endpoints return { data: T[] }. Legacy (not-yet-migrated) components
// cache that raw envelope under the same query key, so these hooks must keep
// the raw shape in the cache and unwrap per-observer via `select` to avoid a
// cache-shape collision on shared keys like ['devices'] and ['webhooks'].
type ListEnvelope<T> = { data: T[] }
type ListQueryOpts<T> = Omit<
  UseQueryOptions<ListEnvelope<T>, Error, T[]>,
  'queryKey' | 'queryFn' | 'select'
>
const selectList = <T>(raw: ListEnvelope<T> | undefined): T[] => raw?.data ?? []

type MutationOpts<TData, TVars> = Omit<
  UseMutationOptions<TData, Error, TVars>,
  'mutationFn'
>

// ---------- account ----------

export function useCurrentUser(options?: QueryOpts<User>) {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () =>
      httpBrowserClient.get(ApiEndpoints.auth.whoAmI()).then(unwrapData<User>),
    ...options,
  })
}

// ---------- billing ----------

export function useSubscription(options?: QueryOpts<Subscription>) {
  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.billing.currentSubscription())
        .then(unwrapBody<Subscription>),
    ...options,
  })
}

// /billing/plans returns a bare array, not a { data } envelope. Prices change
// rarely, so a long stale time avoids refetching on every page.
export function useBillingPlans(options?: QueryOpts<Plan[]>) {
  return useQuery({
    queryKey: queryKeys.billingPlans,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.billing.plans())
        .then(unwrapBody<Plan[]>),
    staleTime: 10 * 60 * 1000,
    ...options,
  })
}

// ---------- gateway ----------

export function useGatewayStats(options?: QueryOpts<GatewayStats>) {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.getStats())
        .then(unwrapData<GatewayStats>),
    ...options,
  })
}

export function useDevices(options?: ListQueryOpts<Device>) {
  return useQuery({
    queryKey: queryKeys.devices,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.listDevices())
        .then((r) => r.data as ListEnvelope<Device>),
    select: selectList<Device>,
    ...options,
  })
}

// Polled so the alert clears within a minute of the fix on the phone.
export function useSmsPermissionStatus(options?: {
  refetchInterval?: QueryOpts<SmsPermissionStatus>['refetchInterval']
}) {
  return useQuery({
    queryKey: queryKeys.smsPermissionStatus,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.smsPermissionStatus())
        .then(unwrapData<SmsPermissionStatus>),
    refetchInterval: options?.refetchInterval ?? 60_000,
  })
}

const FAST_POLL_INTERVAL_MS = 3_000
const FAST_POLL_WINDOW_MS = 90_000
// A failure long after the send belongs to another message.
const SEND_FAILURE_WINDOW_MS = 10 * 60_000
// failedAt is server time; allow for a browser clock that runs a little fast.
const CLOCK_SKEW_MS = 2 * 60_000

// Call start() right before a send to poll fast until the phone reports the outcome.
export function useSmsPermissionFastPoll() {
  const queryClient = useQueryClient()
  const [pollWindow, setPollWindow] = useState<{
    startedAt: number
    until: number
    baselineFailedAt: string | null
  } | null>(null)

  const query = useSmsPermissionStatus({
    refetchInterval: () =>
      pollWindow && Date.now() < pollWindow.until ? FAST_POLL_INTERVAL_MS : 60_000,
  })

  const start = useCallback(() => {
    const current = queryClient.getQueryData<SmsPermissionStatus>(
      queryKeys.smsPermissionStatus
    )
    const startedAt = Date.now()
    setPollWindow({
      startedAt,
      until: startedAt + FAST_POLL_WINDOW_MS,
      baselineFailedAt: current?.failedAt ?? null,
    })
  }, [queryClient])

  const status = query.data
  // A failure already on screen before the send does not count as this send's.
  const sendFailedForPermission =
    pollWindow !== null &&
    status?.needsSmsPermission === true &&
    status.source === 'failure' &&
    !!status.failedAt &&
    status.failedAt !== pollWindow.baselineFailedAt &&
    new Date(status.failedAt).getTime() >=
      pollWindow.startedAt - CLOCK_SKEW_MS &&
    new Date(status.failedAt).getTime() <
      pollWindow.until + SEND_FAILURE_WINDOW_MS

  return { status, start, sendFailedForPermission }
}

export function useDeleteDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      httpBrowserClient.delete(ApiEndpoints.gateway.deleteDevice(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    },
  })
}

export function useSetDefaultDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      httpBrowserClient.post(ApiEndpoints.gateway.setDefaultDevice(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    },
  })
}

// ---------- api keys ----------

export function useApiKeys(
  status: ApiKeyStatusFilter = 'active',
  options?: ListQueryOpts<ApiKey>
) {
  return useQuery({
    queryKey: queryKeys.apiKeys(status),
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.auth.listApiKeys(status))
        .then((r) => r.data as ListEnvelope<ApiKey>),
    select: selectList<ApiKey>,
    ...options,
  })
}

export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      httpBrowserClient.post(ApiEndpoints.auth.revokeApiKey(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysAll })
    },
  })
}

export function useDeleteApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      httpBrowserClient.delete(ApiEndpoints.auth.deleteApiKey(id)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysAll })
    },
  })
}

export function useRenameApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      httpBrowserClient.patch(ApiEndpoints.auth.renameApiKey(id), { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysAll })
    },
  })
}

// A new key changes the list, the dashboard counts and the device pairing
// state, so all three refresh together.
export function useGenerateApiKey() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      httpBrowserClient
        .post(ApiEndpoints.auth.generateApiKey())
        .then((res) => res.data as { data: string }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeysAll })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      void queryClient.invalidateQueries({ queryKey: queryKeys.devices })
    },
  })
}

// ---------- account ----------

export type UpdateProfilePayload = { name?: string; phone?: string }

export function useUpdateProfile(
  options?: MutationOpts<unknown, UpdateProfilePayload>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateProfilePayload) =>
      httpBrowserClient.patch(ApiEndpoints.auth.updateProfile(), data),
    ...options,
    // Composed, not overridden: a caller passing onSuccess must not silently
    // drop the invalidation this hook exists to guarantee.
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser })
      options?.onSuccess?.(...args)
    },
  })
}

export type ChangePasswordPayload = {
  oldPassword: string
  newPassword: string
  confirmPassword?: string
}

export function useChangePassword(
  options?: MutationOpts<unknown, ChangePasswordPayload>
) {
  return useMutation({
    mutationFn: (data: ChangePasswordPayload) =>
      httpBrowserClient.post(ApiEndpoints.auth.changePassword(), data),
    ...options,
  })
}

export function useSendEmailVerification() {
  return useMutation({
    mutationFn: () =>
      httpBrowserClient.post(ApiEndpoints.auth.sendEmailVerificationEmail()),
  })
}

export function useVerifyEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: { userId: string; verificationCode: string }) =>
      httpBrowserClient.post(ApiEndpoints.auth.verifyEmail(), payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser })
    },
  })
}

export type UpdateOnboardingPayload = {
  skipStepId?: string
  complete?: boolean
  currentStepId?: string
}

export function useUpdateOnboarding() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateOnboardingPayload) =>
      httpBrowserClient
        .patch(ApiEndpoints.auth.updateOnboarding(), body)
        .then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser })
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscription })
    },
  })
}

// ---------- webhooks ----------

export function useWebhooks(options?: ListQueryOpts<WebhookSubscription>) {
  return useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.getWebhooks())
        .then((r) => r.data as ListEnvelope<WebhookSubscription>),
    select: selectList<WebhookSubscription>,
    ...options,
  })
}

export type WebhookInput = {
  name?: string
  deliveryUrl: string
  events: string[]
  isActive: boolean
  signingSecret: string
}

// All four webhook mutations invalidate the same list, so the key lives here
// once rather than being retyped in each dialog.
const invalidateWebhooks = (queryClient: ReturnType<typeof useQueryClient>) =>
  void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks })

export function useCreateWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: WebhookInput) =>
      httpBrowserClient.post(ApiEndpoints.gateway.createWebhook(), values),
    onSuccess: () => invalidateWebhooks(queryClient),
  })
}

export function useUpdateWebhook(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (values: Partial<WebhookInput>) =>
      httpBrowserClient.patch(ApiEndpoints.gateway.updateWebhook(id), values),
    onSuccess: () => invalidateWebhooks(queryClient),
  })
}

export function useDeleteWebhook(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      httpBrowserClient.delete(ApiEndpoints.gateway.deleteWebhook(id)),
    onSuccess: () => invalidateWebhooks(queryClient),
  })
}

export type WebhookNotificationFilters = {
  eventType?: string
  status?: string
  deviceId?: string
  webhookSubscriptionId?: string
  start?: string
  end?: string
  page?: number
  limit?: number
}

// Raw body: { data: { data: rows[], meta: { totalPages, ... } } }
export type WebhookNotificationsEnvelope = {
  data?: {
    data?: WebhookNotification[]
    meta?: { totalPages?: number; total?: number }
  }
}

export function useWebhookNotifications(filters: WebhookNotificationFilters) {
  const {
    eventType = '',
    status = '',
    deviceId = '',
    webhookSubscriptionId = '',
    start = '',
    end = '',
    page = 1,
    limit = 10,
  } = filters
  return useQuery({
    queryKey: queryKeys.webhookNotifications({
      eventType,
      status,
      deviceId,
      webhookSubscriptionId,
      start,
      end,
      page,
      limit,
    }),
    queryFn: () =>
      httpBrowserClient
        .get(
          `${ApiEndpoints.gateway.getWebhookNotifications()}?eventType=${eventType}&page=${page}&limit=${limit}&status=${status}&start=${start}&end=${end}&deviceId=${deviceId}&webhookSubscriptionId=${webhookSubscriptionId}`
        )
        .then(unwrapBody<WebhookNotificationsEnvelope>),
    // Deliveries arrive from outside the tab, so stay fresher than the 60s
    // client-wide default.
    staleTime: 15_000,
  })
}

// ---------- messaging ----------

// Matches the zod-inferred SendSmsFormData shape; validation happens via the
// schema before the payload reaches here.
export type SendSmsPayload = {
  // Optional to the API, which falls back to the default device, but required
  // here: the dashboard always has an explicit selection, and the invalidation
  // below keys the message list off it.
  deviceId: string
  recipients?: string[]
  message?: string
  simSubscriptionId?: number
}

// A send adds to the device's history and consumes quota, so it has to refresh
// the message list, the dashboard stats, the subscription usage and the SMS
// permission status. Exported because the bulk sender posts its own mutation
// and must invalidate the same keys (issue #261).
export function invalidateAfterSend(queryClient: QueryClient) {
  // Whole prefix, not one device key: the visible list may be the 'all' view
  // or a multi-device selection that does not key on the sending device.
  void queryClient.invalidateQueries({ queryKey: queryKeys.messagesAll })
  void queryClient.invalidateQueries({ queryKey: queryKeys.stats })
  void queryClient.invalidateQueries({ queryKey: queryKeys.subscription })
  void queryClient.invalidateQueries({
    queryKey: queryKeys.smsPermissionStatus,
  })
}

export function useSendSms() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['send-sms'],
    mutationFn: (data: SendSmsPayload) =>
      httpBrowserClient.post(ApiEndpoints.gateway.sendSMS(), data),
    onSuccess: () => invalidateAfterSend(queryClient),
  })
}

export type DeviceMessagesParams = {
  type?: string
  page?: number
  limit?: number
  search?: string
  status?: string
  // ISO timestamps: from is inclusive, to is exclusive.
  from?: string
  to?: string
  order?: 'desc' | 'asc'
  smsBatchId?: string
}

export type DeviceMessagesEnvelope = {
  data: unknown[]
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number }
}

// Returns the raw { data, meta } message-history envelope for the account.
// `deviceIds` narrows to a selection of devices; empty means every device.
// `search` is handled server-side (it matches the message body, recipient and
// sender), so it searches all history rather than only the page loaded.
export function useDeviceMessages(
  deviceIds: string[],
  params: DeviceMessagesParams = {},
  options?: QueryOpts<DeviceMessagesEnvelope>
) {
  const {
    type = 'all',
    page = 1,
    limit = 20,
    search = '',
    status = '',
    from = '',
    to = '',
    order = 'desc',
    smsBatchId = '',
  } = params
  // Sorted so [a,b] and [b,a] share a cache entry.
  const selection = deviceIds.length ? [...deviceIds].sort().join(',') : 'all'
  return useQuery({
    // search joins the key so each term caches separately.
    queryKey: queryKeys.deviceMessages(selection, {
      type,
      page,
      limit,
      search,
      status,
      from,
      to,
      order,
      smsBatchId,
    }),
    queryFn: () => {
      const query = new URLSearchParams({
        direction: type,
        page: String(page),
        limit: String(limit),
      })
      if (selection !== 'all') query.set('deviceIds', selection)
      if (search) query.set('search', search)
      if (status) query.set('status', status)
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (order !== 'desc') query.set('order', order)
      if (smsBatchId) query.set('smsBatchId', smsBatchId)

      return httpBrowserClient
        .get(`${ApiEndpoints.gateway.getMessages()}?${query}`)
        .then(unwrapBody<DeviceMessagesEnvelope>)
    },
    // Inbound messages arrive from outside the tab, so stay fresher than the
    // 60s client-wide default. Before ...options so callers can override.
    staleTime: 15_000,
    ...options,
  })
}

// ---------- dashboard notifications ----------

export function useNotificationFeed(options?: QueryOpts<NotificationFeed>) {
  return useQuery({
    queryKey: queryKeys.notificationFeed,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.notifications.feed())
        .then(unwrapBody<NotificationFeed>),
    // The feed is cheap and the flag on it decides which implementation the
    // dashboard renders, so it should not be served from a long-stale cache.
    staleTime: 30_000,
    // One retry is enough. On failure the caller keeps showing the built-in
    // messages, so failing fast is better than sitting on an empty slot.
    retry: 1,
    ...options,
  })
}

/**
 * Impressions, clicks and dismissals, sent as a batch. Deliberately separate
 * from the feed: a refetch or a prefetch would otherwise count as another view.
 */
export function useTrackNotificationEvents(
  options?: MutationOpts<{ recorded: number }, NotificationEvent[]>,
) {
  return useMutation({
    mutationFn: (events: NotificationEvent[]) =>
      httpBrowserClient
        .post(ApiEndpoints.notifications.events(), { events })
        .then(unwrapBody<{ recorded: number }>),
    ...options,
  })
}

export function useDismissNotification(
  options?: MutationOpts<
    { success: boolean },
    { id: string; snoozeHours?: number }
  >,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, snoozeHours }) =>
      httpBrowserClient
        .post(ApiEndpoints.notifications.dismiss(id), { snoozeHours })
        .then(unwrapBody<{ success: boolean }>),
    ...options,
    onSuccess: (...args) => {
      // Refetch so whatever was held back by the cap can take the freed slot.
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationFeed })
      options?.onSuccess?.(...args)
    },
  })
}
