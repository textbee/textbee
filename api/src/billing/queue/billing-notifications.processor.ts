import { Process, Processor } from '@nestjs/bull'
import { InjectModel } from '@nestjs/mongoose'
import { Job } from 'bull'
import { Model, Types } from 'mongoose'
import { MailService } from '../../mail/mail.service'
import { buildEmailContent, subjectForType } from '../notification-content'
import { User, UserDocument } from '../../users/schemas/user.schema'
import {
  BillingNotification,
  BillingNotificationDocument,
} from '../schemas/billing-notification.schema'

@Processor('billing-notifications')
export class BillingNotificationsProcessor {
  constructor(
    private readonly mailService: MailService,
    @InjectModel(BillingNotification.name)
    private readonly notificationModel: Model<BillingNotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @Process({ name: 'send', concurrency: 1 })
  async handleSend(job: Job<{
    notificationId: Types.ObjectId
    userId: Types.ObjectId
    type: string
    title: string
    message: string
    meta: Record<string, any>
    createdAt: Date
    sendEmail?: boolean
  }>) {
    const payload = job.data
    if (!payload?.sendEmail) {
      return
    }

    const user = await this.userModel.findById(payload.userId)
    if (!user?.email) {
      return
    }

    // Ensure we do not resend within the dedupe window
    const notif = await this.notificationModel.findById(payload.notificationId)
    if (!notif) return
    const windowMs = this.getDedupeWindowMs(payload.type as any)
    const lastSentAt = notif.lastEmailSentAt
    if (lastSentAt && lastSentAt.getTime() >= Date.now() - windowMs) {
      return
    }

    const subject = subjectForType(payload.type, payload.title)
    // The stored title and message serve the in-app list. The email builds its
    // own copy from the type and the figures already captured in meta.
    const content = buildEmailContent(
      payload.type,
      payload.meta,
      payload.title,
      payload.message,
    )

    await this.mailService.sendEmailFromTemplate({
      to: user.email,
      subject,
      template: 'billing-notification',
      context: {
        ...content,
        name: user.name?.split(' ')?.[0] || 'there',
        brandName: 'textbee.dev',
        year: new Date().getFullYear(),
      },
      from: undefined,
    })

    await this.notificationModel.updateOne(
      { _id: payload.notificationId },
      { $inc: { sentEmailCount: 1 }, $set: { lastEmailSentAt: new Date() } },
    )
  }

  private getDedupeWindowMs(type: string) {
    const map: Record<string, number> = {
      email_verification_required: 24,
      daily_limit_reached: 12,
      monthly_limit_reached: 48,
      bulk_sms_limit_reached: 12,
      daily_limit_approaching: 24,
      monthly_limit_approaching: 48,
    }
    const hours = map[type] ?? 24
    return hours * 60 * 60 * 1000
  }

}


