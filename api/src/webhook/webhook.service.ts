import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { Model, Types } from 'mongoose'
import {
  WebhookSubscription,
  WebhookSubscriptionDocument,
} from './schemas/webhook-subscription.schema'
import { InjectModel } from '@nestjs/mongoose'
import { WebhookEvent } from './webhook-event.enum'
import {
  WebhookNotification,
  WebhookNotificationDocument,
} from './schemas/webhook-notification.schema'
import axios from 'axios'
import * as http from 'http'
import * as https from 'https'
import { lookup as dnsLookup } from 'dns'
import { BlockList, isIP, LookupFunction } from 'net'
import { Cron } from '@nestjs/schedule'
import * as crypto from 'crypto'
import mongoose from 'mongoose'
import { SMS } from '../gateway/schemas/sms.schema'
import { resolveSimUsedReport } from '../gateway/sim-report'
import { WebhookQueueService } from './queue/webhook-queue.service'
import { MailService } from '../mail/mail.service'
import { firstName } from '../mail/first-name'
import { skipReason } from '../mail/email-eligibility'
import { UsersService } from '../users/users.service'

// Longer than the 60 second delivery timeout cap, so an attempt in flight keeps its claim.
const DELIVERY_CLAIM_MS = 5 * 60 * 1000

const blockedAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 3],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['fec0::', 10],
  ['fc00::', 7],
] as const) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6')
}

/**
 * Endpoints can carry a token in the query or in userinfo, so the admin summary
 * only ever shows origin and path.
 */
export const redactDeliveryUrl = (deliveryUrl: string): string => {
  if (!deliveryUrl) {
    return ''
  }
  try {
    const url = new URL(deliveryUrl)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[unparseable url]'
  }
}

@Injectable()
export class WebhookService {
  constructor(
    @InjectModel(WebhookSubscription.name)
    private webhookSubscriptionModel: Model<WebhookSubscriptionDocument>,
    @InjectModel(WebhookNotification.name)
    private webhookNotificationModel: Model<WebhookNotificationDocument>,
    private webhookQueueService: WebhookQueueService,
    private mailService: MailService,
    private usersService: UsersService,
  ) {}

  async findOne({ user, webhookId }) {
    const webhook = await this.webhookSubscriptionModel.findOne({
      _id: webhookId,
      user: user._id,
      deletedAt: null,
    })

    if (!webhook) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND)
    }
    return webhook
  }

  async findWebhooksForUser({ user }) {
    return await this.webhookSubscriptionModel.find({
      user: user._id,
      deletedAt: null,
    })
  }
  async findWebhookNotificationsForUser({
    user,
    page = 1,
    limit = 10,
    eventType,
    status,
    start,
    end,
    deviceId,
    webhookSubscriptionId,
  }: {
    user: any
    page?: number | string
    limit?: number | string
    eventType?: string
    status?: string
    start?: Date | string
    end?: Date | string
    deviceId?: string
    webhookSubscriptionId?: string
  }): Promise<{ data: any[]; meta: any }> {
    // History is shown for every webhook subscription the user owns, including
    // soft-deleted ones, so the historical record is preserved even after the
    // user removes a webhook.
    const userSubscriptionIds = await this.webhookSubscriptionModel.distinct(
      '_id',
      { user: user._id },
    )

    if (userSubscriptionIds.length === 0) {
      const limitNum = Math.max(1, Number.parseInt(limit?.toString() ?? '10') || 10)
      return {
        data: [],
        meta: {
          page: 1,
          limit: limitNum,
          total: 0,
          totalPages: 0,
        },
      }
    }

    let allowedSubscriptionIds = userSubscriptionIds
    if (webhookSubscriptionId) {
      if (!mongoose.Types.ObjectId.isValid(webhookSubscriptionId)) {
        throw new HttpException(
          'Invalid webhookSubscriptionId',
          HttpStatus.BAD_REQUEST,
        )
      }
      const requested = new mongoose.Types.ObjectId(webhookSubscriptionId)
      const owns = userSubscriptionIds.some((id: any) =>
        id.equals ? id.equals(requested) : id.toString() === requested.toString(),
      )
      if (!owns) {
        throw new HttpException(
          'Subscription not found',
          HttpStatus.NOT_FOUND,
        )
      }
      allowedSubscriptionIds = [requested] as any
    }

    const matchStage: any = {
      webhookSubscription: { $in: allowedSubscriptionIds },
    }

    if (eventType) {
      matchStage.event = eventType
    }

    if (
      start &&
      end &&
      !Number.isNaN(new Date(start).getTime()) &&
      !Number.isNaN(new Date(end).getTime())
    ) {
      matchStage.createdAt = { $gte: new Date(start), $lte: new Date(end) }
    }


    const pageNum = Math.max(1, Number.parseInt(page.toString()) || 1)
    const limitNum = Math.max(1, Number.parseInt(limit.toString()) || 10)
    const skip = (pageNum - 1) * limitNum

    const commonPipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: 'sms',
          localField: 'sms',
          foreignField: '_id',
          as: 'smsData',
        },
      },
      { $unwind: { path: '$smsData', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'devices',
          localField: 'smsData.device',
          foreignField: '_id',
          as: 'deviceData',
        },
      },
      { $unwind: { path: '$deviceData', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'webhooksubscriptions',
          localField: 'webhookSubscription',
          foreignField: '_id',
          as: 'webhookSubscriptionData',
        },
      },
      {
        $unwind: {
          path: '$webhookSubscriptionData',
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          computedStatus: {
            $cond: {
              if: { $ne: ['$deliveredAt', null] },
              then: 'delivered',
              else: {
                $cond: {
                  if: {
                    $or: [
                      { $ne: ['$deliveryAttemptAbortedAt', null] },
                      { $gte: ['$deliveryAttemptCount', 10] }
                    ]
                  },
                  then: 'failed',
                  else: {
                    $cond: {
                      if: {
                        $and: [
                          { $eq: ['$deliveredAt', null] },
                          { $eq: ['$deliveryAttemptAbortedAt', null] },
                          { $gt: ['$deliveryAttemptCount', 0] },
                          { $lt: ['$deliveryAttemptCount', 10] }
                        ]
                      },
                      then: 'retrying',
                      else: 'pending'
                    }
                  }
                }
              }
            }
          }
        }
      },
    ]

    // Apply status filter
    if (status) {
      commonPipeline.push({
        $match: {
          computedStatus: status
        }
      })
    }

    if (deviceId) {
      if (!mongoose.Types.ObjectId.isValid(deviceId)) {
        throw new HttpException(
          'Invalid deviceId',
          HttpStatus.BAD_REQUEST,
        )
      }

      commonPipeline.push({
        $match: {
          'deviceData._id': new mongoose.Types.ObjectId(deviceId),
        },
      })
    }

    const facetPipeline = [
      ...commonPipeline,
      {
        $facet: {
          totalCount: [{ $count: 'count' }],
          data: [
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: limitNum },
          ],
        },
      },
      {
        $project: {
          data: 1,
          totalCount: {
            $ifNull: [{ $arrayElemAt: ['$totalCount.count', 0] }, 0],
          },
        },
      },
    ]

    const [result] =
      await this.webhookNotificationModel.aggregate(facetPipeline)

    const total = result?.totalCount || 0
    const data = result?.data || []
    const totalPages = Math.ceil(total / limitNum)

    return {
      data,
      meta: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    }
  }
  async create({ user, createWebhookDto }) {
    const { name, events, deliveryUrl, signingSecret } = createWebhookDto

    this.validateDeliveryUrl(deliveryUrl)

    // validate signing secret
    if (!signingSecret || signingSecret.length < 20) {
      throw new HttpException('Invalid signing secret', HttpStatus.BAD_REQUEST)
    }

    if (!Array.isArray(events) || events.length === 0) {
      throw new HttpException(
        'Choose atleast one event to receive',
        HttpStatus.BAD_REQUEST,
      )
    }

    if (!events.every((event) => Object.values(WebhookEvent).includes(event))) {
      throw new HttpException('Invalid event type', HttpStatus.BAD_REQUEST)
    }

    const maxPerUser = this.getMaxWebhooksPerUser()
    const existingCount = await this.webhookSubscriptionModel.countDocuments({
      user: user._id,
      deletedAt: null,
    })
    if (existingCount >= maxPerUser) {
      throw new HttpException(
        `You can create at most ${maxPerUser} webhook subscriptions`,
        HttpStatus.BAD_REQUEST,
      )
    }

    // TODO: Encrypt signing secret
    // const webhookSignatureKey = process.env.WEBHOOK_SIGNATURE_KEY
    // const encryptedSigningSecret = encrypt(signingSecret, webhookSignatureKey)

    const webhookSubscription = await this.webhookSubscriptionModel.create({
      user: user._id,
      name: this.normalizeName(name),
      events,
      deliveryUrl,
      signingSecret,
    })

    return webhookSubscription
  }

  async update({ user, webhookId, updateWebhookDto }) {
    const webhookSubscription = await this.webhookSubscriptionModel.findOne({
      _id: webhookId,
      user: user._id,
      deletedAt: null,
    })

    if (!webhookSubscription) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND)
    }

    if (updateWebhookDto.hasOwnProperty('isActive')) {
      const nextIsActive = updateWebhookDto.isActive
      const wasActive = webhookSubscription.isActive
      webhookSubscription.isActive = updateWebhookDto.isActive

      // If the user is re-enabling an auto-disabled webhook, give it a grace
      // window so the next cron run doesn't immediately disable it again based
      // on historical failures still in the lookback window.
      if (wasActive === false && nextIsActive === true) {
        webhookSubscription.lastEnabledAt = new Date()
      }
    }

    if (updateWebhookDto.hasOwnProperty('name')) {
      webhookSubscription.name = this.normalizeName(updateWebhookDto.name)
    }

    if (updateWebhookDto.hasOwnProperty('deliveryUrl')) {
      this.validateDeliveryUrl(updateWebhookDto.deliveryUrl)
      webhookSubscription.deliveryUrl = updateWebhookDto.deliveryUrl
    }

    // if there is a valid uuid signing secret, update it
    if (
      updateWebhookDto.hasOwnProperty('signingSecret') &&
      updateWebhookDto.signingSecret.length < 20
    ) {
      throw new HttpException('Invalid signing secret', HttpStatus.BAD_REQUEST)
    } else if (updateWebhookDto.hasOwnProperty('signingSecret')) {
      webhookSubscription.signingSecret = updateWebhookDto.signingSecret
    }

    if (
      updateWebhookDto.hasOwnProperty('events') &&
      updateWebhookDto.events.length === 0
    ) {
      throw new HttpException(
        'Choose atleast one event to receive',
        HttpStatus.BAD_REQUEST,
      )
    } else if (updateWebhookDto.hasOwnProperty('events')) {
      if (
        !updateWebhookDto.events.every((event: string) =>
          Object.values(WebhookEvent).includes(event as WebhookEvent),
        )
      ) {
        throw new HttpException('Invalid event type', HttpStatus.BAD_REQUEST)
      }
      webhookSubscription.events = updateWebhookDto.events
    }
    await webhookSubscription.save()

    return webhookSubscription
  }

  async remove({ user, webhookId }) {
    const result = await this.webhookSubscriptionModel.updateOne(
      {
        _id: webhookId,
        user: user._id,
        deletedAt: null,
      },
      {
        $set: { deletedAt: new Date(), isActive: false },
      },
    )

    if (result.matchedCount === 0) {
      throw new HttpException('Subscription not found', HttpStatus.NOT_FOUND)
    }

    return { success: true }
  }

  private normalizeName(name?: string): string | undefined {
    if (typeof name !== 'string') return undefined
    const trimmed = name.trim()
    if (!trimmed) return undefined
    return trimmed.slice(0, 64)
  }

  private getMaxWebhooksPerUser(): number {
    const raw = parseInt(process.env.MAX_WEBHOOKS_PER_USER ?? '5', 10)
    if (Number.isNaN(raw) || raw < 1) return 5
    // Hard upper bound to keep fan-out cost predictable.
    return Math.min(raw, 25)
  }

  private validateDeliveryUrl(deliveryUrl: string): void {
    let parsed: URL
    try {
      parsed = new URL(deliveryUrl)
    } catch (e) {
      throw new HttpException('Invalid delivery URL', HttpStatus.BAD_REQUEST)
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpException(
        'Delivery URL must use http or https',
        HttpStatus.BAD_REQUEST,
      )
    }

    if (this.isPrivateOrLoopbackHost(parsed.hostname)) {
      throw new HttpException(
        'Delivery URL host is not allowed',
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  private isPrivateOrLoopbackHost(rawHost: string): boolean {
    if (!rawHost) return true
    const host = rawHost.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')

    // Allow the bypass to be opted out for local development / self-hosting.
    if (process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS === 'true') {
      return false
    }

    if (host === 'localhost' || host.endsWith('.localhost')) return true
    if (host === 'broadcasthost') return true

    return this.isBlockedIpAddress(host)
  }

  // Returns false for anything that is not an IP literal.
  private isBlockedIpAddress(rawIp: string): boolean {
    const ip = rawIp.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
    const family = isIP(ip)
    if (family === 0) return false
    return blockedAddresses.check(ip, family === 6 ? 'ipv6' : 'ipv4')
  }

  // Checks every resolved address at connect time, including redirects.
  private readonly guardedLookup: LookupFunction = (
    hostname,
    options,
    callback,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      ...args: any[]
    ) => void
    const opts = typeof options === 'object' && options ? options : {}

    dnsLookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err)
      const list = Array.isArray(addresses) ? addresses : [addresses]
      if (process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS !== 'true') {
        for (const a of list) {
          if (this.isBlockedIpAddress(a.address)) {
            return cb(
              new Error('Delivery URL resolves to a disallowed address'),
            )
          }
        }
      }
      if (list.length === 0) return cb(new Error('Delivery URL did not resolve'))
      if (opts.all) return cb(null, list)
      cb(null, list[0].address, list[0].family)
    })
  }

  private readonly deliveryHttpAgent = new http.Agent({
    lookup: this.guardedLookup,
  })
  private readonly deliveryHttpsAgent = new https.Agent({
    lookup: this.guardedLookup,
  })

  async deliverNotification({ sms, user, event }) {
    if (!Object.values(WebhookEvent).includes(event)) {
      throw new HttpException('Invalid event type', HttpStatus.BAD_REQUEST)
    }

    const webhookSubscriptions = await this.webhookSubscriptionModel.find({
      user: user._id,
      events: { $in: [event] },
      isActive: true,
      deletedAt: null,
    })

    if (webhookSubscriptions.length === 0) {
      return
    }

    // A repeated status report must not notify the same endpoint twice.
    // UNKNOWN_STATE covers several different statuses, so each one still goes out.
    const alreadyNotified = new Set(
      event === WebhookEvent.UNKNOWN_STATE
        ? []
        : (
            await this.webhookNotificationModel.distinct('webhookSubscription', {
              sms: sms._id,
              event,
              webhookSubscription: {
                $in: webhookSubscriptions.map((s) => s._id),
              },
              deliveryAttemptAbortedAt: null,
            })
          ).map(String),
    )
    const pending = webhookSubscriptions.filter(
      (subscription) => !alreadyNotified.has(String(subscription._id)),
    )

    // Fan out: one notification + one queue job per matching subscription.
    // Use allSettled so a single failed enqueue does not block the others.
    const results = await Promise.allSettled(
      pending.map((subscription) =>
        this.createAndEnqueueNotification({ subscription, sms, event }),
      ),
    )

    for (const result of results) {
      if (result.status === 'rejected') {
        console.log(
          `Failed to fan-out webhook notification for user ${user._id}, event ${event}:`,
          result.reason,
        )
      }
    }
  }

  private async createAndEnqueueNotification({
    subscription,
    sms,
    event,
  }: {
    subscription: WebhookSubscriptionDocument
    sms: SMS
    event: WebhookEvent
  }) {
    const idempotencyKey = crypto.randomUUID()
    const deliveryUrlSnapshot = subscription.deliveryUrl

    let payload: Record<string, any> = {
      smsId: sms._id,
      message: sms.message,
      deviceId: sms.device,
      webhookSubscriptionId: subscription._id,
      webhookEvent: event,
      idempotencyKey,
    }

    switch (event) {
      case WebhookEvent.MESSAGE_RECEIVED:
        payload = {
          ...payload,
          sender: sms.sender,
          receivedAt: sms.receivedAt,
        }
        break

      case WebhookEvent.MESSAGE_DELIVERED:
        payload = {
          ...payload,
          smsBatchId: sms.smsBatch,
          status: sms.status,
          recipient: sms.recipient,
          sentAt: sms.sentAt,
          deliveredAt: sms.deliveredAt,
        }
        break

      case WebhookEvent.MESSAGE_SENT:
        payload = {
          ...payload,
          smsBatchId: sms.smsBatch,
          status: sms.status,
          recipient: sms.recipient,
          sentAt: sms.sentAt,
        }
        break

      case WebhookEvent.MESSAGE_FAILED:
        payload = {
          ...payload,
          smsBatchId: sms.smsBatch,
          status: sms.status,
          recipient: sms.recipient,
          errorCode: sms.errorCode,
          errorMessage: sms.errorMessage,
          failedAt: sms.failedAt,
        }
        break

      case WebhookEvent.UNKNOWN_STATE:
        payload = {
          ...payload,
          smsBatchId: sms.smsBatch,
          status: sms.status,
          recipient: sms.recipient,
        }
        break
    }

    // Absent until the phone reports it, so older apps keep the old payload
    const simUsed = resolveSimUsedReport({ simUsed: sms.simUsed })
    if (simUsed) {
      payload.simUsed = simUsed
    }

    const webhookNotification = await this.webhookNotificationModel.create({
      webhookSubscription: subscription._id,
      event,
      payload,
      sms,
      idempotencyKey,
      deliveryUrl: deliveryUrlSnapshot,
    })

    try {
      await this.webhookQueueService.addWebhookDeliveryJob(
        webhookNotification._id.toString(),
      )
    } catch (error) {
      // Due now, so the retry cron picks it up instead of it staying pending forever.
      await this.webhookNotificationModel
        .updateOne(
          { _id: webhookNotification._id },
          { $set: { nextDeliveryAttemptAt: new Date() } },
        )
        .catch(() => undefined)
      throw error
    }
  }

  async attemptWebhookDelivery(notificationId: string) {
    const now = new Date()
    // Claims the notification so a duplicate or stale job cannot send it again.
    const webhookNotification =
      await this.webhookNotificationModel.findOneAndUpdate(
        {
          _id: notificationId,
          deliveredAt: null,
          deliveryAttemptAbortedAt: null,
          $or: [
            { nextDeliveryAttemptAt: null },
            { nextDeliveryAttemptAt: { $lte: now } },
          ],
        },
        {
          $set: {
            nextDeliveryAttemptAt: new Date(
              now.getTime() + DELIVERY_CLAIM_MS,
            ),
          },
        },
        { new: true },
      )

    if (!webhookNotification) {
      console.log(
        `Webhook notification ${notificationId} is missing, delivered, aborted, or not due, skipping`,
      )
      return
    }

    const wsRef = webhookNotification.webhookSubscription
    const webhookSubscriptionId =
      wsRef instanceof Types.ObjectId ? wsRef : wsRef._id!
    const webhookSubscription = await this.webhookSubscriptionModel.findById(
      webhookSubscriptionId,
    )

    if (!webhookSubscription) {
      webhookNotification.deliveryAttemptAbortedAt = now
      await webhookNotification.save()
      console.log(`Webhook subscription not found for ${webhookSubscriptionId}`)
      return
    }

    if (!webhookSubscription.isActive || webhookSubscription.deletedAt) {
      webhookNotification.deliveryAttemptAbortedAt = now
      await webhookNotification.save()
      console.log(
        `Webhook subscription is not deliverable for ${webhookNotification._id} (active=${webhookSubscription.isActive}, deleted=${!!webhookSubscription.deletedAt}), aborting delivery`,
      )
      return
    }

    const deliveryUrl = webhookSubscription?.deliveryUrl
    const signingSecret = webhookSubscription?.signingSecret

    const signature = crypto
      .createHmac('sha256', signingSecret)
      .update(JSON.stringify(webhookNotification.payload))
      .digest('hex')

    let httpStatusCode: number | undefined
    let responseBody: string | undefined
    let errorType: 'retryable' | 'non-retryable' | undefined

    const deliveryTimeoutMs = Math.min(
      60000,
      Math.max(10000, parseInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_MS ?? '30000', 10) || 30000),
    )

    try {
      // IP-literal hosts skip the agent lookup, so re-check them here.
      this.validateDeliveryUrl(deliveryUrl)

      const response = await axios.post(deliveryUrl, webhookNotification.payload, {
        headers: {
          'X-Signature': signature,
        },
        timeout: deliveryTimeoutMs,
        maxRedirects: 5,
        // Redirects to IP literals skip the agent lookup, so check each hop here.
        beforeRedirect: (options: { hostname?: string }) => {
          if (this.isPrivateOrLoopbackHost(options.hostname ?? '')) {
            throw new Error('Delivery redirect points to a disallowed host')
          }
        },
        proxy: false,
        httpAgent: this.deliveryHttpAgent,
        httpsAgent: this.deliveryHttpsAgent,
      })

      httpStatusCode = response.status
      responseBody = typeof response.data === 'string' 
        ? response.data.substring(0, 1000)
        : JSON.stringify(response.data).substring(0, 1000)

      webhookNotification.deliveryAttemptCount += 1
      webhookNotification.lastDeliveryAttemptAt = now
      webhookNotification.nextDeliveryAttemptAt = this.getNextDeliveryAttemptAt(
        webhookNotification.deliveryAttemptCount,
      )
      webhookNotification.deliveredAt = now
      webhookNotification.httpStatusCode = httpStatusCode
      webhookNotification.responseBody = responseBody
      await webhookNotification.save()

      await this.webhookSubscriptionModel.updateOne(
        { _id: webhookSubscription._id },
        {
          $inc: { successfulDeliveryCount: 1, deliveryAttemptCount: 1 },
          $set: { lastDeliverySuccessAt: now },
        },
      )
    } catch (e) {
      // Classify error type
      if (e.response?.status) {
        httpStatusCode = e.response.status
        responseBody = typeof e.response.data === 'string'
          ? e.response.data.substring(0, 1000)
          : JSON.stringify(e.response.data || {}).substring(0, 1000)

        // 3xx (redirect not followed) and 4xx are non-retryable, 5xx are retryable
        if (e.response.status < 500) {
          errorType = 'non-retryable'
        } else {
          errorType = 'retryable'
        }
      } else {
        // Network/timeout errors are retryable
        errorType = 'retryable'
        responseBody = e.message?.substring(0, 1000)
      }

      webhookNotification.deliveryAttemptCount += 1
      webhookNotification.lastDeliveryAttemptAt = now
      webhookNotification.httpStatusCode = httpStatusCode
      webhookNotification.responseBody = responseBody
      webhookNotification.errorType = errorType

      // For 4xx errors, mark as abandoned after 3rd attempt
      if (errorType === 'non-retryable' && webhookNotification.deliveryAttemptCount >= 3) {
        webhookNotification.deliveryAttemptAbortedAt = now
        webhookNotification.nextDeliveryAttemptAt = undefined
      } else if (webhookNotification.deliveryAttemptCount < 10) {
        // Retryable errors, and 4xx before the 3rd attempt, schedule the next attempt
        webhookNotification.nextDeliveryAttemptAt = this.getNextDeliveryAttemptAt(
          webhookNotification.deliveryAttemptCount,
        )
      } else {
        // Max attempts reached
        webhookNotification.deliveryAttemptAbortedAt = now
        webhookNotification.nextDeliveryAttemptAt = undefined
      }

      await webhookNotification.save()

      await this.webhookSubscriptionModel.updateOne(
        { _id: webhookSubscription._id },
        {
          $inc: { deliveryFailureCount: 1, deliveryAttemptCount: 1 },
          $set: { lastDeliveryFailureAt: now },
        },
      )

      console.log(
        `Failed to deliver webhook notification: ID ${webhookNotification._id}, status code: ${httpStatusCode}, error type: ${errorType}, message: ${e.message}`,
      )
    }
  }

  private getNextDeliveryAttemptAt(deliveryAttemptCount: number): Date {
    // Delays in minutes after a failed delivery attempt
    const delaySequence = [
      3, // 3 minutes
      5, // 5 minutes
      30, // 30 minutes
      60, // 1 hour
      360, // 6 hours
      1440, // 1 day
      4320, // 3 days
      10080, // 7 days
      43200, // 30 days
    ]

    // Get the delay in minutes (use last value if attempt count exceeds sequence length)
    const delayInMinutes =
      delaySequence[
        Math.min(deliveryAttemptCount - 1, delaySequence.length - 1)
      ] || delaySequence[delaySequence.length - 1]

    // Convert minutes to milliseconds and add to current time
    return new Date(Date.now() + delayInMinutes * 60 * 1000)
  }

  // Check for notifications that need to be delivered every 5 minutes
  @Cron('0 */5 * * * *')
  async checkForNotificationsToDeliver() {
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Mark notifications older than one month as aborted so they are no longer retried
    await this.webhookNotificationModel.updateMany(
      {
        nextDeliveryAttemptAt: { $lte: fiveMinutesAgo },
        deliveredAt: null,
        deliveryAttemptCount: { $lt: 10 },
        deliveryAttemptAbortedAt: null,
        createdAt: { $lt: oneMonthAgo },
      },
      { $set: { deliveryAttemptAbortedAt: now } },
    )

    const notifications = await this.webhookNotificationModel
      .find({
        nextDeliveryAttemptAt: { $lte: fiveMinutesAgo },
        deliveredAt: null,
        deliveryAttemptCount: { $lt: 10 },
        deliveryAttemptAbortedAt: null,
        createdAt: { $gte: oneMonthAgo },
      })
      .sort({ nextDeliveryAttemptAt: 1 })
      .limit(200)

    if (notifications.length === 0) {
      return
    }

    console.log(`Queueing ${notifications.length} webhook notifications for retry`)

    for (const notification of notifications) {
      await this.webhookQueueService.addWebhookDeliveryJob(
        notification._id.toString(),
      )
    }
  }

  private getAutoDisableConfig(): {
    threshold: number
    lookbackDays: number
    minFailureRate: number
  } {
    const threshold = Math.max(
      1,
      parseInt(process.env.WEBHOOK_AUTO_DISABLE_FAILURE_THRESHOLD ?? '50', 10) || 50,
    )
    const lookbackDays = Math.max(
      1,
      Math.min(
        365,
        parseInt(process.env.WEBHOOK_AUTO_DISABLE_LOOKBACK_DAYS ?? '30', 10) || 30,
      ),
    )
    const minFailureRate = Math.min(
      1,
      Math.max(
        0.01,
        parseFloat(process.env.WEBHOOK_AUTO_DISABLE_MIN_FAILURE_RATE ?? '0.50') || 0.5,
      ),
    )
    return { threshold, lookbackDays, minFailureRate }
  }

  @Cron('0 6 * * *')
  async autoDisableSubscriptionsWithHighFailureRate() {
    const { threshold, lookbackDays, minFailureRate } = this.getAutoDisableConfig()
    const now = new Date()
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const graceHours = Math.max(
      0,
      // Default: 30 days
      parseInt(process.env.WEBHOOK_AUTO_DISABLE_GRACE_HOURS ?? '720', 10) || 720,
    )
    const graceSince = new Date(now.getTime() - graceHours * 60 * 60 * 1000)

    const subscriptionCounts = await this.webhookNotificationModel.aggregate<{
      _id: mongoose.Types.ObjectId
      count: number
    }>([
      {
        $addFields: {
          _finalizedAt: {
            $ifNull: ['$lastDeliveryAttemptAt', '$createdAt'],
          },
        },
      },
      {
        $match: {
          deliveredAt: null,
          _finalizedAt: { $gte: since },
          $or: [
            { deliveryAttemptAbortedAt: { $ne: null } },
            { deliveryAttemptCount: { $gte: 10 } },
          ],
        },
      },
      { $group: { _id: '$webhookSubscription', count: { $sum: 1 } } },
      { $match: { count: { $gte: threshold } } },
    ])

    if (subscriptionCounts.length === 0) {
      return
    }

    const subscriptionIds = subscriptionCounts.map((s) => s._id)
    const failureCountBySubscriptionId = new Map(
      subscriptionCounts.map((s) => [s._id.toString(), s.count]),
    )

    const successCounts = await this.webhookNotificationModel.aggregate<{
      _id: mongoose.Types.ObjectId
      count: number
    }>([
      {
        $match: {
          webhookSubscription: { $in: subscriptionIds },
          deliveredAt: { $ne: null, $gte: since },
        },
      },
      { $group: { _id: '$webhookSubscription', count: { $sum: 1 } } },
    ])
    const successCountBySubscriptionId = new Map(
      successCounts.map((s) => [s._id.toString(), s.count]),
    )

    const subscriptionsToDisable: { subscriptionId: string; failureCount: number; successCount: number; totalAttempts: number; failureRatePercent: number }[] = []
    for (const s of subscriptionCounts) {
      const sid = s._id.toString()
      const failureCount = failureCountBySubscriptionId.get(sid) ?? 0
      const successCount = successCountBySubscriptionId.get(sid) ?? 0
      const totalAttempts = failureCount + successCount
      const failureRate = totalAttempts > 0 ? failureCount / totalAttempts : 0
      if (failureRate >= minFailureRate) {
        const failureRatePercent = Math.round(failureRate * 100)
        subscriptionsToDisable.push({
          subscriptionId: sid,
          failureCount,
          successCount,
          totalAttempts,
          failureRatePercent,
        })
      }
    }

    if (subscriptionsToDisable.length === 0) {
      return
    }

    const subscriptionIdSet = new Set(subscriptionsToDisable.map((s) => s.subscriptionId))
    const activeSubscriptions = await this.webhookSubscriptionModel.find({
      _id: { $in: subscriptionIds.filter((id) => subscriptionIdSet.has(id.toString())) },
      isActive: true,
      deletedAt: null,
    })

    const ctaUrlBase = process.env.FRONTEND_URL || 'https://app.textbee.dev'
    const disabledInThisRun: {
      subscriptionId: string
      deliveryUrl: string
      failureCount: number
      successCount: number
      totalAttempts: number
      failureRatePercent: number
      lookbackDays: number
      userName: string
      userEmail: string
    }[] = []

    for (const subscription of activeSubscriptions) {
      const stats = subscriptionsToDisable.find(
        (s) => s.subscriptionId === subscription._id.toString(),
      )
      if (!stats) continue

      if (graceHours > 0 && subscription?.lastEnabledAt >= graceSince) {
        continue
      }

      if (subscription?.lastDeliverySuccessAt >= twentyFourHoursAgo) {
        continue
      }

      const { failureCount, successCount, totalAttempts, failureRatePercent } = stats
      const noteText = `Auto-disabled: ${failureCount} failed and ${successCount} succeeded (${totalAttempts} total) in the last ${lookbackDays} days — failure rate ${failureRatePercent}%. Re-enable in dashboard when your endpoint is ready.`
      const noteEntry = { at: new Date(), text: noteText }

      const result = await this.webhookSubscriptionModel.updateOne(
        { _id: subscription._id, isActive: true, deletedAt: null },
        {
          $set: { isActive: false },
          $push: { notes: noteEntry },
        },
      )

      if (result.modifiedCount === 0) {
        continue
      }

      const user = await this.usersService.findOne({
        _id: subscription.user,
      })

      disabledInThisRun.push({
        subscriptionId: subscription._id.toString(),
        deliveryUrl: subscription.deliveryUrl ?? '',
        failureCount,
        successCount,
        totalAttempts,
        failureRatePercent,
        lookbackDays,
        userName: user?.name ?? '—',
        userEmail: user?.email ?? '—',
      })

      if (!user?.email) {
        console.log(
          `Webhook subscription ${subscription._id} auto-disabled but no user/email to notify`,
        )
        continue
      }
      if (skipReason(user, false)) {
        console.log(
          `Webhook subscription ${subscription._id} auto-disabled, owner is banned or pending deletion`,
        )
        continue
      }

      try {
        await this.mailService.sendEmailFromTemplate({
          to: user.email,
          subject: 'Your webhook was paused – textbee',
          template: 'webhook-subscription-disabled',
          context: {
            name: firstName(user.name),
            title: 'Your webhook was paused',
            subscriptionName: subscription.name ?? '',
            deliveryUrl: subscription.deliveryUrl ?? '',
            failureCount,
            successCount,
            totalAttempts,
            failureRatePercent,
            lookbackDays,
            ctaUrl: `${ctaUrlBase}/dashboard/account`,
            ctaLabel: 'Re-enable in dashboard',
          },
        }, {
          userId: user._id,
          category: 'webhook',
          meta: { webhookSubscriptionId: subscription._id },
          redactContextKeys: ['deliveryUrl'],
        })
      } catch (e) {
        console.log(
          `Failed to send webhook-disabled email to ${user.email}:`,
          e,
        )
      }
    }

    const adminEmail = process.env.ADMIN_EMAIL
    if (disabledInThisRun.length > 0 && adminEmail) {
      const runAt = now.toISOString()
      try {
        await this.mailService.sendEmailFromTemplate({
          to: adminEmail,
          subject: `Webhook auto-disable: ${disabledInThisRun.length} subscription(s) – ${runAt.slice(0, 10)}`,
          template: 'webhook-auto-disable-admin-summary',
          context: {
            title: 'Webhook auto-disable summary',
            runAt,
            count: disabledInThisRun.length,
            rows: disabledInThisRun.map((d) => ({
              id: d.subscriptionId,
              deliveryUrl: redactDeliveryUrl(d.deliveryUrl),
              failed: d.failureCount,
              total: d.totalAttempts,
              failureRate: d.failureRatePercent,
            })),
          },
        }, {
          category: 'webhook',
          meta: {
            webhookSubscriptionIds: disabledInThisRun.map((d) => d.subscriptionId),
          },
        })
      } catch (e) {
        console.log(`Failed to send webhook auto-disable admin summary to ${adminEmail}:`, e)
      }
    }
  }
}
