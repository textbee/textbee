import { Module, forwardRef } from '@nestjs/common'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { PlanSchema } from './schemas/plan.schema'
import { SubscriptionSchema } from './schemas/subscription.schema'
import { Plan } from './schemas/plan.schema'
import { Subscription } from './schemas/subscription.schema'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from 'src/auth/auth.module'
import { UsersModule } from 'src/users/users.module'
import { GatewayModule } from 'src/gateway/gateway.module'
import { MailModule } from 'src/mail/mail.module'
import { PolarWebhookPayload, PolarWebhookPayloadSchema } from './schemas/polar-webhook-payload.schema'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import { CheckoutSession, CheckoutSessionSchema } from './schemas/checkout-session.schema'
import { BillingNotification, BillingNotificationSchema } from './schemas/billing-notification.schema'
import { BillingNotificationsService } from './billing-notifications.service'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import { SentEmail, SentEmailSchema } from '../mail/schemas/sent-email.schema'
import { BullModule } from '@nestjs/bull'
import { BillingNotificationsProcessor } from 'src/billing/queue/billing-notifications.processor'

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'billing-notifications',
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
    MongooseModule.forFeature([
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: PolarWebhookPayload.name, schema: PolarWebhookPayloadSchema },
      { name: Device.name, schema: DeviceSchema },
      { name: CheckoutSession.name, schema: CheckoutSessionSchema },
      { name: BillingNotification.name, schema: BillingNotificationSchema },
      { name: SMS.name, schema: SMSSchema },
      { name: SentEmail.name, schema: SentEmailSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    forwardRef(() => GatewayModule),
    MailModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingNotificationsService, BillingNotificationsProcessor],
  exports: [BillingService, BillingNotificationsService],
})
export class BillingModule {}
