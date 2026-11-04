import { Types } from 'mongoose'
import { RECOVERY_MIN_VERSION_CODE } from './device-config'
import { SMSType } from './sms-type.enum'

// A message the phone may have missed: outbound, still waiting, old enough
// that its push is not just slow, young enough to still be wanted, and not
// handed out too many times already. It must also have been queued for a
// build that remembers what it sent, so an older build's send is never repeated.
export const REDISPATCH_AFTER_MS = 30 * 60 * 1000
export const RECOVERY_WINDOW_MS = 72 * 60 * 60 * 1000
export const MAX_DISPATCH_ATTEMPTS = 3
export const CLAIM_LIMIT = 25
export const POLL_COOLDOWN_MS = 5 * 60 * 1000

export function pendingRecoveryFilter(deviceId: string, now: Date = new Date()) {
  const redispatchBefore = new Date(now.getTime() - REDISPATCH_AFTER_MS)
  const windowStart = new Date(now.getTime() - RECOVERY_WINDOW_MS)
  return {
    device: Types.ObjectId.isValid(deviceId) ? new Types.ObjectId(deviceId) : deviceId,
    type: SMSType.SENT,
    status: { $in: ['pending', 'dispatched', 'unknown'] as const },
    requestedAt: { $gte: windowStart },
    'metadata.appVersionCode': { $gte: RECOVERY_MIN_VERSION_CODE },
    $and: [
      {
        $or: [
          { dispatchedAt: { $lt: redispatchBefore } },
          { dispatchedAt: { $exists: false }, requestedAt: { $lt: redispatchBefore } },
        ],
      },
      { $or: [{ dispatchDueAt: { $exists: false } }, { dispatchDueAt: { $lte: now } }] },
      {
        $or: [
          { dispatchAttempts: { $exists: false } },
          { dispatchAttempts: { $lt: MAX_DISPATCH_ATTEMPTS } },
        ],
      },
    ],
  }
}

// The same shape the push carries, so the app treats both alike
export function toRecoveryPayload(sms: {
  _id: Types.ObjectId
  smsBatch?: unknown
  message?: string
  recipient?: string
  simSubscriptionId?: number
}) {
  const batch = (sms.smsBatch as { _id?: unknown })?._id ?? sms.smsBatch
  return {
    smsId: String(sms._id),
    smsBatchId: batch ? String(batch) : undefined,
    message: sms.message,
    recipients: [sms.recipient],
    ...(sms.simSubscriptionId !== undefined && {
      simSubscriptionId: sms.simSubscriptionId,
    }),
  }
}
