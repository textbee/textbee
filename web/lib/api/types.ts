// Shared response types for the backend API. Kept permissive (most fields
// optional) to match the loosely-typed backend payloads and the project's
// non-strict TS config, while still giving components real autocomplete.

export interface User {
  _id?: string
  id?: string
  name?: string
  email?: string
  phone?: string
  role?: string
  avatar?: string | null
  emailVerifiedAt?: string | null
  onboardingCompletedAt?: string | null
  // Set when the user asks for deletion, which starts a 7-day window. Real
  // field on the user schema, and read by the account-deletion banner, but it
  // was missing from this type.
  accountDeletionRequestedAt?: string | null
  createdAt?: string
  // Drives the onboarding checklist. Structurally compatible with the
  // UserShape that get-started/steps.ts takes, so useCurrentUser can feed it.
  onboarding?: {
    completedAt?: string | null
    currentStepId?: string
    skippedStepIds?: string[]
  }
}

export interface GatewayStats {
  totalSentSMSCount?: number
  totalReceivedSMSCount?: number
  totalDeviceCount?: number
  totalApiKeyCount?: number
}

export interface SmsPermissionStatus {
  needsSmsPermission: boolean | null
  hoursSinceFailure: number | null
  deviceId: string | null
  deviceName: string | null
  failedAt: string | null
}

export interface Device {
  _id: string
  brand?: string
  model?: string
  // Custom name the user set in the dashboard.
  name?: string | null
  enabled?: boolean
  // The device the API sends from when a request omits deviceId.
  isDefault?: boolean
  // No `status` field: the Device schema has none and the API never sends one,
  // so `device.status === 'online'` was always false and every device rendered
  // with the muted "inactive" badge even while enabled and working.
  //
  // The device does report real telemetry through its heartbeat (battery,
  // network type, last heartbeat, SIM details) which the API stores and
  // returns. It is deliberately not modelled here yet: surfacing it is a
  // feature, not a fix, and belongs in its own change.
  appVersionCode?: number
  createdAt?: string
}

export interface ApiKey {
  _id: string
  apiKey: string
  name?: string
  status?: 'active' | 'revoked'
  lastUsedAt?: string | null
  createdAt?: string
  revokedAt?: string
  usageCount?: number
}

export interface Plan {
  name?: string
  dailyLimit?: number
  monthlyLimit?: number
  bulkSendLimit?: number
  deviceLimit?: number
  // Prices are in cents and live on the plan as monthlyPrice/yearlyPrice.
  // This type previously declared amount/currency/recurringInterval, which the
  // plans endpoint has never sent: those belong to Subscription, populated
  // from the payment provider. Anything reading plan.amount silently saw
  // undefined and rendered a paid plan as free.
  monthlyPrice?: number
  yearlyPrice?: number
  isActive?: boolean
}

export interface SubscriptionUsage {
  dailyLimit?: number
  monthlyLimit?: number
  bulkSendLimit?: number
  deviceLimit?: number
  processedSmsToday?: number
  processedSmsLastMonth?: number
  dailyRemaining?: number
  monthlyRemaining?: number
  dailyUsagePercentage?: number
  monthlyUsagePercentage?: number
}

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | string

export interface Subscription {
  plan?: Plan
  usage?: SubscriptionUsage
  status?: SubscriptionStatus
  amount?: number
  currency?: string
  recurringInterval?: string
  subscriptionStartDate?: string
  currentPeriodEnd?: string
  cancelAtPeriodEnd?: boolean
  customDailyLimit?: number | null
  customMonthlyLimit?: number | null
  customBulkSendLimit?: number | null
  customDeviceLimit?: number | null
}

export type ApiKeyStatusFilter = 'active' | 'revoked' | 'all'

/**
 * One webhook delivery attempt, as the notifications endpoint returns it.
 *
 * Previously typed as `unknown[]` on the envelope, which meant the deliveries
 * table received `unknown[]` and its own row type went unchecked.
 */
export interface WebhookNotification {
  _id?: string
  event?: string
  webhookEvent?: string
  deliveryUrl?: string
  webhookSubscription?: { deliveryUrl: string }
  createdAt?: string
  status: string
  computedStatus?: string
  deviceData?: { brand?: string; model?: string; name?: string | null }
  smsData?: { _id?: string }
  payload?: unknown
}

export interface WebhookSubscription {
  _id: string
  name?: string
  deliveryUrl?: string
  events?: string[]
  isActive?: boolean
  createdAt?: string
}

// ---------- dashboard notifications ----------

export type NotificationTone =
  | 'info'
  | 'success'
  | 'warning'
  | 'critical'
  | 'promo'

export interface NotificationAction {
  label: string
  href: string
  style?: string
  target?: string
  trackAs?: string
}

export interface ServedNotification {
  id: string
  key: string
  kind: 'system' | 'campaign'
  placement: 'tile' | 'modal'
  tone: NotificationTone
  renderer: string
  rank: number
  variantId: string
  title: string
  body?: string
  actions: NotificationAction[]
  dismissible: boolean
  dismissAfterSeconds?: number
}

export interface NotificationFeed {
  // False means this account should render the dashboard's own built-in
  // messages instead. The engine is then off for it and the list is empty.
  engineEnabled: boolean
  settings: { maxTilesAtOnce: number; maxModalsPerLoad: number } | null
  notifications: ServedNotification[]
}

export type NotificationEventType = 'impression' | 'click' | 'dismiss'

export interface NotificationEvent {
  notificationId: string
  type: NotificationEventType
  variantId?: string
}
