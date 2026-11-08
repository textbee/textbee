import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Device, DeviceDocument } from '../schemas/device.schema'
import * as firebaseAdmin from 'firebase-admin'
import { BatchResponse, Message } from 'firebase-admin/messaging'
import { heartbeatAndroidConfig } from '../fcm-push-options'
import { withSendTimeout } from '../queue/send-timeout'
import { MonitoredJob, pingJob } from '../../common/job-monitor'

// FCM accepts at most 500 messages per sendEach call
export const FCM_BATCH_SIZE = 500
// A device is stale once it has not reported for this long
export const STALE_AFTER_MS = 30 * 60 * 1000
// The batches of one run are spread over this window, so the phones' replies
// arrive spread out too instead of all in the same minute
export const PUSH_SPREAD_MS = 20 * 60 * 1000
// Pause before retrying a batch whose push call failed as a whole
export const BATCH_RETRY_DELAY_MS = 5_000

type StaleDevice = { _id: Types.ObjectId; fcmToken?: string }

export interface HeartbeatRunSummary {
  devices: number
  batches: number
  batchesSucceeded: number
  batchesFailed: number
  sent: number
  failed: number
  invalidated: number
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
        `Heartbeat check: ${summary.devices} stale device(s), ${summary.batchesSucceeded}/${summary.batches} batch(es) pushed, ${summary.sent} sent, ${summary.failed} failed, ${summary.invalidated} token(s) invalidated`,
      )
      // A run counts when every batch was attempted and FCM accepted at least one
      if (summary.batches === 0 || summary.batchesSucceeded > 0) {
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
      batchesFailed: 0,
      sent: 0,
      failed: 0,
      invalidated: 0,
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

    for (const [index, batch] of batches.entries()) {
      if (index > 0 && gapMs > 0) {
        await this.sleep(gapMs)
      }

      // Devices that reported on their own while waiting no longer need a push
      const stillStale = await this.findStaleDevices(batch.map((d) => d._id))
      if (stillStale.length === 0) {
        summary.batchesSucceeded += 1
        continue
      }

      const response = await this.sendBatchWithRetry(stillStale, index + 1)
      if (!response) {
        summary.batchesFailed += 1
        continue
      }

      summary.batchesSucceeded += 1
      summary.sent += response.successCount
      summary.failed += response.failureCount
      summary.invalidated += await this.invalidateDeadTokens(stillStale, response)
    }

    return summary
  }

  private async findStaleDevices(ids?: Types.ObjectId[]): Promise<StaleDevice[]> {
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS)
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
    return this.deviceModel.find(filter).select({ _id: 1, fcmToken: 1 }).lean<StaleDevice[]>()
  }

  /** One push call for the batch, retried once on a fresh connection. Null when both fail. */
  private async sendBatchWithRetry(
    devices: StaleDevice[],
    batchNumber: number,
  ): Promise<BatchResponse | null> {
    const messages: Message[] = devices.map((device) => ({
      data: { type: 'heartbeat_check' },
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
