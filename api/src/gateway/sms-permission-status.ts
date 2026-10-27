import { Model, Types } from 'mongoose'
import {
  PERMISSION_DENIED,
  currentPermissionReporters,
  hoursSincePermissionFailure,
  needsSmsPermission,
  permissionFailureAt,
} from '../notifications/rules/sms-permission'
import { DeviceDocument } from './schemas/device.schema'
import { SMSDocument } from './schemas/sms.schema'
import { SMSType } from './sms-type.enum'

export interface SmsPermissionStatus {
  needsSmsPermission: boolean | null
  hoursSinceFailure: number | null
  deviceId: string | null
  deviceName: string | null
  failedAt: Date | null
  source: 'failure' | 'heartbeat' | null
}

// Only a phone that is currently reporting in counts. A device reports its
// permission state on every heartbeat, so a live phone is never more than one
// interval stale and corrects itself as soon as the permission is granted
// again. A longer window instead kept flagging phones that had simply gone
// offline, which told those accounts the permission was off when the real
// problem was the phone.
const DEFAULT_HEARTBEAT_WINDOW_MS = 6 * 60 * 60 * 1000

/** True while a report from the last 7 days says the SMS permission is off. */
export const reportsSmsPermissionOff = (
  device: any,
  now: Date,
  windowMs: number = DEFAULT_HEARTBEAT_WINDOW_MS,
): boolean => {
  const state = device?.appStateInfo
  const reportedAt = new Date(state?.lastUpdated).getTime()
  return (
    state?.hasSendSmsPermission === false &&
    reportedAt >= now.getTime() - windowMs
  )
}

const deviceLabel = (device: any): string | null =>
  device?.name || [device?.brand, device?.model].filter(Boolean).join(' ') || null

// Two indexed reads: the latest outgoing message ({user, createdAt, _id}),
// then its device only when that message failed for a missing permission.
export async function loadSmsPermissionStatus(
  smsModel: Model<SMSDocument>,
  deviceModel: Model<DeviceDocument>,
  userId: Types.ObjectId,
  now: Date,
  options: { includeHeartbeat?: boolean; heartbeatWindowMs?: number } = {},
): Promise<SmsPermissionStatus> {
  const last: any = await smsModel
    .findOne({ user: userId, type: SMSType.SENT })
    .sort({ createdAt: -1, _id: -1 })
    .select(
      'status errorCode createdAt updatedAt failedAt device simSubscriptionId',
    )
    .lean()

  const blocked =
    last?.status === 'failed' && last?.errorCode === PERMISSION_DENIED
  const device: any =
    blocked && last.device
      ? await deviceModel
          .findById(last.device)
          .select('appStateInfo enabled name brand model')
          .lean()
      : null

  const needs = needsSmsPermission(last, device)
  if (needs) {
    return {
      needsSmsPermission: true,
      hoursSinceFailure: hoursSincePermissionFailure(last, device, now) ?? null,
      deviceId: last.device ? String(last.device) : null,
      deviceName: deviceLabel(device),
      failedAt: new Date(permissionFailureAt(last)),
      source: 'failure',
    }
  }

  if (options.includeHeartbeat) {
    const windowMs = options.heartbeatWindowMs ?? DEFAULT_HEARTBEAT_WINDOW_MS
    const cutoff = new Date(now.getTime() - windowMs)
    const reporting: any[] = await deviceModel
      .find({
        user: userId,
        enabled: true,
        'appStateInfo.hasSendSmsPermission': false,
        'appStateInfo.lastUpdated': { $gte: cutoff },
        lastHeartbeat: { $gte: cutoff },
      })
      .select('name brand model appStateInfo lastHeartbeat')
      .lean()
    // Which reports still stand is a shared rule, so a preview of this cannot
    // reach a different answer from the feed.
    const current = currentPermissionReporters(reporting, last, now)
    if (current.length > 0) {
      const latest = current.reduce((a, b) =>
        new Date(b.lastHeartbeat).getTime() > new Date(a.lastHeartbeat).getTime()
          ? b
          : a,
      )
      return {
        needsSmsPermission: true,
        hoursSinceFailure: null,
        deviceId: String(latest._id),
        deviceName: deviceLabel(latest),
        failedAt: null,
        source: 'heartbeat',
      }
    }
  }

  return {
    needsSmsPermission: needs ?? null,
    hoursSinceFailure: null,
    deviceId: null,
    deviceName: null,
    failedAt: null,
    source: null,
  }
}
