// Order: device override, platform document, env var, built-in default

export type SettingValue = boolean | number | string

type SettingSpec = {
  type: 'boolean' | 'integer' | 'string'
  env: string
  default: SettingValue
  min?: number
  max?: number
  maxLength?: number
  // phone: top level of the device config; tuning: nested under config.tuning
  target: 'phone' | 'tuning' | 'server'
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

// The value when it fits the setting's type and range, else undefined
function validValue(
  spec: SettingSpec,
  value: unknown,
): SettingValue | undefined {
  switch (spec.type) {
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

// Keys of a platform document that are unknown or fail validation
export function droppedPlatformKeys(values: unknown): string[] {
  if (!isPlainObject(values)) return []
  return Object.keys(values).filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(APP_SETTINGS, key) ||
      validValue(APP_SETTINGS[key as SettingKey], values[key]) === undefined,
  )
}

export function resolveSetting(
  key: SettingKey,
  overrides?: unknown,
): SettingValue {
  const spec: SettingSpec = APP_SETTINGS[key]
  if (spec.deviceOverride && isPlainObject(overrides)) {
    const value = validValue(spec, ownValue(overrides, key))
    if (value !== undefined) return value
  }
  const platform = validValue(spec, ownValue(platformValues, key))
  if (platform !== undefined) return platform
  return envValue(spec) ?? spec.default
}
