import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  SupportMessage,
  SupportMessageSchema,
} from './schemas/support-message.schema'
import { SupportService } from './support.service'
import { SupportController } from './support.controller'
import { UsersModule } from '../users/users.module'
import { BillingModule } from '../billing/billing.module'
import { MailModule } from '../mail/mail.module'
import { AuthModule } from '../auth/auth.module'
import { Subscription, SubscriptionSchema } from '../billing/schemas/subscription.schema'
import { CommonModule } from '../common/common.module'
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportMessage.name, schema: SupportMessageSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
    UsersModule,
    BillingModule,
    MailModule,
    AuthModule,
    CommonModule,
  ],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
