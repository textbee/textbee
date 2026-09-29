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
  return {
    needsSmsPermission: needs ?? null,
    hoursSinceFailure: hoursSincePermissionFailure(last, device, now) ?? null,
    deviceId: needs && last.device ? String(last.device) : null,
    deviceName: needs ? deviceLabel(device) : null,
    failedAt: needs ? new Date(permissionFailureAt(last)) : null,
  }
}
