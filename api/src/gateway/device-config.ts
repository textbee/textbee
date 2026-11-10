// Settings the app reads from every heartbeat reply. The environment sets the
// fleet default; a device document's configOverrides wins for that device.

export type DeviceConfig = {
  sendSchedulerV2Enabled: boolean
  recoveryPollEnabled: boolean
  updateNotificationsEnabled: boolean
  directUploadEnabled: boolean
  latestVersionCode: number
  latestVersionName: string
}

// versionCode of the first build that carries the send dedupe store. The
// pending-message endpoint refuses older builds.
export const RECOVERY_MIN_VERSION_CODE = 20

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

function envInt(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function fleetDeviceConfig(): DeviceConfig {
  return {
    sendSchedulerV2Enabled: envBool('SEND_SCHEDULER_V2_ENABLED', true),
    recoveryPollEnabled: envBool('RECOVERY_POLL_ENABLED', false),
    updateNotificationsEnabled: envBool('UPDATE_NOTIFICATIONS_ENABLED', false),
    directUploadEnabled: envBool('DIRECT_UPLOAD_ENABLED', true),
    latestVersionCode: envInt('LATEST_APP_VERSION_CODE', 18),
    latestVersionName: process.env.LATEST_APP_VERSION_NAME?.trim() || '2.8.0',
  }
}

const OVERRIDABLE_KEYS: Array<keyof DeviceConfig> = [
  'sendSchedulerV2Enabled',
  'recoveryPollEnabled',
  'updateNotificationsEnabled',
  'directUploadEnabled',
  'latestVersionCode',
  'latestVersionName',
]

export function deviceConfigFor(
  device: { configOverrides?: Partial<DeviceConfig> | null } | null | undefined,
): DeviceConfig {
  const config = fleetDeviceConfig()
  const overrides = device?.configOverrides
  if (!overrides || typeof overrides !== 'object') return config

  for (const key of OVERRIDABLE_KEYS) {
    const value = overrides[key]
    if (value !== undefined && value !== null && typeof value === typeof config[key]) {
      ;(config as any)[key] = value
    }
  }
  return config
}
