import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { Model, Types } from 'mongoose'
import {
  BillingNotification,
  BillingNotificationDocument,
  BillingNotificationType,
} from './schemas/billing-notification.schema'
import { USAGE_EMAIL_LIMITS } from './usage-emails'

type NotifyOnceInput = {
  userId: Types.ObjectId | string
  type: BillingNotificationType
  title: string
  message: string
  meta?: Record<string, any>
  /** Email template to send, or null for an in-app notice only. */
  emailKey?: string | null
  /** Record the UTC day of a daily or 30-day limit hit. */
  recordHit?: boolean
}

const HOUR_MS = 60 * 60 * 1000
const HIT_WRITE_INTERVAL_MS = 60 * 1000
export const NOTICE_REFRESH_MS = HOUR_MS
export const FAILED_EMAIL_RETRY_MS = HOUR_MS

/** True while an earlier attempt of this template still covers the notice. */
export const emailAttemptCovers = (
  doc: Pick<BillingNotification, 'lastEmailKey' | 'lastEmailAttemptAt' | 'lastEmailResult'> | null,
  emailKey: string,
  now: Date,
): boolean => {
  if (!doc?.lastEmailAttemptAt || doc.lastEmailKey !== emailKey) return false
  const wait =
    doc.lastEmailResult === 'failed'
      ? FAILED_EMAIL_RETRY_MS
      : USAGE_EMAIL_LIMITS[emailKey]?.windowMs ?? HOUR_MS
  return now.getTime() - new Date(doc.lastEmailAttemptAt).getTime() < wait
}

@Injectable()
export class BillingNotificationsService {
  constructor(
    @InjectModel(BillingNotification.name)
    private readonly notificationModel: Model<BillingNotificationDocument>,
    @InjectQueue('billing-notifications') private readonly billingQueue: Queue,
  ) {}

  async notifyOnce({
    userId,
    type,
    title,
    message,
    meta = {},
    emailKey = null,
    recordHit = false,
  }: NotifyOnceInput) {
    const user = new Types.ObjectId(userId)
    const now = new Date()
    const existing = await this.notificationModel.findOne({ user, type })

    // Changed text refreshes the in-app notice at once, the same text at most hourly.
    const refresh =
      !existing?.updatedAt ||
      existing.title !== title ||
      existing.message !== message ||
      now.getTime() - new Date(existing.updatedAt).getTime() >= NOTICE_REFRESH_MS
    const day = now.toISOString().slice(0, 10)
    const hit =
      recordHit &&
      !(
        existing?.hitDays?.includes(day) &&
        existing.lastHitAt &&
        now.getTime() - new Date(existing.lastHitAt).getTime() < HIT_WRITE_INTERVAL_MS
      )

    let doc = existing
    if (refresh || hit) {
      const update: Record<string, any> = refresh
        ? { $set: { title, message, meta }, $setOnInsert: { user, type } }
        : { $setOnInsert: { user, type, title, message, meta } }
      if (hit) {
        update.$addToSet = { hitDays: day }
        update.$set = { ...update.$set, lastHitAt: now }
      }
      doc = await this.notificationModel.findOneAndUpdate({ user, type }, update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      })
    }

    if (!emailKey || !doc || emailAttemptCovers(doc, emailKey, now)) return doc

    await this.billingQueue.add(
      'send',
      {
        notificationId: doc._id,
        userId: doc.user,
        type: doc.type,
        title: doc.title,
        message: doc.message,
        // This event's figures, even when the stored notice was not refreshed.
        meta,
        createdAt: doc.createdAt,
        sendEmail: true,
        emailKey,
      },
      {
        delay: 30000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        // one pending job per attempt; a finished job must not block the next one
        jobId: `${doc._id}:${emailKey}:${doc.lastEmailAttemptAt?.getTime() ?? 0}`,
        removeOnComplete: true,
        removeOnFail: true,
      },
    )

    return doc
  }

  async listForUser(userId: Types.ObjectId | string, { limit = 50 } = {}) {
    return this.notificationModel
      .find({ user: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
  }
}

export { BillingNotificationType }
