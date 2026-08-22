import { Injectable } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { MailService } from '../mail/mail.service'
import { buildEmailContent, subjectForType } from './notification-content'
import {
  BillingNotification,
  BillingNotificationDocument,
} from './schemas/billing-notification.schema'
import { User, UserDocument } from '../users/schemas/user.schema'

@Injectable()
export class BillingNotificationsListener {
  constructor(
    private readonly mailService: MailService,
    @InjectModel(BillingNotification.name)
    private readonly notificationModel: Model<BillingNotificationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  @OnEvent('billing.notification.created', { async: true })
  async handleCreatedEvent(payload: {
    notificationId: Types.ObjectId
    userId: Types.ObjectId
    type: string
    title: string
    message: string
    meta: Record<string, any>
    createdAt: Date
    sendEmail?: boolean
  }) {
    if (!payload?.sendEmail) {
      return
    }

    const user = await this.userModel.findById(payload.userId)
    if (!user?.email) {
      return
    }

    const subject = subjectForType(payload.type, payload.title)
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
      },
      from: undefined,
    })

    await this.notificationModel.updateOne(
      { _id: payload.notificationId },
      { $inc: { sentEmailCount: 1 }, $set: { lastEmailSentAt: new Date() } },
    )
  }

}
