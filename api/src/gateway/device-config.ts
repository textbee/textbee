import { createHash } from 'crypto'
import {
  APP_SETTINGS,
  AppNotice,
  NOTICE_ID,
  SETTING_KEYS,
  deviceOverride,
  resolveSetting,
  safeText,
} from './app-settings'

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
  notices: AppNotice[]
}

type ConfigDevice = {
  _id?: unknown
  appVersionCode?: number
  appVersionName?: string
  appVersionInfo?: { versionCode?: number; versionName?: string } | null
  configOverrides?: Record<string, unknown> | null
}

// What the server knows about the device; a build of 0 is unknown
export type DeviceFacts = {
  deviceId?: string
  versionCode: number
  versionName?: string
}

export type NoticeSettings = {
  latestVersionCode: number
  latestVersionName: string
  minSupportedVersionCode: number
  // One notice or a list in priority order, as stored
  notice?: AppNotice | AppNotice[] | null
}

// versionCode of the first build that carries the send dedupe store. The
// pending-message endpoint refuses older builds.
export const RECOVERY_MIN_VERSION_CODE = 20

export const UNSUPPORTED_NOTICE_TEXT =
  'This version of textbee is no longer supported. Update to get fixes and support.'

export const CLOSED_NOTICE_IDS_MAX = 50
// A longer list is ignored, to bound the work per heartbeat
export const CLOSED_NOTICE_IDS_READ_MAX = 200

const DOWNLOAD_URL = 'https://textbee.dev/download'
const VERSION_NAME_MAX = APP_SETTINGS.latestVersionName.maxLength

export function fleetDeviceConfig(): DeviceConfig {
  return deviceConfigFor(null)
}

// The newer of the heartbeat build (appVersionInfo) and the registered one
export function deviceFacts(device: ConfigDevice | null | undefined): DeviceFacts {
  const info = device?.appVersionInfo
  const versionCode = Math.max(
    validBuild(info?.versionCode) ? info.versionCode : 0,
    validBuild(device?.appVersionCode) ? device.appVersionCode : 0,
  )
  const names = [
    info?.versionCode === versionCode ? info?.versionName : undefined,
    device?.appVersionCode === versionCode ? device?.appVersionName : undefined,
  ]
  const versionName =
    versionCode > 0
      ? names.find((name) => typeof name === 'string' && name.trim() !== '')?.trim()
      : undefined
  return {
    deviceId: device?._id != null ? String(device._id) : undefined,
    versionCode,
    versionName,
  }
}

function validBuild(code: unknown): code is number {
  return typeof code === 'number' && Number.isInteger(code) && code > 0
}

// A fixed number from 0 to 99 for each device id
export function rolloutBucket(deviceId: string): number {
  const hash = createHash('sha1').update(deviceId).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % 100
}

export function inUpdateGroup(
  deviceId: string | undefined,
  percent: number,
): boolean {
  if (percent >= 100) return true
  return deviceId !== undefined && rolloutBucket(deviceId) < percent
}

export function downloadUrl(facts: DeviceFacts): string {
  if (!facts.versionCode || !facts.versionName) return DOWNLOAD_URL
  try {
    // Same encoding as Uri.encode in the app
    const current = encodeURIComponent(`${facts.versionName}(${facts.versionCode})`)
    return `${DOWNLOAD_URL}?currentVersion=${current}`
  } catch {
    return DOWNLOAD_URL
  }
}

// ISO 8601 week-numbering year and week of the date, in UTC
export function isoWeek(now: Date): { year: number; week: number } {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  // The Thursday of this week decides the year
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7))
  const year = day.getUTCFullYear()
  const week = Math.ceil(
    ((day.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7,
  )
  return { year, week }
}

// In display order: unsupported build, device or platform notices, update available
export function chooseNotices(
  facts: DeviceFacts,
  settings: NoticeSettings,
  now: Date,
): AppNotice[] {
  const notices: AppNotice[] = []
  const build = facts.versionCode
  const unsupported = build > 0 && build < settings.minSupportedVersionCode
  if (unsupported) {
    notices.push({
      id: `unsupported-${settings.minSupportedVersionCode}`,
      level: 'warning',
      text: UNSUPPORTED_NOTICE_TEXT,
      actionLabel: 'Update',
      actionUrl: downloadUrl(facts),
      dismissible: false,
    })
  }
  // Copies, so a reply never shares the cached notices
  const own = (
    Array.isArray(settings.notice) ? settings.notice : settings.notice ? [settings.notice] : []
  ).map((notice) => ({ ...notice }))
  notices.push(...own)
  // The latest version as sent to this device, after the update group rule
  if (!unsupported && build > 0 && build < settings.latestVersionCode) {
    const { year, week } = isoWeek(now)
    const name = safeText(settings.latestVersionName, VERSION_NAME_MAX)
    notices.push({
      id: `update-${settings.latestVersionCode}-${year}-${String(week).padStart(2, '0')}`,
      level: 'info',
      text: name
        ? `textbee ${name} is available.`
        : 'A new version of textbee is available.',
      actionLabel: 'Update',
      actionUrl: downloadUrl(facts),
      dismissible: true,
    })
  }
  // The app keeps the first of two notices with one id; the server's own stays
  const serverIds = notices.filter((notice) => !own.includes(notice)).map((notice) => notice.id)
  return notices.filter((notice) => !own.includes(notice) || !serverIds.includes(notice.id))
}

// The valid ids of a heartbeat list, newest 50 kept; undefined for a non-list or one over 200
export function cleanClosedNoticeIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > CLOSED_NOTICE_IDS_READ_MAX) return undefined
  return value
    .filter((id): id is string => typeof id === 'string' && NOTICE_ID.test(id))
    .slice(-CLOSED_NOTICE_IDS_MAX)
}

export function deviceConfigFor(
  device: ConfigDevice | null | undefined,
  now: Date = new Date(),
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

  const facts = deviceFacts(device)
  const latestVersionCode = config.latestVersionCode as number
  // Outside the update group a device is told its own build, so released builds show no prompt
  if (
    deviceOverride('latestVersionCode', overrides) === undefined &&
    facts.versionCode > 0 &&
    latestVersionCode > facts.versionCode &&
    !inUpdateGroup(
      facts.deviceId,
      resolveSetting('updateRolloutPercent') as number,
    )
  ) {
    config.latestVersionCode = facts.versionCode
    const ownName = safeText(facts.versionName, VERSION_NAME_MAX)
    if (deviceOverride('latestVersionName', overrides) === undefined && ownName)
      config.latestVersionName = ownName
  }

  const minimum = resolveSetting('minSupportedVersionCode', overrides) as number
  config.notices = chooseNotices(
    facts,
    {
      latestVersionCode: config.latestVersionCode as number,
      latestVersionName: config.latestVersionName as string,
      // A minimum above the latest version would leave a banner nobody can clear
      minSupportedVersionCode: minimum <= latestVersionCode ? minimum : 0,
      notice: resolveSetting('notice', overrides) as AppNotice | AppNotice[] | null,
    },
    now,
  )
  return config as DeviceConfig
}
