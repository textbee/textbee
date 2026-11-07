import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Device, DeviceDocument } from '../schemas/device.schema'
import * as firebaseAdmin from 'firebase-admin'
import { Message } from 'firebase-admin/messaging'
import { heartbeatAndroidConfig } from '../fcm-push-options'
import { MonitoredJob, pingJob } from '../../common/job-monitor'

const FCM_BATCH_SIZE = 500

function isPermanentFcmTokenError(
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
   * Cron job that runs hourly to check for devices with stale heartbeats
   * (>30 minutes) and send FCM push notifications to trigger heartbeat requests.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkAndTriggerStaleHeartbeats() {
    this.logger.log('Running cron job to check for stale heartbeats')

    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    try {
      // Find devices with stale heartbeats
      const devices = await this.deviceModel.find({
        heartbeatEnabled: true,
        enabled: true,
        $or: [
          { lastHeartbeat: null },
          { lastHeartbeat: { $lt: thirtyMinutesAgo } },
        ],
        fcmToken: { $exists: true, $ne: null },
        fcmTokenInvalidatedAt: { $exists: false },
      })

      if (devices.length === 0) {
        this.logger.log('No devices with stale heartbeats found')
        pingJob(MonitoredJob.heartbeatCheck)
        return
      }

      this.logger.log(
        `Found ${devices.length} device(s) with stale heartbeats, sending FCM notifications`,
      )

      // Send FCM messages to trigger heartbeats
      const fcmMessages: Message[] = []
      const deviceIds: string[] = []

      for (const device of devices) {
        if (!device.fcmToken) {
          continue
        }

        const fcmMessage: Message = {
          data: {
            type: 'heartbeat_check',
          },
          token: device.fcmToken,
          android: heartbeatAndroidConfig(),
        }

        fcmMessages.push(fcmMessage)
        deviceIds.push(device._id.toString())
      }

      if (fcmMessages.length === 0) {
        this.logger.warn('No valid FCM tokens found for devices with stale heartbeats')
        pingJob(MonitoredJob.heartbeatCheck)
        return
      }

      // Send FCM messages in batches (FCM allows max 500 per sendEach call)
      let totalSuccessCount = 0
      let totalFailureCount = 0

      for (let i = 0; i < fcmMessages.length; i += FCM_BATCH_SIZE) {
        const batch = fcmMessages.slice(i, i + FCM_BATCH_SIZE)
        const batchDeviceIds = deviceIds.slice(i, i + FCM_BATCH_SIZE)
        const response = await firebaseAdmin.messaging().sendEach(batch)

        totalSuccessCount += response.successCount
        totalFailureCount += response.failureCount

        if (response.failureCount > 0) {
          const invalidationUpdates: Array<{
            deviceId: string
            reason: string
          }> = []

          response.responses.forEach((resp, index) => {
            if (!resp.success) {
              const errorMessage = resp.error?.message || 'Unknown error'
              const errorCode = resp.error?.code || 'UNKNOWN_ERROR'

              this.logger.error(
                `Failed to send heartbeat check to device ${batchDeviceIds[index]}: ${errorMessage}`,
              )

              if (isPermanentFcmTokenError(resp.error)) {
                invalidationUpdates.push({
                  deviceId: batchDeviceIds[index],
                  reason: `${errorCode}: ${errorMessage}`,
                })
              }
            }
          })

          if (invalidationUpdates.length > 0) {
            const invalidatedAt = new Date()
            await this.deviceModel.bulkWrite(
              invalidationUpdates.map(({ deviceId, reason }) => ({
                updateOne: {
                  filter: { _id: new Types.ObjectId(deviceId) },
                  update: {
                    $set: {
                      fcmTokenInvalidatedAt: invalidatedAt,
                      fcmTokenInvalidReason: reason,
                    },
                  },
                },
              })),
            )

            this.logger.warn(
              `Marked ${invalidationUpdates.length} device(s) as FCM-token-invalid; heartbeat retries paused until token update`,
            )
          }
        }
      }

      this.logger.log(
        `Sent ${totalSuccessCount} heartbeat check FCM notification(s), ${totalFailureCount} failed`,
      )
      pingJob(MonitoredJob.heartbeatCheck)
    } catch (error) {
      this.logger.error('Error checking and triggering stale heartbeats', error)
    }
  }
}
