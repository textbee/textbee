import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Device, DeviceDocument } from '../schemas/device.schema'
import { User, UserDocument } from '../../users/schemas/user.schema'
import * as firebaseAdmin from 'firebase-admin'
import { BatchResponse, Message } from 'firebase-admin/messaging'
import { heartbeatAndroidConfig, pushData } from '../fcm-push-options'
import { withSendTimeout } from '../queue/send-timeout'
import { MonitoredJob, pingJob } from '../../common/job-monitor'
import { resolveSetting } from '../app-settings'
import { deviceVersionCode } from '../push-ownership'

// FCM accepts at most 500 messages per sendEach call
export const FCM_BATCH_SIZE = 500
// A device is stale once it has not reported for this long
export const STALE_AFTER_MS = 30 * 60 * 1000
// From this build the device's own job period sets its limit
export const PERIODIC_JOB_MIN_VERSION_CODE = 22
export const PERIODIC_JOB_GRACE_MS = 15 * 60 * 1000
// The batches of one run are spread over this window, so the phones' replies
// arrive spread out too instead of all in the same minute
export const PUSH_SPREAD_MS = 20 * 60 * 1000
// Pause before retrying a batch whose push call failed as a whole
export const BATCH_RETRY_DELAY_MS = 5_000
// No new batch starts after this, so a run never overlaps the next hour
export const RUN_BUDGET_MS = 50 * 60 * 1000

type StaleDevice = { _id: Types.ObjectId; user?: Types.ObjectId; fcmToken?: string }

type StaleCandidate = StaleDevice & {
  lastHeartbeat?: Date | null
  appVersionCode?: number
  appVersionInfo?: { versionCode?: number }
  configOverrides?: Record<string, unknown> | null
}

// How long the device may stay silent before it counts as offline
export function staleAfterMs(device: StaleCandidate): number {
  if (deviceVersionCode(device) < PERIODIC_JOB_MIN_VERSION_CODE) return STALE_AFTER_MS
  const minutes = resolveSetting('periodicJobMinutes', device.configOverrides) as number
  return minutes * 60 * 1000 + PERIODIC_JOB_GRACE_MS
}

export interface HeartbeatRunSummary {
  devices: number
  batches: number
  batchesSucceeded: number
  batchesWithNothingToSend: number
  batchesFailed: number
  batchesSkipped: number
  sent: number
  failed: number
  invalidated: number
  devicesSkipped: number
}

export function isPermanentFcmTokenError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) {
    return false
  }

  const normalizedCode = String(error.code || '')
    .toLowerCase()
    .replace(/^messaging\//, '')
  const normalizedMessage = String(error.message || '').toLowerCase()

  if (
    normalizedCode === 'registration-token-not-registered' ||
    normalizedCode === 'unregistered' ||
    normalizedCode === 'invalid-registration-token'
  ) {
    return true
  }

  if (
    normalizedMessage.includes('requested entity was not found') ||
    normalizedMessage.includes('not registered') ||
    normalizedMessage.includes('registration token is not a valid')
  ) {
    return true
  }

  return false
}

@Injectable()
export class HeartbeatCheckTask {
  private readonly logger = new Logger(HeartbeatCheckTask.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Hourly: wake every device whose heartbeat is stale with an FCM push.
   * Each batch is sent and retried on its own, so one dropped connection
   * does not end the run, and the batches are spread over PUSH_SPREAD_MS.
   */
  @Cron(CronExpression.EVERY_HOUR, { waitForCompletion: true })
  async checkAndTriggerStaleHeartbeats() {
    this.logger.log('Running cron job to check for stale heartbeats')

    try {
      const summary = await this.run()
      this.logger.log(
        `Heartbeat check: ${summary.devices} stale device(s), ${summary.batchesSucceeded}/${summary.batches} batch(es) pushed, ${summary.batchesSkipped} skipped, ${summary.sent} sent, ${summary.failed} failed, ${summary.invalidated} token(s) invalidated, ${summary.devicesSkipped} device(s) skipped`,
      )
      // A run counts when FCM accepted a batch, or when no batch had anything to send
      const nothingToSend =
        summary.batchesFailed === 0 &&
        summary.batchesSkipped === 0 &&
        summary.batchesWithNothingToSend === summary.batches
      if (summary.batchesSucceeded > 0 || nothingToSend) {
        pingJob(MonitoredJob.heartbeatCheck)
      }
    } catch (error) {
      this.logger.error('Error checking and triggering stale heartbeats', error)
    }
  }

  async run(): Promise<HeartbeatRunSummary> {
    const summary: HeartbeatRunSummary = {
      devices: 0,
      batches: 0,
      batchesSucceeded: 0,
      batchesWithNothingToSend: 0,
      batchesFailed: 0,
      batchesSkipped: 0,
      sent: 0,
      failed: 0,
      invalidated: 0,
      devicesSkipped: 0,
    }

    const devices = await this.findStaleDevices()
    summary.devices = devices.length
    if (devices.length === 0) {
      this.logger.log('No devices with stale heartbeats found')
      return summary
    }

    const batches: StaleDevice[][] = []
    for (let i = 0; i < devices.length; i += FCM_BATCH_SIZE) {
      batches.push(devices.slice(i, i + FCM_BATCH_SIZE))
    }
    summary.batches = batches.length
    const gapMs = batches.length > 1 ? Math.floor(PUSH_SPREAD_MS / batches.length) : 0

    this.logger.log(
      `Found ${devices.length} device(s) with stale heartbeats, sending ${batches.length} FCM batch(es) over ${Math.round((gapMs * (batches.length - 1)) / 60000)} min`,
    )

    const startedAt = Date.now()
    for (const [index, batch] of batches.entries()) {
      // Fixed slots from the start, so slow sends do not push the schedule out
      const dueAt = startedAt + index * gapMs
      if (index > 0 && Date.now() - startedAt > RUN_BUDGET_MS) {
        summary.batchesSkipped = batches.length - index
        this.logger.warn(
          `Heartbeat check out of time: ${summary.batchesSkipped} batch(es) left for the next run`,
        )
        break
      }
      const wait = dueAt - Date.now()
      if (wait > 0) {
        await this.sleep(wait)
      }

      try {
        await this.pushBatch(batch, index + 1, summary)
      } catch (error) {
        // A database error on one batch must not end the run
        summary.batchesFailed += 1
        this.logger.error(
          `Heartbeat batch ${index + 1} failed: ${error?.message ?? error}`,
        )
      }
    }

    return summary
  }

  private async pushBatch(
    batch: StaleDevice[],
    batchNumber: number,
    summary: HeartbeatRunSummary,
  ): Promise<void> {
    // Devices that reported on their own while waiting no longer need a push
    const stillStale = await this.findStaleDevices(batch.map((d) => d._id))
    // Skip devices that can not act on a push
    const toPush = await this.keepDevicesWithValidUser(stillStale)
    summary.devicesSkipped += stillStale.length - toPush.length
    if (toPush.length === 0) {
      summary.batchesWithNothingToSend += 1
      return
    }

    const response = await this.sendBatchWithRetry(toPush, batchNumber)
    if (!response) {
      summary.batchesFailed += 1
      return
    }

    summary.batchesSucceeded += 1
    summary.sent += response.successCount
    summary.failed += response.failureCount
    summary.invalidated += await this.invalidateDeadTokens(toPush, response)
  }

  private async findStaleDevices(ids?: Types.ObjectId[]): Promise<StaleDevice[]> {
    const now = Date.now()
    // The shortest limit of any build; longer per-device limits narrow below
    const staleBefore = new Date(now - STALE_AFTER_MS)
    const filter: Record<string, unknown> = {
      heartbeatEnabled: true,
      enabled: true,
      $or: [{ lastHeartbeat: null }, { lastHeartbeat: { $lt: staleBefore } }],
      fcmToken: { $exists: true, $nin: [null, ''] },
      fcmTokenInvalidatedAt: { $exists: false },
    }
    if (ids) {
      filter._id = { $in: ids }
    }
    // Stable order keeps a device in the same slot from one run to the next
    const candidates = await this.deviceModel
      .find(filter)
      .sort({ _id: 1 })
      .select({
        _id: 1,
        user: 1,
        fcmToken: 1,
        lastHeartbeat: 1,
        appVersionCode: 1,
        'appVersionInfo.versionCode': 1,
        configOverrides: 1,
      })
      .lean<StaleCandidate[]>()
    return candidates
      .filter(
        (d) =>
          !d.lastHeartbeat || now - new Date(d.lastHeartbeat).getTime() >= staleAfterMs(d),
      )
      .map(({ _id, user, fcmToken }) => ({ _id, user, fcmToken }))
  }

  private async keepDevicesWithValidUser(devices: StaleDevice[]): Promise<StaleDevice[]> {
    if (devices.length === 0) {
      return devices
    }
    const userIds = devices.flatMap((d) => (d.user ? [d.user] : []))
    const existing = await this.userModel.distinct('_id', { _id: { $in: userIds } })
    const existingIds = new Set(existing.map((id) => id.toString()))
    return devices.filter((d) => d.user && existingIds.has(d.user.toString()))
  }

  /** One push call for the batch, retried once on a fresh connection. Null when both fail. */
  private async sendBatchWithRetry(
    devices: StaleDevice[],
    batchNumber: number,
  ): Promise<BatchResponse | null> {
    const messages: Message[] = devices.map((device) => ({
      data: pushData(device, { type: 'heartbeat_check' }),
      token: device.fcmToken,
      android: heartbeatAndroidConfig(),
    }))

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await withSendTimeout(firebaseAdmin.messaging().sendEach(messages))
      } catch (error) {
        this.logger.error(
          `Heartbeat batch ${batchNumber} attempt ${attempt} failed: ${error?.message ?? error}`,
        )
        if (attempt === 1) {
          await this.sleep(BATCH_RETRY_DELAY_MS)
        }
      }
    }
    return null
  }

  /** Marks devices whose token FCM reports as gone, so they are not pushed again. */
  private async invalidateDeadTokens(
    devices: StaleDevice[],
    response: BatchResponse,
  ): Promise<number> {
    const invalidations: Array<{ deviceId: Types.ObjectId; reason: string }> = []

    response.responses.forEach((result, index) => {
      if (result.success) return
      const errorMessage = result.error?.message || 'Unknown error'
      const errorCode = result.error?.code || 'UNKNOWN_ERROR'
      this.logger.error(
        `Failed to send heartbeat check to device ${devices[index]._id}: ${errorMessage}`,
      )
      if (isPermanentFcmTokenError(result.error)) {
        invalidations.push({
          deviceId: devices[index]._id,
          reason: `${errorCode}: ${errorMessage}`,
        })
      }
    })

    if (invalidations.length === 0) return 0

    const invalidatedAt = new Date()
    await this.deviceModel.bulkWrite(
      invalidations.map(({ deviceId, reason }) => ({
        updateOne: {
          filter: { _id: deviceId },
          update: {
            $set: { fcmTokenInvalidatedAt: invalidatedAt, fcmTokenInvalidReason: reason },
          },
        },
      })),
    )
    this.logger.warn(
      `Marked ${invalidations.length} device(s) as FCM-token-invalid; heartbeat retries paused until token update`,
    )
    return invalidations.length
  }

  // Separate so tests can skip the waits
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
