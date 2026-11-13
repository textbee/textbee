// Order: device override, platform document, env var, built-in default

// One banner on the app's home screen
export type AppNotice = {
  id: string
  level: 'info' | 'warning' | 'error'
  title?: string
  text: string
  actionLabel?: string
  actionUrl?: string
  dismissible: boolean
  maxAgeHours?: number
  notify?: boolean
}

export type SettingValue = boolean | number | string | AppNotice

type SettingSpec = {
  type: 'boolean' | 'integer' | 'string' | 'notice'
  env: string
  // null: absent unless a level sets it
  default: SettingValue | null
  min?: number
  max?: number
  maxLength?: number
  // phone: config top level; tuning: config.tuning; notice: feeds config.notices
  target: 'phone' | 'tuning' | 'server' | 'notice'
  deviceOverride: boolean
}

// Largest value the app can read into an Int
const INT32_MAX = 2147483647

// prettier-ignore
export const APP_SETTINGS = {
  sendSchedulerV2Enabled: { type: 'boolean', env: 'SEND_SCHEDULER_V2_ENABLED', default: true, target: 'phone', deviceOverride: true },
  recoveryPollEnabled: { type: 'boolean', env: 'RECOVERY_POLL_ENABLED', default: false, target: 'phone', deviceOverride: true },
  updateNotificationsEnabled: { type: 'boolean', env: 'UPDATE_NOTIFICATIONS_ENABLED', default: false, target: 'phone', deviceOverride: true },
  directUploadEnabled: { type: 'boolean', env: 'DIRECT_UPLOAD_ENABLED', default: false, target: 'phone', deviceOverride: true },
  pullEnabled: { type: 'boolean', env: 'PULL_ENABLED', default: false, target: 'phone', deviceOverride: true },
  partReportsEnabled: { type: 'boolean', env: 'PART_REPORTS_ENABLED', default: true, target: 'phone', deviceOverride: true },
  latestVersionCode: { type: 'integer', env: 'LATEST_APP_VERSION_CODE', default: 18, min: 1, max: INT32_MAX, target: 'phone', deviceOverride: true },
  latestVersionName: { type: 'string', env: 'LATEST_APP_VERSION_NAME', default: '2.8.0', maxLength: 32, target: 'phone', deviceOverride: true },
  periodicJobMinutes: { type: 'integer', env: 'PERIODIC_JOB_MINUTES', default: 30, min: 15, max: 240, target: 'phone', deviceOverride: true },
  deviceLogMaxEntries: { type: 'integer', env: 'DEVICE_LOG_MAX_ENTRIES', default: 10000, min: 500, max: 20000, target: 'phone', deviceOverride: true },
  analyticsEnabled: { type: 'boolean', env: 'APP_ANALYTICS_ENABLED', default: true, target: 'phone', deviceOverride: true },
  claimMinGapSeconds: { type: 'integer', env: 'CLAIM_MIN_GAP_SECONDS', default: 30, min: 10, max: 300, target: 'tuning', deviceOverride: true },
  directUploadRetryDelaySeconds: { type: 'integer', env: 'DIRECT_UPLOAD_RETRY_DELAY_SECONDS', default: 30, min: 30, max: 3600, target: 'tuning', deviceOverride: true },
  sendingMarkerYoungMinutes: { type: 'integer', env: 'SENDING_MARKER_YOUNG_MINUTES', default: 5, min: 3, max: 60, target: 'tuning', deviceOverride: true },
  carrierVerdictEnabled: { type: 'boolean', env: 'CARRIER_VERDICT_ENABLED', default: false, target: 'server', deviceOverride: true },
  multipartFailureFinalEnabled: { type: 'boolean', env: 'MULTIPART_FAILURE_FINAL_ENABLED', default: true, target: 'server', deviceOverride: false },
  partReportsStoreEnabled: { type: 'boolean', env: 'PART_REPORTS_STORE_ENABLED', default: true, target: 'server', deviceOverride: false },
  updateRolloutPercent: { type: 'integer', env: 'UPDATE_ROLLOUT_PERCENT', default: 100, min: 0, max: 100, target: 'server', deviceOverride: false },
  minSupportedVersionCode: { type: 'integer', env: 'MIN_SUPPORTED_APP_VERSION_CODE', default: 0, min: 0, max: INT32_MAX, target: 'server', deviceOverride: true },
  notice: { type: 'notice', env: 'APP_NOTICE_JSON', default: null, target: 'notice', deviceOverride: true },
  deviceRouteThrottleEnabled: { type: 'boolean', env: 'DEVICE_ROUTE_THROTTLE_ENABLED', default: true, target: 'server', deviceOverride: false },
} satisfies Record<string, SettingSpec>

export type SettingKey = keyof typeof APP_SETTINGS

export const SETTING_KEYS = Object.keys(APP_SETTINGS) as SettingKey[]

// Values from the platform document, kept fresh by AppConfigProvider
let platformValues: Record<string, unknown> = {}

export function setPlatformValues(values: unknown): void {
  platformValues = isPlainObject(values) ? values : {}
}

export function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ownValue(values: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(values, key)
    ? values[key]
    : undefined
}

export const NOTICE_ID = /^[A-Za-z0-9._-]{1,40}$/
// Control, invisible and bidirectional characters, line breaks, lone surrogates
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]|\p{Cs}/u
const UNSAFE_URL = /[\s\u0000-\u001f\u007f-\u009f]/
// App screens a notice button can open, matched exactly
const APP_LINKS = [
  'textbee://device-health',
  'textbee://add-api-key',
  'textbee://battery-settings',
]
const MAX_AGE_HOURS_MAX = 8760

// The trimmed text when it has 1 to maxLength safe characters, else undefined
export function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > maxLength) return undefined
  return UNSAFE_TEXT.test(trimmed) ? undefined : trimmed
}

// undefined: absent; null: present but invalid
function noticeText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined
  return safeText(value, maxLength) ?? null
}

function noticeUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  if (APP_LINKS.includes(value)) return value
  // The app opens only links that start with https://
  if (!value.startsWith('https://')) return null
  if (value.length > 2048 || UNSAFE_URL.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !url.hostname) return null
  if (url.username || url.password) return null
  return url.href.length > 2048 ? null : url.href
}

function noticeMaxAge(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  return value >= 1 && value <= MAX_AGE_HOURS_MAX ? value : null
}

export function validNotice(value: unknown): AppNotice | undefined {
  if (!isPlainObject(value)) return undefined
  const id = ownValue(value, 'id')
  const level = ownValue(value, 'level')
  const dismissible = ownValue(value, 'dismissible')
  const notify = ownValue(value, 'notify')
  if (typeof id !== 'string' || !NOTICE_ID.test(id)) return undefined
  if (level !== 'info' && level !== 'warning' && level !== 'error') return undefined
  if (typeof dismissible !== 'boolean') return undefined
  if (notify !== undefined && notify !== null && typeof notify !== 'boolean')
    return undefined
  const text = noticeText(ownValue(value, 'text'), 200)
  const title = noticeText(ownValue(value, 'title'), 60)
  const actionLabel = noticeText(ownValue(value, 'actionLabel'), 30)
  const actionUrl = noticeUrl(ownValue(value, 'actionUrl'))
  const maxAgeHours = noticeMaxAge(ownValue(value, 'maxAgeHours'))
  if (!text || title === null || actionLabel === null || actionUrl === null)
    return undefined
  if (maxAgeHours === null) return undefined
  if ((actionLabel === undefined) !== (actionUrl === undefined)) return undefined
  const notice: AppNotice = { id, level, text, dismissible }
  if (title !== undefined) notice.title = title
  if (actionLabel !== undefined) {
    notice.actionLabel = actionLabel
    notice.actionUrl = actionUrl
  }
  if (maxAgeHours !== undefined) notice.maxAgeHours = maxAgeHours
  if (notify === true) notice.notify = true
  return notice
}

// Platform values stay the same object between reads, so each is checked once
const checkedNotices = new WeakMap<object, AppNotice | undefined>()
let envNotice: { raw: string; notice: AppNotice | undefined } | undefined

// The value when it fits the setting's type and range, else undefined
function validValue(
  spec: SettingSpec,
  value: unknown,
): SettingValue | undefined {
  switch (spec.type) {
    case 'notice':
      if (!isPlainObject(value)) return undefined
      if (!checkedNotices.has(value)) checkedNotices.set(value, validNotice(value))
      return checkedNotices.get(value)
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined
    case 'string': {
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      if (trimmed === '') return undefined
      if (spec.maxLength !== undefined && trimmed.length > spec.maxLength)
        return undefined
      return trimmed
    }
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        return undefined
      if (spec.min !== undefined && value < spec.min) return undefined
      if (spec.max !== undefined && value > spec.max) return undefined
      return value
  }
}

function envValue(spec: SettingSpec): SettingValue | undefined {
  switch (spec.type) {
    case 'notice': {
      const raw = process.env[spec.env]
      if (!raw?.trim()) return undefined
      if (envNotice?.raw !== raw) envNotice = { raw, notice: parseNotice(raw) }
      return envNotice.notice
    }
    case 'boolean':
      return envBool(spec.env, spec.default as boolean)
    case 'string':
      return validValue(spec, process.env[spec.env])
    case 'integer': {
      const raw = process.env[spec.env]
      if (raw === undefined || !/^\s*-?\d+\s*$/.test(raw)) return undefined
      return validValue(spec, Number(raw.trim()))
    }
  }
}

function parseNotice(raw: string): AppNotice | undefined {
  try {
    return validNotice(JSON.parse(raw))
  } catch {
    return undefined
  }
}

// Env vars that are set but invalid, so the env level ignores them
export function invalidEnvVars(): string[] {
  return SETTING_KEYS.map((key): SettingSpec => APP_SETTINGS[key])
    .filter((spec) => process.env[spec.env]?.trim() && envValue(spec) === undefined)
    .map((spec) => spec.env)
}

// Each setting whose env var is set to a valid value, as the env level reads it
export function envSnapshot(): Record<string, SettingValue> {
  const snapshot: Record<string, SettingValue> = {}
  for (const key of SETTING_KEYS) {
    const spec: SettingSpec = APP_SETTINGS[key]
    if (!process.env[spec.env]?.trim()) continue
    const value = envValue(spec)
    if (value !== undefined) snapshot[key] = value
  }
  return snapshot
}

// Keys of a platform document that are unknown or fail validation
export function droppedPlatformKeys(values: unknown): string[] {
  if (!isPlainObject(values)) return []
  return Object.keys(values).filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(APP_SETTINGS, key) ||
      validValue(APP_SETTINGS[key as SettingKey], values[key]) === undefined,
  )
}

// The device's own valid value for a setting, else undefined
export function deviceOverride(
  key: SettingKey,
  overrides?: unknown,
): SettingValue | undefined {
  const spec: SettingSpec = APP_SETTINGS[key]
  if (!spec.deviceOverride || !isPlainObject(overrides)) return undefined
  return validValue(spec, ownValue(overrides, key))
}

// null only for a setting with no built-in value, such as notice
export function resolveSetting(
  key: SettingKey,
  overrides?: unknown,
): SettingValue | null {
  const spec: SettingSpec = APP_SETTINGS[key]
  const own = deviceOverride(key, overrides)
  if (own !== undefined) return own
  const platform = validValue(spec, ownValue(platformValues, key))
  if (platform !== undefined) return platform
  return envValue(spec) ?? spec.default
}
