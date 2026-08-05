import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job } from 'bull'
import { Model } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import { Device } from '../schemas/device.schema'
import { SMS } from '../schemas/sms.schema'
import { SMSBatch } from '../schemas/sms-batch.schema'
import { WebhookService } from 'src/webhook/webhook.service'
import { WebhookEvent } from 'src/webhook/webhook-event.enum'
import { Logger } from '@nestjs/common'

function getFcmErrorCode(error: { code?: string; message?: string } | null): string {
  if (!error?.code) return 'FCM_DELIVERY_FAILED'
  const code = String(error.code).toLowerCase().replace(/^messaging\//, '')
  if (
    code === 'registration-token-not-registered' ||
    code === 'unregistered'
  ) {
    return 'FCM_TOKEN_NOT_REGISTERED'
  }
  if (
    code === 'invalid-registration-token' ||
    code === 'invalid-argument'
  ) {
    return 'FCM_INVALID_REGISTRATION_TOKEN'
  }
  if (code === 'mismatched-credential') {
    return 'FCM_PROJECT_MISMATCH'
  }
  return `FCM_DELIVERY_FAILED_${error.code}`
}

const FCM_ACTIONABLE_MESSAGE =
  'The device token is invalid. Please open the textbee mobile app, click on the update button to resync and try again.'

function getFcmErrorMessage(error: { code?: string; message?: string } | null | undefined): string {
  const rawPart = `FCM_DELIVERY_FAILED: ${error?.message || 'FCM delivery failed'}`
  return `${rawPart} — ${FCM_ACTIONABLE_MESSAGE}`
}

@Processor('sms')
export class SmsQueueProcessor {
  private readonly logger = new Logger(SmsQueueProcessor.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<Device>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    private webhookService: WebhookService,
  ) {}

  @Process({
    name: 'send-sms',
    concurrency: 10,
  })
  async handleSendSms(job: Job<any>) {
    // this.logger.debug(`Processing send-sms job ${job.id}`)
    const { deviceId, fcmMessages, smsBatchId } = job.data

    const device = await this.deviceModel
      .findById(deviceId)
      .populate('user')
      .exec()
    if (!device?.user) {
      this.logger.warn(
        `Device or user not found for deviceId ${deviceId}, webhooks will be skipped`,
      )
    }

    try {
      await this.smsBatchModel
        .findByIdAndUpdate(smsBatchId, {
          $set: { status: 'processing' },
        })
        .exec()

      const response = await firebaseAdmin.messaging().sendEach(fcmMessages)

      // this.logger.debug(
      //   `SMS Job ${job.id}( smsBatchId: ${smsBatchId}) completed, success: ${response.successCount}, failures: ${response.failureCount}`,
      // )

      // Mark individual SMS records as failed when their FCM push failed
      const failedSmsIds: string[] = []
      const failedUpdates: Array<{
        smsId: string
        errorCode: string
        errorMessage: string
      }> = []
      for (let i = 0; i < response.responses.length; i++) {
        if (!response.responses[i].success) {
          try {
            const smsData = JSON.parse(fcmMessages[i].data.smsData)
            const fcmError = response.responses[i].error
            failedSmsIds.push(String(smsData.smsId))
            failedUpdates.push({
              smsId: String(smsData.smsId),
              errorCode: getFcmErrorCode(fcmError ?? undefined),
              errorMessage: getFcmErrorMessage(fcmError ?? undefined),
            })
          } catch (parseError) {
            this.logger.error(
              `Failed to mark SMS as failed for FCM message index ${i}`,
              parseError,
            )
          }
        }
      }

      // Mark individual SMS records as dispatched when FCM push succeeded
      const now = new Date()
      const dispatchedSmsIds: string[] = []
      for (let i = 0; i < response.responses.length; i++) {
        if (response.responses[i].success) {
          try {
            const smsData = JSON.parse(fcmMessages[i].data.smsData)
            dispatchedSmsIds.push(String(smsData.smsId))
          } catch (parseError) {
            this.logger.error(
              `Failed to mark SMS as dispatched for FCM message index ${i}`,
              parseError,
            )
          }
        }
      }

      if (failedUpdates.length > 0) {
        const failedAt = new Date()
        for (const failedUpdate of failedUpdates) {
          await this.smsModel.updateOne(
            { _id: failedUpdate.smsId as any },
            {
              $set: {
                status: 'failed',
                failedAt,
                errorCode: failedUpdate.errorCode,
                errorMessage: failedUpdate.errorMessage,
              },
            },
          )
        }
      }

      if (dispatchedSmsIds.length > 0) {
        await this.smsModel.updateMany(
          { _id: { $in: dispatchedSmsIds } as any },
          {
            $set: { status: 'dispatched', dispatchedAt: now },
          },
        )
      }

      if (device?.user && failedSmsIds.length > 0) {
        const failedSmsDocuments = await this.smsModel.find({
          _id: { $in: failedSmsIds },
        })
        for (const failedSms of failedSmsDocuments) {
          await this.webhookService
            .deliverNotification({
              sms: failedSms,
              user: device.user as any,
              event: WebhookEvent.MESSAGE_FAILED,
            })
            .catch((e) =>
              this.logger.warn(
                `Webhook delivery failed for SMS ${failedSms._id}`,
                e?.message,
              ),
            )
        }
      }

      // Update device SMS count
      await this.deviceModel
        .findByIdAndUpdate(deviceId, {
          $inc: { sentSMSCount: response.successCount },
        })
        .exec()

      // Update batch status
      const smsBatch = await this.smsBatchModel.findByIdAndUpdate(
        smsBatchId,
        {
          $inc: {
            successCount: response.successCount,
            failureCount: response.failureCount,
          },
        },
        { returnDocument: 'after' },
      )

      const batchStatus =
        smsBatch.failureCount === smsBatch.recipientCount
          ? 'failed'
          : smsBatch.successCount === smsBatch.recipientCount
            ? 'completed'
            : 'partial_success'
      await this.smsBatchModel.findByIdAndUpdate(smsBatchId, {
        $set: { status: batchStatus },
      })

      return response
    } catch (error) {
      this.logger.error(`Failed to process SMS job ${job.id}`, error)

      // Mark all individual SMS in this batch of FCM messages as failed
      const failedSmsIds: string[] = []
      for (const fcmMessage of fcmMessages) {
        try {
          const smsData = JSON.parse(fcmMessage.data.smsData)
          failedSmsIds.push(String(smsData.smsId))
        } catch (parseError) {
          this.logger.error(
            'Failed to mark SMS as failed after FCM error',
            parseError,
          )
        }
      }

      if (failedSmsIds.length > 0) {
        const failedAt = new Date()
        await this.smsModel.updateMany(
          { _id: { $in: failedSmsIds } as any },
          {
            $set: {
              status: 'failed',
              failedAt,
              errorCode:
                (error as any)?.code != null
                  ? getFcmErrorCode(error as any)
                  : 'FCM_SEND_ERROR',
              errorMessage: getFcmErrorMessage(error as any),
            },
          },
        )
      }

      if (device?.user && failedSmsIds.length > 0) {
        const failedSmsDocuments = await this.smsModel.find({
          _id: { $in: failedSmsIds },
        })
        for (const failedSms of failedSmsDocuments) {
          await this.webhookService
            .deliverNotification({
              sms: failedSms,
              user: device.user as any,
              event: WebhookEvent.MESSAGE_FAILED,
            })
            .catch((e) =>
              this.logger.warn(
                `Webhook delivery failed for SMS ${failedSms._id}`,
                e?.message,
              ),
            )
        }
      }

      const smsBatch = await this.smsBatchModel.findByIdAndUpdate(
        smsBatchId,
        {
          $inc: {
            failureCount: fcmMessages.length,
          },
        },
        { returnDocument: 'after' },
      )

      const newStatus =
        smsBatch.failureCount === smsBatch.recipientCount
          ? 'failed'
          : 'partial_success'

      await this.smsBatchModel.findByIdAndUpdate(smsBatchId, {
        $set: { status: newStatus },
      })

      throw error
    }
  }
}
