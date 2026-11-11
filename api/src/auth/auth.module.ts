import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { PassportModule } from '@nestjs/passport'
import { UsersModule } from '../users/users.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { JwtStrategy } from './jwt.strategy'
import { ApiKey, ApiKeySchema } from './schemas/api-key.schema'
import {
  ApiKeyTombstone,
  ApiKeyTombstoneSchema,
} from './schemas/api-key-tombstone.schema'
import { MailModule } from '../mail/mail.module'
import { CommonModule } from '../common/common.module'
import {
  PasswordReset,
  PasswordResetSchema,
} from './schemas/password-reset.schema'
import {
  AccessFootprint,
  AccessFootprintSchema,
} from './schemas/access-footprint.schema'
import { AccessFootprintService } from './access-footprint.service'
import {
  EmailVerification,
  EmailVerificationSchema,
} from './schemas/email-verification.schema'
import { AuthGuard } from './guards/auth.guard'
import { OptionalAuthGuard } from './guards/optional-auth.guard'
import { SentEmail, SentEmailSchema } from '../mail/schemas/sent-email.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { VerificationReminderTask } from './tasks/verification-reminder.task'
import {
  EmailHistory,
  EmailHistorySchema,
} from './schemas/email-history.schema'
import { EmailCorrectionService } from './email-correction.service'
import {
  EmailSuppression,
  EmailSuppressionSchema,
} from '../mail/schemas/email-suppression.schema'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import {
  DeviceTombstone,
  DeviceTombstoneSchema,
} from '../gateway/schemas/device-tombstone.schema'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import { SMSBatch, SMSBatchSchema } from '../gateway/schemas/sms-batch.schema'
import {
  WebhookSubscription,
  WebhookSubscriptionSchema,
} from '../webhook/schemas/webhook-subscription.schema'
import {
  Subscription,
  SubscriptionSchema,
} from '../billing/schemas/subscription.schema'
import {
  CheckoutSession,
  CheckoutSessionSchema,
} from '../billing/schemas/checkout-session.schema'
import {
  CheckoutAttempt,
  CheckoutAttemptSchema,
} from '../billing/schemas/checkout-attempt.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: ApiKey.name,
        schema: ApiKeySchema,
      },
      {
        name: ApiKeyTombstone.name,
        schema: ApiKeyTombstoneSchema,
      },
      {
        name: PasswordReset.name,
        schema: PasswordResetSchema,
      },
      {
        name: AccessFootprint.name,
        schema: AccessFootprintSchema,
      },
      {
        name: EmailVerification.name,
        schema: EmailVerificationSchema,
      },
      { name: SentEmail.name, schema: SentEmailSchema },
      { name: User.name, schema: UserSchema },
      { name: EmailHistory.name, schema: EmailHistorySchema },
      { name: EmailSuppression.name, schema: EmailSuppressionSchema },
      // Read by the email correction activity check.
      { name: Device.name, schema: DeviceSchema },
      { name: DeviceTombstone.name, schema: DeviceTombstoneSchema },
      { name: SMS.name, schema: SMSSchema },
      { name: SMSBatch.name, schema: SMSBatchSchema },
      { name: WebhookSubscription.name, schema: WebhookSubscriptionSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: CheckoutSession.name, schema: CheckoutSessionSchema },
      { name: CheckoutAttempt.name, schema: CheckoutAttemptSchema },
    ]),
    UsersModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: process.env.JWT_EXPIRATION || ('60d' as any),
      },
    }),
    MailModule,
    CommonModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessFootprintService,
    JwtStrategy,
    AuthGuard,
    OptionalAuthGuard,
    MongooseModule,
    VerificationReminderTask,
    EmailCorrectionService,
  ],
  exports: [AuthService, JwtModule, AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
