import { APP_SETTINGS, SETTING_KEYS, resolveSetting } from './app-settings'

// The config sent in heartbeat and claim replies; server-only settings stay out

export type DeviceConfigTuning = {
  claimMinGapSeconds: number
  directUploadRetryDelaySeconds: number
  sendingMarkerYoungMinutes: number
}

export type DeviceConfig = {
  sendSchedulerV2Enabled: boolean
  recoveryPollEnabled: boolean
  updateNotificationsEnabled: boolean
  directUploadEnabled: boolean
  pullEnabled: boolean
  partReportsEnabled: boolean
  latestVersionCode: number
  latestVersionName: string
  periodicJobMinutes: number
  deviceLogMaxEntries: number
  analyticsEnabled: boolean
  tuning: DeviceConfigTuning
}

// versionCode of the first build that carries the send dedupe store. The
// pending-message endpoint refuses older builds.
export const RECOVERY_MIN_VERSION_CODE = 20

export function fleetDeviceConfig(): DeviceConfig {
  return deviceConfigFor(null)
}

export function deviceConfigFor(
  device:
    { configOverrides?: Record<string, unknown> | null } | null | undefined,
): DeviceConfig {
  const overrides = device?.configOverrides
  const config: Record<string, unknown> = {}
  const tuning: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    const target = APP_SETTINGS[key].target
    if (target === 'phone') config[key] = resolveSetting(key, overrides)
    if (target === 'tuning') tuning[key] = resolveSetting(key, overrides)
  }
  config.tuning = tuning
  return config as DeviceConfig
}
