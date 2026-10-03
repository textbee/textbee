import { Model, Types } from 'mongoose'
import {
  PERMISSION_DENIED,
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

const HEARTBEAT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** True while a report from the last 7 days says the SMS permission is off. */
export const reportsSmsPermissionOff = (device: any, now: Date): boolean => {
  const state = device?.appStateInfo
  const reportedAt = new Date(state?.lastUpdated).getTime()
  return (
    state?.hasSendSmsPermission === false &&
    reportedAt >= now.getTime() - HEARTBEAT_WINDOW_MS
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
  options: { includeHeartbeat?: boolean } = {},
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
    const reporting: any[] = await deviceModel
      .find({
        user: userId,
        enabled: true,
        'appStateInfo.hasSendSmsPermission': false,
        lastHeartbeat: { $gte: new Date(now.getTime() - HEARTBEAT_WINDOW_MS) },
      })
      .select('name brand model appStateInfo lastHeartbeat')
      .lean()
    // A send that worked after the report means the report is stale.
    const sentAt =
      last?.status === 'sent' || last?.status === 'delivered'
        ? new Date(last.updatedAt ?? last.createdAt).getTime()
        : undefined
    const current = reporting.filter(
      (d) =>
        sentAt === undefined ||
        String(d._id) !== String(last.device) ||
        !(new Date(d.appStateInfo?.lastUpdated).getTime() < sentAt),
    )
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
