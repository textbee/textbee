import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bull'
import { WebhookController } from './webhook.controller'
import { WebhookService } from './webhook.service'
import {
  WebhookSubscription,
  WebhookSubscriptionSchema,
} from './schemas/webhook-subscription.schema'
import {
  WebhookNotification,
  WebhookNotificationSchema,
} from './schemas/webhook-notification.schema'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { MailModule } from '../mail/mail.module'
import { WebhookQueueService } from './queue/webhook-queue.service'
import { WebhookQueueProcessor } from './queue/webhook-queue.processor'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: WebhookSubscription.name,
        schema: WebhookSubscriptionSchema,
      },
      {
        name: WebhookNotification.name,
        schema: WebhookNotificationSchema,
      },
    ]),
    BullModule.registerQueue({
      name: 'webhook-delivery',
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
    AuthModule,
    UsersModule,
    MailModule,
  ],
  controllers: [WebhookController],
  providers: [WebhookService, WebhookQueueService, WebhookQueueProcessor],
  exports: [MongooseModule, WebhookService],
})
export class WebhookModule {}
