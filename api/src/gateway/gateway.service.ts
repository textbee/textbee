import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Device, DeviceDocument } from './schemas/device.schema'
import { Model, Types } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import { DeviceTombstone, DeviceTombstoneDocument } from './schemas/device-tombstone.schema'
import {
  ReceivedSMSDTO,
  RegisterDeviceInputDTO,
  RetrieveSMSDTO,
  SendBulkSMSInputDTO,
  SendSMSInputDTO,
  UpdateSMSStatusDTO,
  HeartbeatInputDTO,
  HeartbeatResponseDTO,
} from './gateway.dto'
import { User } from '../users/schemas/user.schema'
import { AuthService } from '../auth/auth.service'
import { SMS } from './schemas/sms.schema'
import { SMSType } from './sms-type.enum'
import { SMSBatch } from './schemas/sms-batch.schema'
import { BatchResponse, Message } from 'firebase-admin/messaging'
import { WebhookEvent } from '../webhook/webhook-event.enum'
import { WebhookService } from '../webhook/webhook.service'
import { BillingService } from '../billing/billing.service'
import { UsersService } from '../users/users.service'
import { UserRollupService } from '../users/user-rollup.service'
import { SmsQueueService } from './queue/sms-queue.service'
import { escapeRegExp } from '../common/escape-regexp'
import { normalizeOsFields } from './os-version'
import { encodeCursor } from './cursor'
import {
  isMalformedReceivedSms,
  isTooLateForWebhook,
  lateArrivalTimestamps,
  receivedSmsIgnoreReason,
  resolveReceivedAt,
} from './received-sms-input'
import { appVersionMetadata } from './app-version-metadata'
import { RECOVERY_MIN_VERSION_CODE, deviceConfigFor } from './device-config'
import {
  CLAIM_LIMIT,
  POLL_COOLDOWN_MS,
  pendingRecoveryFilter,
  toRecoveryPayload,
} from './pending-recovery'
import { errorHistoryPush } from './error-history'
import {
  loadSmsPermissionStatus,
  reportsSmsPermissionOff,
} from './sms-permission-status'
import {
  resolveReportAttempt,
  resolveReportedAt,
} from './status-report-input'
import { toDirection, toStoredType } from './message-direction'
import { ParsedMessageQuery } from './message-query'
import { smsAndroidConfig } from './fcm-push-options'
import {
  FCM_SEND_SKIPPED_ERROR_CODE,
  shouldSkipFcmSend,
  skippedBatchResponse,
} from './fcm-send-skip'
import { DispatchPlan } from './queue/dispatch-pacing'
import { Job } from 'bull'

// device.user is a ref, so it is an ObjectId unless the query populated it.
function userIdOf(user: any) {
  return user?._id ?? user
}

@Injectable()
export class GatewayService {
  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(DeviceTombstone.name)
    private deviceTombstoneModel: Model<DeviceTombstoneDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    private authService: AuthService,
    private webhookService: WebhookService,
    private billingService: BillingService,
    private smsQueueService: SmsQueueService,
    private usersService: UsersService,
    private readonly userRollup: UserRollupService,
  ) {}

  // Blocks creating or re-enabling a device when the user's plan device limit
  // is reached. Effective limit comes from the subscription override or the
  // plan (deviceLimit of -1 or missing means unlimited). Only enabled devices
  // count toward the limit. Fails open if the limit lookup itself errors.
  private async assertDeviceLimitNotReached(
    userId: Types.ObjectId | string,
    { excludeDeviceId }: { excludeDeviceId?: Types.ObjectId | string } = {},
  ): Promise<void> {
    let deviceLimit: number
    try {
      const limits = await this.billingService.getUserLimits(
        userId?.toString(),
      )
      deviceLimit = limits?.deviceLimit ?? -1
    } catch (error) {
      console.error('assertDeviceLimitNotReached: failed to load limits', error)
      return
    }

    if (deviceLimit == null || deviceLimit === -1) {
      return
    }

    const filter: any = { user: userId, enabled: true }
    if (excludeDeviceId) {
      filter._id = { $ne: excludeDeviceId }
    }
    const activeDeviceCount = await this.deviceModel.countDocuments(filter)

    if (activeDeviceCount >= deviceLimit) {
      this.billingService
        .notifyDeviceLimitReached(userId, deviceLimit, activeDeviceCount)
        .catch((error) => {
          console.error('failed to send device limit notification', error)
        })

      throw new HttpException(
        {
          message: `Active device limit reached: your plan allows up to ${deviceLimit} active device(s) and you have ${activeDeviceCount}. Disable or delete another device, or upgrade your plan at https://textbee.dev/pricing`,
          hasReachedLimit: true,
          deviceLimit,
          activeDeviceCount,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  async registerDevice(
    input: RegisterDeviceInputDTO,
    user: User,
  ): Promise<any> {
    // Mongoose 9.6's strict types collide on the reserved `model` field name
    // (it expects Mongoose's `Model<any>` shape, not the device's `model`
    // schema field). Cast the filter to bypass the type check; runtime
    // behavior is unchanged.
    const deviceFilter = {
      user: user._id,
      model: input.model,
      buildId: input.buildId,
    } as any
    const device = await this.deviceModel.findOne(deviceFilter)

    const now = new Date()
    const deviceData: any = { ...input, user }
    // set-default is the only writer; there is no ValidationPipe to strip it
    delete deviceData.isDefault
    // older builds serialize an unset versionCode as 0
    if (!deviceData.appVersionCode) delete deviceData.appVersionCode
    // normalizeOsFields owns these; raw OS metadata must never reach the display fields
    delete deviceData.os
    delete deviceData.osVersion
    delete deviceData.osApiLevel
    delete deviceData.osBuildFingerprint
    delete deviceData.osVersionSource
    Object.assign(
      deviceData,
      normalizeOsFields(input, device?.osVersionSource, device?.osVersion),
    )

    // Set default name to "brand model" if not provided
    if (!deviceData.name && input.brand && input.model) {
      deviceData.name = `${input.brand} ${input.model}`
    }

    // Handle simInfo if provided
    if (input.simInfo) {
      deviceData.simInfo = {
        ...input.simInfo,
        lastUpdated: input.simInfo.lastUpdated || now,
      }
    }

    if (input.fcmToken) {
      deviceData.fcmTokenUpdatedAt = now
      deviceData.fcmTokenInvalidatedAt = undefined
      deviceData.fcmTokenInvalidReason = undefined
    }

    if (device && device.appVersionCode <= 11) {
      // re-enable path: updateDevice enforces the device limit on the
      // disabled -> enabled transition
      return await this.updateDevice(device._id.toString(), {
        ...deviceData,
        enabled: true,
      })
    } else {
      await this.assertDeviceLimitNotReached(user._id)
      deviceData.enabled = input.enabled ?? true

      const existingDeviceCount = await this.deviceModel.countDocuments({
        user: user._id,
      })
      if (existingDeviceCount === 0) {
        deviceData.isDefault = true
      }

      const createdDevice = await this.deviceModel.create(deviceData)

      // The app re-registers on every launch, so this has to be idempotent.
      // markMilestone's $exists filter makes it a no-op after the first time.
      this.usersService
        .markMilestone(user._id, 'firstDeviceAt')
        .catch(() => undefined)

      // Keeps device-based notification targeting current without waiting for
      // the nightly sweep. Not awaited, like the milestone above, and it never
      // rejects, so it can neither slow nor fail a registration.
      this.userRollup.refreshQuietly(user._id)

      return createdDevice
    }
  }

  async getDevicesForUser(user: User): Promise<any> {
    // Exclude the push credential and hardware serial from the client response.
    return await this.deviceModel.find(
      { user: user._id },
      '-fcmToken -serial',
    )
  }

  async getDeviceById(
    deviceId: string,
    userId?: string,
    projection?: string,
  ): Promise<any> {
    if (userId) {
      // Explicit casts so the scoped lookup never depends on schema-level
      // string casting.
      return await this.deviceModel.findOne(
        {
          _id: new Types.ObjectId(deviceId),
          user: new Types.ObjectId(userId),
        },
        projection,
      )
    }
    return await this.deviceModel.findById(deviceId, projection)
  }

  // Picks the device a deviceless send should go out from. An explicit id is
  // authorized here because the route has no :id param for CanModifyDevice.
  async resolveSenderDevice(user: User, deviceId?: string): Promise<any> {
    // An empty or malformed id must 400, not silently fall back to another device
    if (deviceId != null) {
      if (!Types.ObjectId.isValid(deviceId)) {
        throw new HttpException(
          { error: 'Invalid device id' },
          HttpStatus.BAD_REQUEST,
        )
      }

      const device = await this.deviceModel.findOne({
        _id: new Types.ObjectId(deviceId),
        user: user._id,
      })

      if (!device) {
        throw new HttpException(
          { error: 'Device not found' },
          HttpStatus.NOT_FOUND,
        )
      }

      // sendSMS reports a disabled device
      return device
    }

    const defaultDevice = await this.deviceModel.findOne({
      user: user._id,
      isDefault: true,
      enabled: true,
    })

    if (defaultDevice) {
      return defaultDevice
    }

    // BSON orders null/missing below dates, so never-heartbeated devices rank last
    const lastActiveDevice = await this.deviceModel
      .findOne({ user: user._id, enabled: true })
      .sort({ lastHeartbeat: -1, _id: -1 })

    if (lastActiveDevice) {
      return lastActiveDevice
    }

    throw new HttpException(
      {
        success: false,
        error: 'No enabled device found. Enable a device or pass a deviceId.',
      },
      HttpStatus.BAD_REQUEST,
    )
  }

  async setDefaultDevice(deviceId: string): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    await this.deviceModel.updateMany(
      { user: device.user, _id: { $ne: device._id }, isDefault: true },
      { $set: { isDefault: false } },
    )

    return await this.deviceModel.findByIdAndUpdate(
      deviceId,
      { $set: { isDefault: true } },
      { new: true },
    )
  }

  async updateDevice(
    deviceId: string,
    input: RegisterDeviceInputDTO,
  ): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    // A partial update that omits enabled must not flip a disabled device on
    if (input.enabled === undefined) delete input.enabled

    // enforce the device limit only on the disabled -> enabled transition so
    // routine updates of already-enabled devices are never blocked
    if (!device.enabled && input.enabled) {
      await this.assertDeviceLimitNotReached(device.user as Types.ObjectId, {
        excludeDeviceId: device._id,
      })
    }

    const now = new Date()
    const updateData: any = { ...input }
    // set-default is the only writer; there is no ValidationPipe to strip it
    delete updateData.isDefault
    // older builds serialize an unset versionCode as 0
    if (!updateData.appVersionCode) delete updateData.appVersionCode
    // normalizeOsFields owns these; raw OS metadata must never reach the display fields
    delete updateData.os
    delete updateData.osVersion
    delete updateData.osApiLevel
    delete updateData.osBuildFingerprint
    delete updateData.osVersionSource
    Object.assign(
      updateData,
      normalizeOsFields(input, device.osVersionSource, device.osVersion),
    )

    // Handle simInfo if provided
    if (input.simInfo) {
      updateData.simInfo = {
        ...input.simInfo,
        lastUpdated: input.simInfo.lastUpdated || now,
      }
    }

    if (input.fcmToken && input.fcmToken !== device.fcmToken) {
      updateData.fcmTokenUpdatedAt = now
    }

    // Re-registration is the other path that can move the reported build, and
    // the rollup carries the oldest build on the account, which decides whether
    // an update prompt is shown.
    const appVersionChanged =
      updateData.appVersionCode !== undefined &&
      updateData.appVersionCode !== device.appVersionCode

    const updated = await this.deviceModel.findByIdAndUpdate(
      deviceId,
      this.tokenUpdate(device, input.fcmToken, updateData),
      { new: true },
    )

    if (appVersionChanged) {
      this.userRollup.refreshQuietly(device.user as any)
    }

    return updated
  }

  // Mongoose drops undefined keys from $set, so clearing an invalidation
  // needs $unset. Any reported token clears it, changed or not.
  private tokenUpdate(
    device: { fcmTokenInvalidatedAt?: Date },
    fcmToken: string | undefined,
    updateData: Record<string, unknown>,
  ) {
    const update: Record<string, unknown> = { $set: updateData }
    if (fcmToken && device.fcmTokenInvalidatedAt) {
      update.$unset = { fcmTokenInvalidatedAt: 1, fcmTokenInvalidReason: 1 }
    }
    return update
  }

  async deleteDevice(deviceId: string): Promise<any> {
    const device = await this.deviceModel.findById(deviceId).lean()

    if (!device) {
      throw new HttpException(
        {
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    const id = new Types.ObjectId(deviceId)
    const written = await this.deviceTombstoneModel.updateOne(
      { deviceId: id },
      {
        $setOnInsert: {
          deviceId: id,
          userId: device.user,
          deletedAt: new Date(),
          device,
        },
      },
      { upsert: true },
    )

    try {
      await this.deviceModel.findByIdAndDelete(deviceId)
    } catch (error) {
      // The record must not outlive a delete that did not happen, or the
      // device reads as gone while it is still live. Only a record this call
      // created is taken back, and only while the device is still there: an
      // error raised after the delete landed leaves the record alone, since
      // that is the only copy of the device left.
      if (written.upsertedCount && (await this.deviceModel.exists({ _id: id }))) {
        await this.deviceTombstoneModel.deleteOne({ deviceId: id })
      }
      throw error
    }

    this.userRollup.refreshQuietly(device.user as any)

    return { success: true }
  }

  private calculateDelayFromScheduledAt(scheduledAt?: string): number | undefined {
    if (!scheduledAt) {
      return undefined
    }

    try {
      const scheduledDate = new Date(scheduledAt)
      
      // Check if date is valid
      if (isNaN(scheduledDate.getTime())) {
        throw new HttpException(
          {
            success: false,
            error: 'Invalid scheduledAt format. Must be a valid ISO 8601 date string.',
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      const now = Date.now()
      const scheduledTime = scheduledDate.getTime()
      const delayMs = scheduledTime - now

      // Reject past dates
      if (delayMs < 0) {
        throw new HttpException(
          {
            success: false,
            error: 'scheduledAt must be a future date',
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      return delayMs
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw new HttpException(
        {
          success: false,
          error: 'Invalid scheduledAt format. Must be a valid ISO 8601 date string.',
        },
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  // Records when each paced wave is due so the stale-status cron leaves
  // messages alone while they legitimately wait in the queue.
  private async stampDispatchDueAt(
    smsIds: Types.ObjectId[],
    plan: DispatchPlan,
    now: number,
  ): Promise<void> {
    const paced = plan.waves.length > 1 || plan.waves[0]?.delayMs > 0
    if (!paced || smsIds.length === 0) {
      return
    }
    await this.smsModel.bulkWrite(
      plan.waves.map((wave) => ({
        updateMany: {
          filter: { _id: { $in: smsIds.slice(wave.start, wave.end) } },
          update: { $set: { dispatchDueAt: new Date(now + wave.delayMs) } },
        },
      })),
      { ordered: false },
    )
  }

  async sendSMS(deviceId: string, smsData: SendSMSInputDTO): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device?.enabled) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist or is not enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const message = smsData.message || smsData.smsBody
    const recipients = smsData.recipients || smsData.receivers

    if (!message) {
      throw new HttpException(
        {
          success: false,
          error: 'Message cannot be blank',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new HttpException(
        {
          success: false,
          error: 'Invalid recipients',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Calculate delay from scheduledAt if provided
    const delayMs = this.calculateDelayFromScheduledAt(smsData.scheduledAt)

    // Validate that scheduling requires queue to be enabled
    if (delayMs !== undefined && !this.smsQueueService.isQueueEnabled()) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS scheduling requires queue to be enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.billingService.canPerformAction(
      device.user.toString(),
      'send_sms',
      recipients.length,
    )

    // TODO: Implement a queue to send the SMS if recipients are too many

    const warning = reportsSmsPermissionOff(device, new Date())
      ? {
          code: 'SMS_PERMISSION_MISSING',
          message:
            'The textbee app on this phone last reported the SMS permission as off. The message fails if it is still off.',
        }
      : undefined

    let smsBatch: SMSBatch

    try {
      smsBatch = await this.smsBatchModel.create({
        user: device.user,
        device: device._id,
        message,
        recipientCount: recipients.length,
        recipientPreview: this.getRecipientsPreview(recipients),
        status: 'pending',
      })
    } catch (e) {
      throw new HttpException(
        {
          success: false,
          error: 'Failed to create SMS batch',
          additionalInfo: e,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const fcmMessages: Message[] = []
    const smsIds: Types.ObjectId[] = []

    for (let recipient of recipients) {
      recipient = recipient.replace(/\s+/g, "")
      const sms = await this.smsModel.create({
        user: device.user,
        device: device._id,
        smsBatch: smsBatch._id,
        message: message,
        type: SMSType.SENT,
        recipient,
        requestedAt: new Date(),
        status: 'pending',
        ...(smsData.simSubscriptionId !== undefined && {
          simSubscriptionId: smsData.simSubscriptionId,
        }),
        // The build the device was on when queued; the status report replaces it
        metadata: appVersionMetadata(device),
      })
      const updatedSMSData = {
        smsId: sms._id,
        smsBatchId: smsBatch._id,
        message,
        recipients: [recipient],
        ...(smsData.simSubscriptionId !== undefined && {
          simSubscriptionId: smsData.simSubscriptionId,
        }),

        // Legacy fields to be removed in the future
        smsBody: message,
        receivers: [recipient],
      }
      const stringifiedSMSData = JSON.stringify(updatedSMSData)

      const fcmMessage: Message = {
        data: {
          smsData: stringifiedSMSData,
        },
        token: device.fcmToken,
        android: smsAndroidConfig(smsData.scheduledAt),
      }
      fcmMessages.push(fcmMessage)
      smsIds.push(sms._id)
    }

    // Check if we should use the queue
    if (this.smsQueueService.isQueueEnabled()) {
      try {
        // Update batch status to processing
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'processing' },
        })

        // Persist the wave plan first so a write failure leaves no live jobs
        const queuedAt = Date.now()
        const plan = this.smsQueueService.planSendSmsJob(
          fcmMessages.length,
          delayMs,
          device.smsSendDelaySeconds,
        )
        await this.stampDispatchDueAt(smsIds, plan, queuedAt)
        await this.smsQueueService.addSendSmsJob(
          deviceId,
          fcmMessages,
          smsBatch._id.toString(),
          delayMs,
          device.smsSendDelaySeconds,
          plan,
        )

        return {
          success: true,
          message: 'SMS added to queue for processing',
          smsBatchId: smsBatch._id,
          recipientCount: recipients.length,
          ...(plan.waves.length > 1 && {
            estimatedCompletionAt: new Date(
              queuedAt + plan.projectedCompletionMs,
            ).toISOString(),
          }),
          ...(warning && { warning }),
        }
      } catch (e) {
        // Update batch status to failed
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'failed', error: e.message },
        })

        // Update all SMS in batch to failed
        await this.smsModel.updateMany(
          { smsBatch: smsBatch._id },
          { $set: { status: 'failed', error: e.message } },
        )

        throw new HttpException(
          {
            success: false,
            error: 'Failed to add SMS to queue',
            additionalInfo: e,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }
    }

    try {
      const skipped = shouldSkipFcmSend(device.user, deviceId)
      const response = skipped
        ? skippedBatchResponse(fcmMessages.length)
        : await firebaseAdmin.messaging().sendEach(fcmMessages)

      console.log(response)

      if (skipped) {
        await this.smsModel.updateMany(
          { smsBatch: smsBatch._id },
          { $set: { errorCode: FCM_SEND_SKIPPED_ERROR_CODE } },
        )
      }

      if (response.successCount === 0) {
        throw new HttpException(
          {
            success: false,
            error: 'Failed to send SMS',
            additionalInfo: response,
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      this.deviceModel
        .findByIdAndUpdate(deviceId, {
          $inc: { sentSMSCount: response.successCount },
        })
        .exec()
        .catch((e) => {
          console.log('Failed to update sentSMSCount')
          console.log(e)
        })

      // sentSMSCount is read before the increment above, so a zero here means
      // this send is the account's first.
      if (device.sentSMSCount === 0 && response.successCount > 0) {
        this.usersService
          .markMilestone(userIdOf(device.user), 'firstSmsAt')
          .catch(() => undefined)
      }

      this.smsBatchModel
        .findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'completed' },
        })
        .exec()
        .catch((e) => {
          console.error('failed to update sms batch status to completed')
        })

      return warning ? { ...response, warning } : response
    } catch (e) {
      this.smsBatchModel
        .findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'failed', error: e.message },
        })
        .exec()
        .catch((e) => {
          console.error('failed to update sms batch status to failed')
        })
      throw new HttpException(
        {
          success: false,
          error: 'Failed to send SMS',
          additionalInfo: e,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  async sendBulkSMS(deviceId: string, body: SendBulkSMSInputDTO): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device?.enabled) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist or is not enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (
      !Array.isArray(body.messages) ||
      body.messages.length === 0 ||
      body.messages.map((m) => m.recipients).flat().length === 0
    ) {
      throw new HttpException(
        {
          success: false,
          error: 'Invalid message list',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.billingService.canPerformAction(
      device.user.toString(),
      'bulk_send_sms',
      body.messages.map((m) => m.recipients).flat().length,
    )

    // Check if any message has scheduledAt and validate queue is enabled
    const hasScheduledMessages = body.messages.some((m) => m.scheduledAt)
    if (hasScheduledMessages && !this.smsQueueService.isQueueEnabled()) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS scheduling requires queue to be enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const { messageTemplate, messages } = body

    const smsBatch = await this.smsBatchModel.create({
      user: device.user,
      device: device._id,
      message: messageTemplate,
      recipientCount: messages
        .map((m) => m.recipients.length)
        .reduce((a, b) => a + b, 0),
      recipientPreview: this.getRecipientsPreview(
        messages.map((m) => m.recipients).flat(),
      ),
      status: 'pending',
    })

    // Track FCM messages with their calculated delays for grouping
    const fcmMessagesWithDelays: Array<{
      message: Message
      scheduledTime?: number
      smsId: Types.ObjectId
    }> = []
    // The build the device was on when queued; the status report replaces it
    const queuedAppVersion = appVersionMetadata(device)
    const smsDocumentsToInsert: Array<Record<string, any>> = []
    const smsToFcmMetadata: Array<{
      recipient: string
      message: string
      simSubscriptionId?: number
      scheduledTime?: number
      scheduledAt?: string
    }> = []

    for (const smsData of messages) {
      const message = smsData.message
      const recipients = smsData.recipients

      if (!message) {
        continue
      }

      if (!Array.isArray(recipients) || recipients.length === 0) {
        continue
      }

      // Validates scheduledAt; the queue delay itself is computed per group
      // right before enqueueing so equal times share one wave plan
      const delayMs = this.calculateDelayFromScheduledAt(smsData.scheduledAt)
      const scheduledTime =
        delayMs === undefined
          ? undefined
          : new Date(smsData.scheduledAt).getTime()

      for (let recipient of recipients) {
        recipient = recipient.replace(/\s+/g, "")
        smsDocumentsToInsert.push({
          user: device.user,
          device: device._id,
          smsBatch: smsBatch._id,
          message: message,
          type: SMSType.SENT,
          recipient,
          requestedAt: new Date(),
          status: 'pending',
          ...(smsData.simSubscriptionId !== undefined && {
            simSubscriptionId: smsData.simSubscriptionId,
          }),
          metadata: queuedAppVersion,
        })
        smsToFcmMetadata.push({
          recipient,
          message,
          ...(smsData.simSubscriptionId !== undefined && {
            simSubscriptionId: smsData.simSubscriptionId,
          }),
          scheduledTime,
          scheduledAt: smsData.scheduledAt,
        })
      }
    }

    const insertChunkSize = 500
    const insertedSmsDocs: any[] = []
    const hasInsertMany = typeof (this.smsModel as any).insertMany === 'function'
    for (let i = 0; i < smsDocumentsToInsert.length; i += insertChunkSize) {
      const chunk = smsDocumentsToInsert.slice(i, i + insertChunkSize)
      if (hasInsertMany) {
        const insertedChunk = await (this.smsModel as any).insertMany(chunk, { ordered: true })
        insertedSmsDocs.push(...insertedChunk)
        continue
      }

      // Fallback for mocked/non-standard models that don't expose insertMany
      for (const smsDocument of chunk) {
        const createdSmsDoc = await this.smsModel.create(smsDocument)
        insertedSmsDocs.push(createdSmsDoc)
      }
    }

    if (insertedSmsDocs.length !== smsToFcmMetadata.length) {
      throw new HttpException(
        {
          success: false,
          error: 'Failed to map created SMS records to queue payload',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }

    for (let i = 0; i < insertedSmsDocs.length; i++) {
      const sms = insertedSmsDocs[i]
      const metadata = smsToFcmMetadata[i]
      const updatedSMSData = {
        smsId: sms._id,
        smsBatchId: smsBatch._id,
        message: metadata.message,
        recipients: [metadata.recipient],
        ...(metadata.simSubscriptionId !== undefined && {
          simSubscriptionId: metadata.simSubscriptionId,
        }),

        // Legacy fields to be removed in the future
        smsBody: metadata.message,
        receivers: [metadata.recipient],
      }
      const stringifiedSMSData = JSON.stringify(updatedSMSData)

      const fcmMessage: Message = {
        data: {
          smsData: stringifiedSMSData,
        },
        token: device.fcmToken,
        android: smsAndroidConfig(metadata.scheduledAt),
      }
      fcmMessagesWithDelays.push({
        message: fcmMessage,
        scheduledTime: metadata.scheduledTime,
        smsId: sms._id,
      })
    }

    // Check if we should use the queue
    if (this.smsQueueService.isQueueEnabled()) {
      const addedJobs: Job[] = []
      try {
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'processing' },
        })

        // Group messages by scheduled time (undefined means immediate, group together)
        const messagesBySchedule = new Map<
          number | undefined,
          { messages: Message[]; smsIds: Types.ObjectId[] }
        >()
        for (const { message, scheduledTime, smsId } of fcmMessagesWithDelays) {
          if (!messagesBySchedule.has(scheduledTime)) {
            messagesBySchedule.set(scheduledTime, { messages: [], smsIds: [] })
          }
          const group = messagesBySchedule.get(scheduledTime)!
          group.messages.push(message)
          group.smsIds.push(smsId)
        }

        // Plan and persist every group first, then enqueue, so a failure
        // before the queue step leaves no live jobs and one during it can
        // roll back the jobs already added.
        const queuedAt = Date.now()
        let multiWave = false
        let projectedCompletionMs = 0
        const plannedGroups: Array<{
          messages: Message[]
          delayMs?: number
          plan: DispatchPlan
        }> = []
        for (const [scheduledTime, group] of messagesBySchedule.entries()) {
          const delayMs =
            scheduledTime === undefined
              ? undefined
              : Math.max(0, scheduledTime - queuedAt)
          const plan = this.smsQueueService.planSendSmsJob(
            group.messages.length,
            delayMs,
            device.smsSendDelaySeconds,
          )
          await this.stampDispatchDueAt(group.smsIds, plan, queuedAt)
          plannedGroups.push({ messages: group.messages, delayMs, plan })
          multiWave = multiWave || plan.waves.length > 1
          projectedCompletionMs = Math.max(
            projectedCompletionMs,
            plan.projectedCompletionMs,
          )
        }

        for (const { messages: groupMessages, delayMs, plan } of plannedGroups) {
          try {
            addedJobs.push(
              ...(await this.smsQueueService.addSendSmsJob(
                deviceId,
                groupMessages,
                smsBatch._id.toString(),
                delayMs,
                device.smsSendDelaySeconds,
                plan,
              )),
            )
          } catch (e) {
            await this.smsQueueService.removeJobs(addedJobs)
            throw e
          }
        }

        return {
          success: true,
          message: 'Bulk SMS added to queue for processing',
          smsBatchId: smsBatch._id,
          recipientCount: messages.map((m) => m.recipients).flat().length,
          ...(multiWave && {
            estimatedCompletionAt: new Date(
              queuedAt + projectedCompletionMs,
            ).toISOString(),
          }),
        }
      } catch (e) {
        // Update batch status to failed
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: {
            status: 'failed',
            error: e.message,
            successCount: 0,
            failureCount: fcmMessagesWithDelays.length,
          },
        })

        // Update all SMS in batch to failed
        await this.smsModel.updateMany(
          { smsBatch: smsBatch._id },
          { $set: { status: 'failed', error: e.message } },
        )

        throw new HttpException(
          {
            success: false,
            error: 'Failed to add bulk SMS to queue',
            additionalInfo: e,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }
    }

    // For non-queue path, convert back to simple array
    const fcmMessages = fcmMessagesWithDelays.map(({ message }) => message)
    const fcmMessagesBatches = fcmMessages.map((m) => [m])
    const fcmResponses: BatchResponse[] = []
    const skipped = shouldSkipFcmSend(device.user, deviceId)

    if (skipped) {
      await this.smsModel.updateMany(
        { smsBatch: smsBatch._id },
        { $set: { errorCode: FCM_SEND_SKIPPED_ERROR_CODE } },
      )
    }

    // fcmMessagesBatches holds one message per entry, so anything inside this
    // loop runs once per recipient. The milestone is tracked outside it.
    let isFirstSmsForAccount = device.sentSMSCount === 0

    for (const batch of fcmMessagesBatches) {
      try {
        const response = skipped
          ? skippedBatchResponse(batch.length)
          : await firebaseAdmin.messaging().sendEach(batch)

        console.log(response)
        fcmResponses.push(response)

        this.deviceModel
          .findByIdAndUpdate(deviceId, {
            $inc: { sentSMSCount: response.successCount },
          })
          .exec()
          .catch((e) => {
            console.log('Failed to update sentSMSCount')
            console.log(e)
          })

        if (isFirstSmsForAccount && response.successCount > 0) {
          isFirstSmsForAccount = false
          this.usersService
            .markMilestone(userIdOf(device.user), 'firstSmsAt')
            .catch(() => undefined)
        }

        this.smsBatchModel
          .findByIdAndUpdate(smsBatch._id, {
            $set: { status: 'completed' },
          })
          .exec()
          .catch((e) => {
            console.error('failed to update sms batch status to completed')
          })
      } catch (e) {
        console.log('Failed to send SMS: FCM')
        console.log(e)

        this.smsBatchModel
          .findByIdAndUpdate(smsBatch._id, {
            $set: { status: 'failed', error: e.message },
          })
          .exec()
          .catch((e) => {
            console.error('failed to update sms batch status to failed')
          })
      }
    }

    const successCount = fcmResponses.reduce(
      (acc, m) => acc + m.successCount,
      0,
    )
    const failureCount = fcmResponses.reduce(
      (acc, m) => acc + m.failureCount,
      0,
    )
    const response = {
      success: successCount > 0,
      successCount,
      failureCount,
      fcmResponses,
    }
    return response
  }

  async receiveSMS(
    deviceId: string,
    dto: ReceivedSMSDTO,
    sdkClient?: string,
  ): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Type checks matter: without a global ValidationPipe the body is not
    // coerced, and these fields flow into query filters.
    if (isMalformedReceivedSms(dto.sender, dto.message)) {
      console.error(`receiveSMS: Invalid received SMS data (sender: ${dto.sender}, message: ${dto.message}) (receivedAt: ${dto.receivedAt}, receivedAtInMillis: ${dto.receivedAtInMillis})`)
      throw new HttpException(
        {
          success: false,
          error: 'Invalid received SMS data',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // A success response stops the app from retrying a message it cannot fix.
    const ignoredReason = receivedSmsIgnoreReason(dto.sender, dto.message)
    if (ignoredReason) {
      console.warn(
        `receiveSMS: ignored received SMS for device ${deviceId} (${ignoredReason})`,
      )
      return { ignored: true, reason: ignoredReason }
    }

    const { overLimit } = await this.billingService.canPerformAction(
      device.user.toString(),
      'receive_sms',
      1,
    )

    const receivedAt = resolveReceivedAt(
      dto.receivedAtInMillis,
      dto.receivedAt,
    )

    // Narrowed here, not only in isMalformedReceivedSms, so the filter below
    // provably takes strings and never a query operator object.
    const sender = typeof dto.sender === 'string' ? dto.sender : ''
    const message = typeof dto.message === 'string' ? dto.message : ''

    // Deduplication: Check for existing SMS with same device, sender, message, and receivedAt (within ±5 seconds tolerance)
    const toleranceMs = 5000 // 5 seconds
    const toleranceStart = new Date(receivedAt.getTime() - toleranceMs)
    const toleranceEnd = new Date(receivedAt.getTime() + toleranceMs)

    const existingSMS = await this.smsModel.findOne({
      device: device._id,
      type: SMSType.RECEIVED,
      sender,
      message,
      receivedAt: {
        $gte: toleranceStart,
        $lte: toleranceEnd,
      },
    })

    if (existingSMS) {
      console.log(
        `Duplicate SMS detected for device ${deviceId}, sender ${dto.sender}, returning existing record: ${existingSMS._id}`,
      )
      return existingSMS
    }

    const sms = await this.smsModel.create({
      user: device.user,
      device: device._id,
      message,
      type: SMSType.RECEIVED,
      status: 'received',
      sender,
      receivedAt,
      ...lateArrivalTimestamps(receivedAt, device.createdAt),
      ...(overLimit && { overLimit: true }),
      metadata: appVersionMetadata(device, sdkClient),
    })

    this.deviceModel
      .findByIdAndUpdate(deviceId, {
        $inc: { receivedSMSCount: 1 },
      })
      .exec()
      .catch((e) => {
        console.log('Failed to update receivedSMSCount')
        console.log(e)
      })

    if (!isTooLateForWebhook(receivedAt)) {
      this.webhookService
        .deliverNotification({
          sms,
          user: device.user,
          event: WebhookEvent.MESSAGE_RECEIVED,
        })
        .catch((e) => {
          console.log(e)
        })
    }

    return sms
  }

  async getReceivedSMS(
    deviceId: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: any[]; meta: any }> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit

    // Get total count for pagination metadata
    const total = await this.smsModel.countDocuments({
      device: device._id,
      type: SMSType.RECEIVED,
    })

    // @ts-ignore
    const data = await this.smsModel
      .find(
        {
          device: device._id,
          type: SMSType.RECEIVED,
        },
        null,
        {
          sort: { receivedAt: -1 },
          limit: limit,
          skip: skip,
        },
      )
      .populate({
        path: 'device',
        select: '_id name brand model buildId enabled',
      })
      .lean() // Use lean() to return plain JavaScript objects instead of Mongoose documents

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit)

    return {
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
      data,
    }
  }

  async getMessages(
    deviceId: string,
    type = '',
    page = 1,
    limit = 50,
    search = '',
  ): Promise<{ data: any[]; meta: any }> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit

    // Build query based on type filter
    const query: any = { device: device._id }

    if (type === 'sent') {
      query.type = SMSType.SENT
    } else if (type === 'received') {
      query.type = SMSType.RECEIVED
    }

    // Free-text search across the message body and either party's number.
    // The input is escaped before it reaches RegExp: an unescaped "(" throws
    // and fails the request, and a crafted pattern is a ReDoS vector.
    const trimmedSearch = search?.trim()
    if (trimmedSearch) {
      const pattern = new RegExp(escapeRegExp(trimmedSearch), 'i')
      query.$or = [
        { message: pattern },
        { recipient: pattern },
        { sender: pattern },
      ]
    }

    // Get total count for pagination metadata
    const total = await this.smsModel.countDocuments(query)

    // @ts-ignore
    const data = await this.smsModel
      .find(query, null, {
        // Sort by the most recent timestamp (receivedAt for received, sentAt for sent)
        sort: { createdAt: -1 },
        limit: limit,
        skip: skip,
      })
      .populate({
        path: 'device',
        select: '_id name brand model buildId enabled',
      })
      .lean() // Use lean() to return plain JavaScript objects instead of Mongoose documents

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit)

    return {
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
      data,
    }
  }

  // Account-level history. Always constrains device to the caller's live
  // devices: messages from deleted devices keep a dangling ref and must not
  // surface (a future includeDeleted widens this same $in from tombstones).
  async getMessagesForUser(
    user: User,
    filters: ParsedMessageQuery,
    page = 1,
    limit = 50,
  ): Promise<{ data: any[]; meta: any }> {
    const liveDevices = await this.deviceModel.find(
      { user: user._id },
      '_id',
    )
    const liveDeviceIds = liveDevices.map((d) => d._id)

    let scopedDeviceIds = liveDeviceIds
    if (filters.deviceIds?.length) {
      const liveSet = new Set(liveDeviceIds.map(String))
      const unknown = filters.deviceIds.find((id) => !liveSet.has(String(id)))
      if (unknown) {
        throw new HttpException(
          { error: `Device not found: ${unknown}` },
          HttpStatus.NOT_FOUND,
        )
      }
      scopedDeviceIds = filters.deviceIds
    }

    if (scopedDeviceIds.length === 0) {
      // Zero live devices: nothing can match, skip the sms collection
      return filters.cursor
        ? { meta: { limit, nextCursor: null, hasMore: false }, data: [] }
        : { meta: { page, limit, total: 0, totalPages: 0 }, data: [] }
    }

    const query: any = {
      user: user._id,
      device: { $in: scopedDeviceIds },
    }
    if (filters.smsBatchId) {
      // 404 on an unowned batch, matching the deviceIds contract. A legacy
      // batch without a user field falls through; the device $in above still
      // scopes what its filter can return.
      const batch = await this.smsBatchModel.findOne(
        { _id: filters.smsBatchId },
        'user',
      )
      if (!batch || (batch.user && String(batch.user) !== String(user._id))) {
        throw new HttpException(
          { error: `Batch not found: ${filters.smsBatchId}` },
          HttpStatus.NOT_FOUND,
        )
      }
      query.smsBatch = filters.smsBatchId
    }
    if (filters.direction) {
      query.type = toStoredType(filters.direction)
    }
    if (filters.status) {
      query.status = filters.status
    }
    if (filters.search) {
      const pattern = new RegExp(escapeRegExp(filters.search), 'i')
      query.$or = [
        { message: pattern },
        { recipient: pattern },
        { sender: pattern },
      ]
    }
    if (filters.from || filters.to) {
      query.createdAt = {
        ...(filters.from && { $gte: filters.from }),
        ...(filters.to && { $lt: filters.to }),
      }
    }

    const desc = filters.order === 'desc'
    const sort: Record<string, 1 | -1> = desc
      ? { createdAt: -1, _id: -1 }
      : { createdAt: 1, _id: 1 }

    if (filters.cursor) {
      // Keyset predicate with _id tiebreaker: bulk sends insert whole batches
      // in one createdAt millisecond, so timestamp alone repeats or skips them
      const { createdAt, id } = filters.cursor
      const op = desc ? '$lt' : '$gt'
      const keyset = {
        $or: [
          { createdAt: { [op]: createdAt } },
          { createdAt, _id: { [op]: id } },
        ],
      }
      const findQuery = query.$or
        ? { $and: [query, keyset] }
        : { ...query, ...keyset }

      const data = await this.smsModel
        .find(findQuery, null, { sort, limit: limit + 1 })
        .populate({ path: 'device', select: '_id name brand model buildId enabled' })
        .lean()

      const hasMore = data.length > limit
      const pageData = hasMore ? data.slice(0, limit) : data
      const last = pageData[pageData.length - 1]
      return {
        meta: {
          limit,
          nextCursor:
            hasMore && last
              ? encodeCursor(new Date(last.createdAt as any), last._id as any)
              : null,
          hasMore,
        },
        data: this.decorateDirection(pageData),
      }
    }

    const skip = (page - 1) * limit
    const total = await this.smsModel.countDocuments(query)
    const data = await this.smsModel
      .find(query, null, { sort, limit, skip })
      .populate({ path: 'device', select: '_id name brand model buildId enabled' })
      .lean()

    // nextCursor here too, so a poller can enter keyset mode from its first
    // (cursorless) call instead of needing a separate bootstrap step
    const hasMore = skip + data.length < total
    const last = data[data.length - 1]
    return {
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        nextCursor:
          hasMore && last
            ? encodeCursor(new Date(last.createdAt as any), last._id as any)
            : null,
        hasMore,
      },
      data: this.decorateDirection(data),
    }
  }

  // API vocabulary: lowercase direction derived from the stored type field
  private decorateDirection(messages: any[]): any[] {
    return messages.map((m) => ({ ...m, direction: toDirection(m.type) }))
  }

  async updateSMSStatus(
    deviceId: string,
    dto: UpdateSMSStatusDTO,
    sdkClient?: string,
  ): Promise<any> {

    const device = await this.deviceModel.findById(deviceId);
    
    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    
    const sms = await this.smsModel.findById(dto.smsId);
    
    if (!sms) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    
    // Verify the SMS belongs to this device
    if (sms.device.toString() !== deviceId) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS does not belong to this device',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    
    // Normalize status to lowercase for comparison
    const normalizedStatus = dto.status.toLowerCase();
    
    const updateData: any = {
      status: normalizedStatus, // Store normalized status
    };

    // Dotted paths so other metadata keys survive.
    for (const [key, value] of Object.entries(
      appVersionMetadata(device, sdkClient),
    )) {
      updateData[`metadata.${key}`] = value;
    }
    
    // What the phone did before the radio: both are reported on every status
    // for the same send, so a later report just restates them
    const pushReceivedAt = resolveReportedAt(dto.pushReceivedAtInMillis)
    const sendAttemptedAt = resolveReportedAt(dto.sendAttemptedAtInMillis)
    // A reversed pair would make the on-device wait negative, so drop both
    // rather than store a leg that cannot have happened.
    const orderedTiming =
      !pushReceivedAt || !sendAttemptedAt || sendAttemptedAt >= pushReceivedAt
    if (pushReceivedAt && orderedTiming) {
      updateData.pushReceivedAt = pushReceivedAt
    }
    if (sendAttemptedAt && orderedTiming) {
      updateData.sendAttemptedAt = sendAttemptedAt
    }
    const reportAttempt = resolveReportAttempt(dto.reportAttempt)
    if (reportAttempt !== undefined) {
      updateData['metadata.statusReportAttempt'] = reportAttempt
    }

    // Update timestamps based on status
    let failureEntry: { $push: Record<string, any> } | null = null
    if (normalizedStatus === 'sent' && dto.sentAtInMillis) {
      updateData.sentAt = new Date(dto.sentAtInMillis);
    } else if (normalizedStatus === 'delivered' && dto.deliveredAtInMillis) {
      updateData.deliveredAt = new Date(dto.deliveredAtInMillis);
    } else if (normalizedStatus === 'failed') {
      // The timestamp is optional; the failure itself is not
      // One validated value for both the field and the history entry
      const failedAt = resolveReportedAt(dto.failedAtInMillis) ?? new Date()
      updateData.failedAt = failedAt
      updateData.errorCode = dto.errorCode;
      updateData.errorMessage = dto.errorMessage || 'Unknown error';
      failureEntry = errorHistoryPush(
        {
          code: dto.errorCode,
          message: updateData.errorMessage,
          source: 'device',
        },
        failedAt,
      )
    }
    
    // Update the SMS
const updatedSms = await this.smsModel.findByIdAndUpdate(
  dto.smsId,
  { $set: updateData, ...(failureEntry ?? {}) },
  { new: true } 
);
    
    // Check if all SMS in batch have the same status, then update batch status.
    // The batch id comes from the body, so it is matched against this device.
    if (dto.smsBatchId && Types.ObjectId.isValid(dto.smsBatchId)) {
      // SMSBatch types `device` as the populated Device, so the filter is cast
      // to match the ObjectId actually stored. Runtime behavior is unchanged.
      const smsBatch = await this.smsBatchModel.findOne({
        _id: dto.smsBatchId,
        device: new Types.ObjectId(deviceId),
      } as any);
      if (smsBatch) {
        const allSmsInBatch = await this.smsModel.find({ smsBatch: dto.smsBatchId });
        
        // Check if all SMS in batch have the same status (case insensitive)
        const allHaveSameStatus = allSmsInBatch.every(sms => sms.status.toLowerCase() === normalizedStatus);
        
        if (allHaveSameStatus) {
          const smsBatchStatus = normalizedStatus === 'failed' ? 'failed' : 'completed';
          await this.smsBatchModel.findByIdAndUpdate(dto.smsBatchId, { 
            $set: { status: smsBatchStatus } 
          });
        }
      }
    }
    
    // Trigger webhook event for SMS status update
    try {
       let event: WebhookEvent
       switch (normalizedStatus) {
          case 'sent':
            event = WebhookEvent.MESSAGE_SENT
            break
          case 'delivered':
            event = WebhookEvent.MESSAGE_DELIVERED
            break
          case 'failed':
            event = WebhookEvent.MESSAGE_FAILED
            break
          case 'received':
            event = WebhookEvent.MESSAGE_RECEIVED
            break
          default:
            event = WebhookEvent.UNKNOWN_STATE
          }
      this.webhookService.deliverNotification({
        sms: updatedSms,
        user: device.user,
        event,
      });
    } catch (error) {
      console.error('Failed to trigger webhook event:', error);
    }
    
    return {
      success: true,
      message: 'SMS status updated successfully',
    };
  }

  async getStatsForUser(user: User) {
    const devices = await this.deviceModel.find({ user: user._id })
    const apiKeys = await this.authService.getUserApiKeys(user)

    const totalSentSMSCount = devices.reduce((acc, device) => {
      return acc + (device.sentSMSCount || 0)
    }, 0)

    const totalReceivedSMSCount = devices.reduce((acc, device) => {
      return acc + (device.receivedSMSCount || 0)
    }, 0)

    const totalDeviceCount = devices.length
    const totalApiKeyCount = apiKeys.length

    return {
      totalSentSMSCount,
      totalReceivedSMSCount,
      totalDeviceCount,
      totalApiKeyCount,
    }
  }

  async getSmsPermissionStatus(user: User) {
    return loadSmsPermissionStatus(
      this.smsModel as any,
      this.deviceModel,
      user._id as Types.ObjectId,
      new Date(),
      { includeHeartbeat: true },
    )
  }

  private getRecipientsPreview(recipients: string[]): string {
    if (recipients.length === 0) {
      return null
    } else if (recipients.length === 1) {
      return recipients[0]
    } else if (recipients.length === 2) {
      return `${recipients[0]} and ${recipients[1]}`
    } else if (recipients.length === 3) {
      return `${recipients[0]}, ${recipients[1]}, and ${recipients[2]}`
    } else {
      return `${recipients[0]}, ${recipients[1]}, and ${
        recipients.length - 2
      } others`
    }
  }

  // Scoped to the device from the route so a message is only reachable through
  // the device that owns it. A mismatch is reported as not found.
  async getSMSById(deviceId: string, smsId: string): Promise<any> {
    const sms = Types.ObjectId.isValid(smsId)
      ? await this.smsModel.findOne({
          _id: new Types.ObjectId(smsId),
          device: new Types.ObjectId(deviceId),
        })
      : null;

    if (!sms) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return sms;
  }

  async getSmsBatchById(deviceId: string, smsBatchId: string): Promise<any> {
    const smsBatch = Types.ObjectId.isValid(smsBatchId)
      ? await this.smsBatchModel.findOne({
          _id: smsBatchId,
          device: new Types.ObjectId(deviceId),
        } as any)
      : null;

    if (!smsBatch) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS batch not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Find all SMS messages that belong to this batch
    const smsMessages = await this.smsModel.find({ 
      smsBatch: new Types.ObjectId(smsBatchId),
      device: smsBatch.device
    });

    // Return both the batch and its SMS messages
    return {
      batch: smsBatch,
      messages: smsMessages
    };
  }

  // Hands the phone the messages its push may have missed. Each claim is one
  // atomic update, so two polls at once never get the same message.
  async claimPendingMessages(deviceId: string): Promise<any[]> {
    const device = await this.deviceModel.findById(deviceId)
    if (!device) {
      throw new HttpException(
        { success: false, error: 'Device not found' },
        HttpStatus.NOT_FOUND,
      )
    }

    // Heartbeats write appVersionInfo; registration writes appVersionCode
    const versionCode =
      device.appVersionInfo?.versionCode ?? device.appVersionCode ?? 0
    if (versionCode < RECOVERY_MIN_VERSION_CODE) {
      throw new HttpException(
        { success: false, error: 'This app version cannot recover messages' },
        HttpStatus.FORBIDDEN,
      )
    }
    // The app caches the switch until its next heartbeat; turning it off must not wait for that
    if (!deviceConfigFor(device).recoveryPollEnabled) {
      throw new HttpException(
        { success: false, error: 'Message recovery is switched off' },
        HttpStatus.FORBIDDEN,
      )
    }

    // One conditional update both checks and takes the cooldown, so two
    // polls arriving together cannot both pass it
    const now = new Date()
    const admitted = await this.deviceModel.findOneAndUpdate(
      {
        _id: deviceId,
        $or: [
          { lastPendingPollAt: { $exists: false } },
          { lastPendingPollAt: { $lt: new Date(now.getTime() - POLL_COOLDOWN_MS) } },
        ],
      },
      { $set: { lastPendingPollAt: now } },
    )
    if (!admitted) {
      throw new HttpException(
        { success: false, error: 'Polled too recently' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const claimed: any[] = []
    while (claimed.length < CLAIM_LIMIT) {
      const sms = await this.smsModel.findOneAndUpdate(
        pendingRecoveryFilter(deviceId, now),
        {
          $set: {
            status: 'dispatched',
            dispatchedAt: now,
            'metadata.recoveredAt': now,
          },
          $inc: { dispatchAttempts: 1 },
        },
        { new: true, sort: { requestedAt: 1 } },
      )
      if (!sms) break
      claimed.push(toRecoveryPayload(sms))
    }
    return claimed
  }

  async countPendingMessages(deviceId: string, now = new Date()): Promise<number> {
    return this.smsModel.countDocuments(pendingRecoveryFilter(deviceId, now))
  }

  async heartbeat(
    deviceId: string,
    input: HeartbeatInputDTO,
  ): Promise<HeartbeatResponseDTO> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    const now = new Date()
    const updateData: any = {
      lastHeartbeat: now,
    }

    let fcmTokenUpdated = false

    // Update FCM token if provided and different
    if (input.fcmToken && input.fcmToken !== device.fcmToken) {
      updateData.fcmToken = input.fcmToken
      updateData.fcmTokenUpdatedAt = now
      fcmTokenUpdated = true
    }

    // Update receiveSMSEnabled if provided and different
    if (
      input.receiveSMSEnabled !== undefined &&
      input.receiveSMSEnabled !== device.receiveSMSEnabled
    ) {
      updateData.receiveSMSEnabled = input.receiveSMSEnabled
    }

    // Update smsSendDelaySeconds if provided (clamp 0-3600)
    if (input.smsSendDelaySeconds !== undefined) {
      const clamped = Math.min(
        3600,
        Math.max(0, Math.floor(Number(input.smsSendDelaySeconds))),
      )
      updateData.smsSendDelaySeconds = clamped
    }

    // Update batteryInfo if provided
    if (input.batteryPercentage !== undefined || input.isCharging !== undefined) {
      if (input.batteryPercentage !== undefined) {
        updateData['batteryInfo.percentage'] = input.batteryPercentage
      }
      if (input.isCharging !== undefined) {
        updateData['batteryInfo.isCharging'] = input.isCharging
      }
      updateData['batteryInfo.lastUpdated'] = now
    }

    // Update networkInfo if provided
    if (input.networkType !== undefined) {
      updateData['networkInfo.networkType'] = input.networkType
      updateData['networkInfo.lastUpdated'] = now
    }

    // Update appVersionInfo if provided
    if (input.appVersionName !== undefined || input.appVersionCode !== undefined) {
      if (input.appVersionName !== undefined) {
        updateData['appVersionInfo.versionName'] = input.appVersionName
      }
      if (input.appVersionCode !== undefined) {
        updateData['appVersionInfo.versionCode'] = input.appVersionCode
      }
      updateData['appVersionInfo.lastUpdated'] = now
    }

    // Builds from 2.8.0 on report upgrades only here, so keep the device fields current too.
    if (input.appVersionName && device.appVersionName !== input.appVersionName) {
      updateData.appVersionName = input.appVersionName
    }
    if (input.appVersionCode && device.appVersionCode !== input.appVersionCode) {
      updateData.appVersionCode = input.appVersionCode
    }

    // The app reports an upgrade here and nowhere else, and the rollup carries
    // the oldest build on the account, which decides whether an update prompt is
    // shown. Without refreshing on a change, someone who has just updated keeps
    // being told to update until the nightly sweep. Compared against the same
    // effective version the rollup stores, so an unchanged heartbeat costs
    // nothing.
    const reportedVersion =
      input.appVersionCode ?? device.appVersionInfo?.versionCode
    const appVersionChanged =
      typeof reportedVersion === 'number' &&
      reportedVersion !==
        (device.appVersionInfo?.versionCode ?? device.appVersionCode)

    // Update OS info if provided. These change at most once per OS upgrade,
    // so skip keys already matching the stored value to keep the write a no-op.
    for (const [key, value] of Object.entries(
      normalizeOsFields(input, device.osVersionSource, device.osVersion),
    )) {
      if (device[key] !== value) updateData[key] = value
    }

    // Update deviceUptimeInfo if provided
    if (input.deviceUptimeMillis !== undefined) {
      updateData['deviceUptimeInfo.uptimeMillis'] = input.deviceUptimeMillis
      updateData['deviceUptimeInfo.lastUpdated'] = now
    }

    // Update systemInfo if timezone or locale provided
    if (input.timezone !== undefined || input.locale !== undefined) {
      if (input.timezone !== undefined) {
        updateData['systemInfo.timezone'] = input.timezone
      }
      if (input.locale !== undefined) {
        updateData['systemInfo.locale'] = input.locale
      }
      updateData['systemInfo.lastUpdated'] = now
    }

    // Update memoryInfo if provided
    if (
      input.memoryFreeBytes !== undefined ||
      input.memoryTotalBytes !== undefined ||
      input.memoryMaxBytes !== undefined
    ) {
      if (input.memoryFreeBytes !== undefined) {
        updateData['memoryInfo.freeBytes'] = input.memoryFreeBytes
      }
      if (input.memoryTotalBytes !== undefined) {
        updateData['memoryInfo.totalBytes'] = input.memoryTotalBytes
      }
      if (input.memoryMaxBytes !== undefined) {
        updateData['memoryInfo.maxBytes'] = input.memoryMaxBytes
      }
      updateData['memoryInfo.lastUpdated'] = now
    }

    // Update storageInfo if provided
    if (
      input.storageAvailableBytes !== undefined ||
      input.storageTotalBytes !== undefined
    ) {
      if (input.storageAvailableBytes !== undefined) {
        updateData['storageInfo.availableBytes'] = input.storageAvailableBytes
      }
      if (input.storageTotalBytes !== undefined) {
        updateData['storageInfo.totalBytes'] = input.storageTotalBytes
      }
      updateData['storageInfo.lastUpdated'] = now
    }

    // Update powerInfo if provided
    if (
      input.isIgnoringBatteryOptimizations !== undefined ||
      input.isDeviceIdleMode !== undefined ||
      input.isPowerSaveMode !== undefined
    ) {
      if (input.isIgnoringBatteryOptimizations !== undefined) {
        updateData['powerInfo.isIgnoringBatteryOptimizations'] =
          input.isIgnoringBatteryOptimizations
      }
      if (input.isDeviceIdleMode !== undefined) {
        updateData['powerInfo.isDeviceIdleMode'] = input.isDeviceIdleMode
      }
      if (input.isPowerSaveMode !== undefined) {
        updateData['powerInfo.isPowerSaveMode'] = input.isPowerSaveMode
      }
      updateData['powerInfo.lastUpdated'] = now
    }

    // Update appStateInfo if provided
    const appStateKeys = [
      'hasSendSmsPermission',
      'hasReceiveSmsPermission',
      'hasReadPhoneStatePermission',
      'hasPostNotificationsPermission',
      'stickyNotificationEnabled',
      'usingLegacyUi',
    ] as const
    if (appStateKeys.some((key) => input[key] !== undefined)) {
      for (const key of appStateKeys) {
        if (input[key] !== undefined) {
          updateData[`appStateInfo.${key}`] = input[key]
        }
      }
      updateData['appStateInfo.lastUpdated'] = now
    }

    // Update simInfo if provided
    if (input.simInfo !== undefined) {
      updateData.simInfo = {
        ...input.simInfo,
        lastUpdated: input.simInfo.lastUpdated || now,
      }
    }

    // Update device with all changes
    await this.deviceModel.findByIdAndUpdate(
      deviceId,
      this.tokenUpdate(device, input.fcmToken, updateData),
    )

    if (appVersionChanged) {
      this.userRollup.refreshQuietly(device.user as any)
    }

    // Fetch updated device to get current name
    const updatedDevice = await this.deviceModel.findById(deviceId)

    return {
      success: true,
      fcmTokenUpdated,
      lastHeartbeat: now,
      name: updatedDevice?.name,
      pendingCount: await this.countPendingMessages(deviceId, now),
      config: deviceConfigFor(updatedDevice),
    }
  }
}
