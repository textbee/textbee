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
  // Set when the user asks for deletion, which starts a 30-day window. Real
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
  // failure: the latest send failed. heartbeat: the phone reports it off.
  source: 'failure' | 'heartbeat' | null
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
  // Online state is derived from the heartbeat fields below.
  lastHeartbeat?: string | null
  heartbeatEnabled?: boolean
  heartbeatIntervalMinutes?: number
  appVersionCode?: number
  appVersionName?: string | null
  // From the latest status update; newer than the registration fields above.
  appVersionInfo?: {
    versionCode?: number | null
    versionName?: string | null
  } | null
  appStateInfo?: {
    hasSendSmsPermission?: boolean
    hasReadPhoneStatePermission?: boolean
    lastUpdated?: string
  }
  // The phone's last SIM report, replaced whole on every heartbeat.
  simInfo?: {
    lastUpdated?: string
    sims?: DeviceSim[]
  } | null
  // Phone numbers the user typed per slot. A label only.
  simNumbers?: SimNumber[] | null
  // The API key the app on this phone last used is revoked.
  apiKeyRevoked?: boolean
  // 'device-link' when that key was made by phone sign-in
  apiKeySource?: string
  // When the dashboard's Disconnect device turned it off; only while it is off for that reason
  disconnectedAt?: string | null
  createdAt?: string
}

export interface DeviceSim {
  subscriptionId?: number
  // Zero-based: 0 is SIM 1
  simSlotIndex?: number
  carrierName?: string
  displayName?: string
}

export interface SimNumber {
  slotIndex: number
  phoneNumber: string
}

// A device whose app last used the key and reported in the last 7 days.
export interface ApiKeyDevice {
  _id: string
  name?: string | null
  brand?: string
  model?: string
  lastHeartbeat: string
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
  // Active keys only.
  devices?: ApiKeyDevice[]
  // 'device-link' for a key made by phone sign-in; missing for a hand-made key
  source?: string
  // The phone a sign-in key works for; null when that device was deleted
  linkedDevice?: LinkedDevice | null
}

export interface LinkedDevice {
  _id: string
  name?: string | null
  brand?: string | null
  model?: string | null
  lastHeartbeat?: string | null
  enabled?: boolean
}

export const SIGN_IN_KEY_SOURCE = 'device-link'

export interface Plan {
  name?: string
  dailyLimit?: number
  monthlyLimit?: number
  bulkSendLimit?: number
  deviceLimit?: number
  // Absent means the server default applies. -1 means unlimited.
  webhookLimit?: number
  // Prices are in cents and live on the plan as monthlyPrice/yearlyPrice.
  // This type previously declared amount/currency/recurringInterval, which the
  // plans endpoint has never sent: those belong to Subscription, populated
  // from the payment provider. Anything reading plan.amount silently saw
  // undefined and rendered a paid plan as free.
  monthlyPrice?: number
  yearlyPrice?: number
  isActive?: boolean
  // Live checkout promotion for this plan. Absent or null when none applies.
  promotion?: PlanPromotion | null
}

/** A promotion from /billing/plans. Prices are in cents. */
export interface PlanPromotion {
  label: string
  percentOff: number
  endsAt: string | null
  duration: 'once' | 'repeating' | 'forever'
  durationInMonths: number | null
  monthlyPrice: number | null
  yearlyPrice: number | null
  newCheckoutsOnly: boolean
}

export interface SubscriptionUsage {
  dailyLimit?: number
  monthlyLimit?: number
  bulkSendLimit?: number
  deviceLimit?: number
  webhookLimit?: number
  processedSmsToday?: number
  // Counts the current billing period; the name predates periods.
  processedSmsLastMonth?: number
  monthlyPeriodStart?: string
  monthlyResetAt?: string
  dailyRemaining?: number
  monthlyRemaining?: number
  dailyUsagePercentage?: number
  monthlyUsagePercentage?: number
  /** Message limits are reduced until an unpaid renewal goes through. */
  paymentHold?: boolean
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
  discountId?: string | null
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

// Phone sign-in: the link page's view of one request. The server builds the
// choices and every text; the page only shows them.
export interface DeviceLinkWarning {
  code: string
  text: string
}

export interface DeviceLinkDeviceOption {
  type: 'reconnect'
  deviceId: string
  name: string | null
  brand: string | null
  model: string | null
  lastSeenAt: string | null
  enabled: boolean
  match?: string
  warning: DeviceLinkWarning | null
  allowed: boolean
  group: 'main' | 'replace'
  // The "Turn this device on" box, for a device that is off. Null or missing:
  // no box. allowed is false when turning it on would pass the plan's limit.
  // disconnectedAt: when the dashboard's Disconnect device turned it off.
  turnOn?: { default: boolean; allowed: boolean; disconnectedAt?: string | null } | null
}

export interface DeviceLinkNewOption {
  type: 'new'
  allowed: boolean
  warning: DeviceLinkWarning | null
  group: 'main'
}

export type DeviceLinkOption = DeviceLinkDeviceOption | DeviceLinkNewOption

export interface DeviceLinkLookup {
  mode: 'choose' | 'reconnect-only' | 'blocked'
  status: 'pending' | 'approved' | 'denied'
  phone: { name?: string | null; brand?: string | null; model?: string | null }
  requestedFrom?: string
  browserFrom?: string
  sameNetwork?: boolean
  strongSameNetwork?: boolean
  mustTypeCode: boolean
  accountEmail?: string
  emailVerified?: boolean
  expiresAt: string
  // Seconds left on the server's clock, when the server sends them
  secondsLeft?: number
  // null or missing: no default choice. Otherwise the page offers to make a
  // new phone the account's default device.
  defaultChoice?: { currentDefaultName: string | null } | null
  defaultName?: string
  // limit is null on a plan without a device limit
  deviceLimit?: { limit: number | null; active: number; reached: boolean }
  // A Device ID, 'new', or null
  suggested: string | null
  message: string | null
  options: DeviceLinkOption[]
}

// Whether the dashboard offers the code field, and which tab opens first
export interface DeviceLinkSettings {
  enabled: boolean
  defaultTab?: string
}
