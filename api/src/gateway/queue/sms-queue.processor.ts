import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job } from 'bull'
import { Model } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import { Device } from '../schemas/device.schema'
import { SMS } from '../schemas/sms.schema'
import { UsersService } from '../../users/users.service'
import { WebhookService } from '../../webhook/webhook.service'
import { WebhookEvent } from '../../webhook/webhook-event.enum'
import { Logger } from '@nestjs/common'
import {
  FCM_SEND_SKIPPED_ERROR_CODE,
  shouldSkipFcmSend,
  skippedBatchResponse,
} from '../fcm-send-skip'
import { errorHistoryAppend, literalSetStage } from '../error-history'
import { SmsBatchStatusService } from '../sms-batch-status.service'
import {
  FCM_SEND_TIMEOUT_ERROR_CODE,
  FcmSendTimeoutError,
  withSendTimeout,
} from './send-timeout'
import { RECOVERY_MIN_VERSION_CODE } from '../device-config'
import {
  HANDED_BY_PUSH,
  PULL_PUSH_TTL_MS,
  PUSH_LEASE_MS,
  deviceCanClaim,
  deviceUsesPull,
  deviceVersionCode,
  newRunToken,
  pushOwnershipEnabled,
  pushWasRejected,
} from '../push-ownership'
import {
  isDispatchPacingEnabled,
  releaseDispatchUpdate,
  resolveSendDelaySeconds,
} from './dispatch-pacing'

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
  return `${rawPart}. ${FCM_ACTIONABLE_MESSAGE}`
}

// Push outcomes only apply to messages the phone has not reported on. A failed
// message is never pushed again, so a failed one here carries a phone report.
const AWAITING_PHONE = { status: { $in: ['pending', 'dispatched', 'unknown'] as const } }

// A delayed wave goes to the token the device holds now, not the one it held
// when the request was queued
function withCurrentToken(fcmMessages: any[], token?: string) {
  return token
    ? fcmMessages.map((message) => ({ ...message, token }))
    : fcmMessages
}

// Rows queued for a build that can claim, and the rest
const STAMPED_CLAIMABLE = {
  'metadata.appVersionCode': { $gte: RECOVERY_MIN_VERSION_CODE },
}
const NOT_STAMPED_CLAIMABLE = {
  $or: [
    { 'metadata.appVersionCode': { $lt: RECOVERY_MIN_VERSION_CODE } },
    { 'metadata.appVersionCode': { $exists: false } },
  ],
}

function smsIdOf(fcmMessage: any): string | null {
  try {
    const id = JSON.parse(fcmMessage.data.smsData).smsId
    return id ? String(id) : null
  } catch {
    return null
  }
}

const ADD_DISPATCH_ATTEMPT = {
  $set: { dispatchAttempts: { $add: [{ $ifNull: ['$dispatchAttempts', 0] }, 1] } },
}

@Processor('sms')
export class SmsQueueProcessor {
  private readonly logger = new Logger(SmsQueueProcessor.name)

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<Device>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    private webhookService: WebhookService,
    private usersService: UsersService,
    private batchStatus: SmsBatchStatusService,
  ) {}

  @Process({
    name: 'send-sms',
    concurrency: 10,
  })
  async handleSendSms(job: Job<any>) {
    // this.logger.debug(`Processing send-sms job ${job.id}`)
    const { deviceId, smsBatchId } = job.data
    let pushHandedOff = false

    const device = await this.deviceModel
      .findById(deviceId)
      .populate('user')
      .exec()
    if (!device?.user) {
      this.logger.warn(
        `Device or user not found for deviceId ${deviceId}, webhooks will be skipped`,
      )
    }
    let fcmMessages = withCurrentToken(job.data.fcmMessages, device?.fcmToken)
    const ownership = pushOwnershipEnabled()
    const canClaim = ownership && deviceCanClaim(device as any)
    let leasedSmsIds = new Set<string>()

    try {
      if (ownership) {
        const queuedCount = fcmMessages.length
        const taken = await this.takeRows(fcmMessages, device)
        fcmMessages = taken.fcmMessages
        leasedSmsIds = taken.leasedSmsIds
        // Rows another run or a claim already has are not pushed here
        await this.releaseDeviceBacklog(job, device, queuedCount - fcmMessages.length)
        if (fcmMessages.length === 0) {
          await this.batchStatus.refresh([smsBatchId])
          return { successCount: 0, failureCount: 0, responses: [] }
        }
      }

      const skipped = shouldSkipFcmSend(device?.user, deviceId)
      const response = skipped
        ? skippedBatchResponse(fcmMessages.length)
        : await withSendTimeout(firebaseAdmin.messaging().sendEach(fcmMessages))
      // The push is done. Anything that throws from here on is a persistence
      // problem, and must not mark handed-off messages as failed a second time.
      pushHandedOff = true
      // A withheld push never reaches the device either
      await this.releaseDeviceBacklog(
        job,
        device,
        skipped ? fcmMessages.length : response.failureCount,
      )

      // this.logger.debug(
      //   `SMS Job ${job.id}( smsBatchId: ${smsBatchId}) completed, success: ${response.successCount}, failures: ${response.failureCount}`,
      // )

      // Mark individual SMS records as failed when their FCM push failed
      const failedSmsIds: string[] = []
      const failedUpdates: Array<{
        smsId: string
        errorCode: string
        errorMessage: string
        // held: the phone may claim it. waiting: the push may still arrive.
        outcome: 'failed' | 'held' | 'waiting'
      }> = []
      for (let i = 0; i < response.responses.length; i++) {
        if (!response.responses[i].success) {
          try {
            const smsData = JSON.parse(fcmMessages[i].data.smsData)
            const fcmError = response.responses[i].error
            failedSmsIds.push(String(smsData.smsId))
            const rejected = pushWasRejected(fcmError)
            failedUpdates.push({
              smsId: String(smsData.smsId),
              errorCode: getFcmErrorCode(fcmError ?? undefined),
              errorMessage: getFcmErrorMessage(fcmError ?? undefined),
              outcome:
                canClaim && rejected
                  ? 'held'
                  : !rejected && leasedSmsIds.has(String(smsData.smsId))
                    ? 'waiting'
                    : 'failed',
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
      const dispatchedUpdates: Array<{
        smsId: string
        fcmMessageId?: string
      }> = []
      for (let i = 0; i < response.responses.length; i++) {
        if (response.responses[i].success) {
          try {
            const smsData = JSON.parse(fcmMessages[i].data.smsData)
            const messageId = response.responses[i].messageId
            dispatchedSmsIds.push(String(smsData.smsId))
            dispatchedUpdates.push({
              smsId: String(smsData.smsId),
              // The skip path fakes a response, so its sentinel is not an id
              ...(messageId &&
                messageId !== FCM_SEND_SKIPPED_ERROR_CODE && {
                  fcmMessageId: messageId,
                }),
            })
          } catch (parseError) {
            this.logger.error(
              `Failed to mark SMS as dispatched for FCM message index ${i}`,
              parseError,
            )
          }
        }
      }

      // One write per message: each row carries its own FCM message id and
      // its own failure entry
      const failedAt = new Date()
      const writes = [
        ...failedUpdates
          .filter((failedUpdate) => failedUpdate.outcome !== 'failed')
          .map((failedUpdate) => ({
            updateOne: {
              filter: {
                _id: failedUpdate.smsId as any,
                ...AWAITING_PHONE,
                ...STAMPED_CLAIMABLE,
              },
              update: this.keepForClaim(failedUpdate, failedAt),
            },
          })),
        ...failedUpdates
          .filter((failedUpdate) => failedUpdate.outcome !== 'waiting')
          .map((failedUpdate) => ({
          updateOne: {
            filter: {
              _id: failedUpdate.smsId as any,
              ...AWAITING_PHONE,
              ...(failedUpdate.outcome === 'held' && NOT_STAMPED_CLAIMABLE),
            },
            // A pipeline, so the trail keeps its first and newest entries
            update: [
              literalSetStage({
                status: 'failed',
                failedAt,
                errorCode: failedUpdate.errorCode,
                errorMessage: failedUpdate.errorMessage,
              }),
              ADD_DISPATCH_ATTEMPT,
              errorHistoryAppend(
                {
                  code: failedUpdate.errorCode,
                  message: failedUpdate.errorMessage,
                  source: 'push',
                },
                failedAt,
              ),
            ].filter(Boolean),
          },
        })),
        ...dispatchedUpdates.map((dispatchedUpdate) => ({
          updateOne: {
            // The phone may report before this write lands
            filter: { _id: dispatchedUpdate.smsId as any, ...AWAITING_PHONE },
            update: {
              // Only the timeout note can be here; a new push replaces it
              $unset: { errorMessage: '' },
              $set: {
                status: 'dispatched',
                dispatchedAt: now,
                ...(skipped && { errorCode: FCM_SEND_SKIPPED_ERROR_CODE }),
                ...(ownership && !skipped && { 'metadata.transport': 'fcm' }),
                ...(dispatchedUpdate.fcmMessageId && {
                  'metadata.fcmMessageId': dispatchedUpdate.fcmMessageId,
                }),
              },
              $inc: { dispatchAttempts: 1 },
            },
          },
        })),
      ]

      if (writes.length > 0) {
        await this.smsModel.bulkWrite(writes as any, { ordered: false })
      }

      if (device?.user && failedSmsIds.length > 0) {
        // Only the rows this failure actually changed
        const failedSmsDocuments = await this.smsModel.find({
          _id: { $in: failedSmsIds },
          status: 'failed',
          failedAt,
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

      // device was loaded before the increment, so zero means this job carried
      // the account's first message.
      if (device?.user && device.sentSMSCount === 0 && response.successCount > 0) {
        this.usersService
          .markMilestone((device.user as any)?._id ?? device.user, 'firstSmsAt')
          .catch(() => undefined)
      }

      await this.batchStatus.refresh([smsBatchId])

      return response
    } catch (error) {
      this.logger.error(`Failed to process SMS job ${job.id}`, error)

      // Only the handoff itself gets the blanket failure. After it, the
      // per-message outcome is already written and a storage error here would
      // otherwise overwrite dispatched rows and double-count attempts.
      if (pushHandedOff) {
        await this.batchStatus.refresh([smsBatchId])
        throw error
      }

      // A timed out push may still have landed, so its time stays reserved
      if (!(error instanceof FcmSendTimeoutError)) {
        await this.releaseDeviceBacklog(job, device, fcmMessages.length)
      }

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

      const failedAt = new Date()
      if (failedSmsIds.length > 0) {
        const timedOut = error instanceof FcmSendTimeoutError
        const errorCode = timedOut
          ? FCM_SEND_TIMEOUT_ERROR_CODE
          : (error as any)?.code != null
            ? getFcmErrorCode(error as any)
            : 'FCM_SEND_ERROR'
        // A timeout says nothing about the token, so it skips the resync advice
        const errorMessage = timedOut
          ? `${FCM_SEND_TIMEOUT_ERROR_CODE}: ${error.message}`
          : getFcmErrorMessage(error as any)
        const rejected = !timedOut && pushWasRejected(error as any)
        // A rejected push never reached the phone, so a phone that can claim
        // gets the message that way. An unclear outcome on a short-lived push
        // waits for the claim too.
        const keptIds =
          canClaim && rejected
            ? failedSmsIds
            : rejected
              ? []
              : failedSmsIds.filter((id) => leasedSmsIds.has(id))
        if (keptIds.length > 0) {
          await this.smsModel.updateMany(
            { _id: { $in: keptIds } as any, ...AWAITING_PHONE, ...STAMPED_CLAIMABLE },
            this.keepForClaim(
              { errorCode, errorMessage, outcome: rejected ? 'held' : 'waiting' },
              failedAt,
            ),
            { updatePipeline: true },
          )
        }
        const keptIdSet = new Set(keptIds)
        // The push may still have landed, so a phone report is not overwritten
        await this.smsModel.updateMany(
          {
            _id: {
              $in: rejected
                ? failedSmsIds
                : failedSmsIds.filter((id) => !keptIdSet.has(id)),
            } as any,
            ...AWAITING_PHONE,
            ...(keptIds.length > 0 && rejected && NOT_STAMPED_CLAIMABLE),
          },
          [
            literalSetStage({ status: 'failed', failedAt, errorCode, errorMessage }),
            ADD_DISPATCH_ATTEMPT,
            errorHistoryAppend(
              { code: errorCode, message: errorMessage, source: 'push' },
              failedAt,
            ),
          ].filter(Boolean),
          { updatePipeline: true },
        )
      }

      if (device?.user && failedSmsIds.length > 0) {
        // Only the rows this failure actually changed
        const failedSmsDocuments = await this.smsModel.find({
          _id: { $in: failedSmsIds },
          status: 'failed',
          failedAt,
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

      await this.batchStatus.refresh([smsBatchId])

      throw error
    }
  }

  // Marks the rows this run will push. A run that repeats finds them marked
  // and pushes nothing. Rows for a claiming build get a short-lived push and
  // the time from which the phone may claim them.
  private async takeRows(
    fcmMessages: any[],
    device: any,
  ): Promise<{ fcmMessages: any[]; leasedSmsIds: Set<string> }> {
    const now = new Date()
    const ids = fcmMessages.map(smsIdOf).filter(Boolean) as string[]
    const token = newRunToken()
    await this.smsModel.updateMany(
      {
        _id: { $in: ids } as any,
        status: { $in: ['pending', 'unknown'] },
        'metadata.pushJob': { $exists: false },
      },
      {
        $set: {
          'metadata.pushJob': token,
          'metadata.handedTo': device?.installId || HANDED_BY_PUSH,
        },
      },
    )
    const won = await this.smsModel
      .find({ _id: { $in: ids } as any, 'metadata.pushJob': token })
      .select('_id metadata.appVersionCode')
      .lean()

    // The phone now runs a build that cannot claim, so these rows never can be
    const versionCode = deviceVersionCode(device)
    if (versionCode > 0 && versionCode < RECOVERY_MIN_VERSION_CODE) {
      await this.smsModel.updateMany(
        { 'metadata.pushJob': token, _id: { $in: ids } as any, ...STAMPED_CLAIMABLE },
        { $set: { 'metadata.appVersionCode': versionCode } },
      )
    }

    const wonIds = new Set(won.map((row) => String(row._id)))
    const leasedSmsIds = new Set<string>()
    if (deviceUsesPull(device, now)) {
      for (const row of won) {
        if ((row as any).metadata?.appVersionCode >= RECOVERY_MIN_VERSION_CODE) {
          leasedSmsIds.add(String(row._id))
        }
      }
      if (leasedSmsIds.size > 0) {
        await this.smsModel.updateMany(
          { _id: { $in: [...leasedSmsIds] } as any, 'metadata.pushJob': token },
          { $set: { 'metadata.claimableAt': new Date(now.getTime() + PUSH_LEASE_MS) } },
        )
      }
    }

    return {
      leasedSmsIds,
      fcmMessages: fcmMessages
        .filter((message) => wonIds.has(smsIdOf(message) ?? ''))
        .map((message) =>
          leasedSmsIds.has(smsIdOf(message) ?? '')
            ? { ...message, android: { ...message.android, ttl: PULL_PUSH_TTL_MS } }
            : message,
        ),
    }
  }

  // Leaves the row waiting instead of failed. A rejected push was never
  // handed to the phone, so the phone may claim it at once.
  private keepForClaim(
    failure: { errorCode: string; errorMessage: string; outcome: string },
    at: Date,
  ): any[] {
    return [
      ...(failure.outcome === 'held'
        ? [
            literalSetStage({ 'metadata.claimableAt': at }),
            { $unset: ['metadata.handedTo'] },
          ]
        : []),
      ADD_DISPATCH_ATTEMPT,
      errorHistoryAppend(
        { code: failure.errorCode, message: failure.errorMessage, source: 'push' },
        at,
      ),
    ].filter(Boolean)
  }

  // Messages whose push failed never reach the device, so their planned send
  // time comes off the device backlog
  private async releaseDeviceBacklog(
    job: Job<any>,
    device: { smsSendDelaySeconds?: number } | null,
    failedCount: number,
  ): Promise<void> {
    if (!job.data.inDeviceBacklog || failedCount <= 0 || !isDispatchPacingEnabled()) {
      return
    }
    try {
      const now = new Date()
      // The time reserved per message, or the device's delay for older jobs
      const delayMs =
        Number(job.data.backlogDelayMs) > 0
          ? Number(job.data.backlogDelayMs)
          : resolveSendDelaySeconds(device?.smsSendDelaySeconds) * 1000
      await this.deviceModel.updateOne(
        { _id: job.data.deviceId, dispatchBusyUntil: { $gt: now } },
        releaseDispatchUpdate(now, failedCount * delayMs),
        { updatePipeline: true, timestamps: false },
      )
    } catch (error) {
      this.logger.warn(
        `Failed to release device backlog for job ${job.id}`,
        error?.message,
      )
    }
  }
}
