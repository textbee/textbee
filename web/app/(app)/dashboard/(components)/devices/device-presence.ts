import { formatDistanceStrict } from 'date-fns'
import type { Device } from '@/lib/api'
import { toExactLabel } from '@/components/shared/relative-time'
import {
  type DeviceVersionFields,
  formatDeviceVersionShort,
  getDeviceVersionCode,
  latestAppVersionShortLabel,
} from './update-app-helpers'

const MINUTE_MS = 60 * 1000
// Matches the admin dashboard's online window.
const MIN_ONLINE_WINDOW_MS = 65 * MINUTE_MS
const DEFAULT_INTERVAL_MINUTES = 30

export type DevicePresence = 'online' | 'offline' | 'disabled' | 'unknown'

type PresenceInput = Pick<
  Device,
  'enabled' | 'lastHeartbeat' | 'heartbeatIntervalMinutes'
>

// Online when a heartbeat arrived within two intervals, so one late heartbeat does not flip it.
export function onlineWindowMs(device: PresenceInput): number {
  const interval =
    device.heartbeatIntervalMinutes && device.heartbeatIntervalMinutes > 0
      ? device.heartbeatIntervalMinutes
      : DEFAULT_INTERVAL_MINUTES
  return Math.max(MIN_ONLINE_WINDOW_MS, (2 * interval + 5) * MINUTE_MS)
}

export function devicePresence(
  device: PresenceInput,
  now: number = Date.now()
): DevicePresence {
  if (device.enabled === false) return 'disabled'
  const last = device.lastHeartbeat ? new Date(device.lastHeartbeat).getTime() : NaN
  // No heartbeat yet: an older build, or a phone that just registered.
  if (Number.isNaN(last)) return 'unknown'
  return now - last <= onlineWindowMs(device) ? 'online' : 'offline'
}

// Status updates (heartbeats) started in app 2.7.0, build 16.
export const STATUS_UPDATE_MIN_VERSION_CODE = 16
export const STATUS_UPDATE_MIN_VERSION_LABEL = '2.7.0'

type HintInput = PresenceInput & DeviceVersionFields

// No status update yet, and the build cannot send one: older than 2.7.0, or no version on record.
export function needsNewerAppForPresence(
  device: HintInput,
  now: number = Date.now()
): boolean {
  if (devicePresence(device, now) !== 'unknown') return false
  const code = getDeviceVersionCode(device)
  return code === null || code < STATUS_UPDATE_MIN_VERSION_CODE
}

export function presenceHint(
  device: HintInput,
  now: number = Date.now()
): string {
  const presence = devicePresence(device, now)
  const interval =
    device.heartbeatIntervalMinutes && device.heartbeatIntervalMinutes > 0
      ? device.heartbeatIntervalMinutes
      : DEFAULT_INTERVAL_MINUTES
  const every =
    interval === 1
      ? 'The app sends a status update every minute.'
      : `The app sends a status update every ${interval} minutes.`
  const last = device.lastHeartbeat ? new Date(device.lastHeartbeat) : null
  const nowDate = new Date(now)

  if (presence === 'online' && last) {
    const seen =
      now - last.getTime() < MINUTE_MS
        ? 'just now'
        : formatDistanceStrict(last, nowDate, { addSuffix: true })
    return `Last seen ${seen} (${toExactLabel(last)}). ${every}`
  }
  if (presence === 'offline' && last) {
    const gap = formatDistanceStrict(last, nowDate)
    return `Not seen for ${gap}. ${every} Open the textbee app on the phone and turn off battery optimization for textbee.`
  }
  if (presence === 'disabled') {
    const seen =
      last && !Number.isNaN(last.getTime())
        ? ` Last seen: ${toExactLabel(last)}.`
        : ''
    return `The gateway is off in the textbee app on this phone. Sends to this device fail until you turn it on.${seen}`
  }
  if (needsNewerAppForPresence(device, now)) {
    const version = formatDeviceVersionShort(device)
    return version
      ? `App ${version} sends no status updates, so the dashboard cannot tell if this phone is online. Update the app to ${latestAppVersionShortLabel}.`
      : `This phone runs an old app version that sends no status updates, so the dashboard cannot tell if it is online. Update the app to ${latestAppVersionShortLabel}.`
  }
  return 'Not seen yet. Open the textbee app on the phone.'
}
