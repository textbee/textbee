import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import * as bcrypt from 'bcryptjs'
import { Redis } from 'ioredis'
import { Model, Types } from 'mongoose'
import { User, UserDocument } from '../users/schemas/user.schema'
import { UserRole } from '../users/user-roles.enum'
import { AuthService } from './auth.service'
import { ApiKey } from './schemas/api-key.schema'
import { ApiKeyTombstone } from './schemas/api-key-tombstone.schema'
import {
  EmailVerification,
  EmailVerificationDocument,
} from './schemas/email-verification.schema'
import {
  PasswordReset,
  PasswordResetDocument,
} from './schemas/password-reset.schema'
import {
  EmailHistory,
  EmailHistoryDocument,
} from './schemas/email-history.schema'
import {
  EmailSuppression,
  EmailSuppressionDocument,
} from '../mail/schemas/email-suppression.schema'
import { Device } from '../gateway/schemas/device.schema'
import { DeviceTombstone } from '../gateway/schemas/device-tombstone.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { SMSBatch } from '../gateway/schemas/sms-batch.schema'
import { WebhookSubscription } from '../webhook/schemas/webhook-subscription.schema'
import { Subscription } from '../billing/schemas/subscription.schema'
import { CheckoutSession } from '../billing/schemas/checkout-session.schema'
import { CheckoutAttempt } from '../billing/schemas/checkout-attempt.schema'

export type CorrectEmailIneligibleReason =
  | 'verified'
  | 'has_activity'
  | 'not_available'

export type CorrectEmailEligibility =
  | { eligible: true }
  | { eligible: false; reason: CorrectEmailIneligibleReason }

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS_PER_DAY = 10
const MAX_CHANGES_PER_DAY = 3
// Counts one attempt and starts the 24 hour window on the first one.
const COUNT_ATTEMPT =
  "local n = redis.call('incr', KEYS[1]) if redis.call('ttl', KEYS[1]) < 0 then redis.call('expire', KEYS[1], ARGV[1]) end return n"

const fail = (error: string, status: HttpStatus) =>
  new HttpException({ error }, status)

const ALREADY_VERIFIED = () =>
  fail(
    'Your email is already verified. Contact support to change it.',
    HttpStatus.FORBIDDEN,
  )
const CONTACT_SUPPORT = () =>
  fail('Contact support to change your email.', HttpStatus.FORBIDDEN)
const TOO_MANY = () =>
  fail(
    'Too many email changes. Try again tomorrow or contact support.',
    HttpStatus.TOO_MANY_REQUESTS,
  )
const IN_USE = () =>
  fail(
    'This email is already in use. Sign in with it instead.',
    HttpStatus.CONFLICT,
  )

// Lets an unverified account with no activity fix a mistyped email.
@Injectable()
export class EmailCorrectionService implements OnModuleDestroy {
  private readonly logger = new Logger(EmailCorrectionService.name)
  private redis?: Redis

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(EmailHistory.name)
    private readonly emailHistoryModel: Model<EmailHistoryDocument>,
    @InjectModel(EmailSuppression.name)
    private readonly suppressionModel: Model<EmailSuppressionDocument>,
    @InjectModel(EmailVerification.name)
    private readonly emailVerificationModel: Model<EmailVerificationDocument>,
    @InjectModel(PasswordReset.name)
    private readonly passwordResetModel: Model<PasswordResetDocument>,
    @InjectModel(Device.name) private readonly deviceModel: Model<unknown>,
    @InjectModel(ApiKey.name) private readonly apiKeyModel: Model<unknown>,
    @InjectModel(SMS.name) private readonly smsModel: Model<unknown>,
    @InjectModel(SMSBatch.name) private readonly smsBatchModel: Model<unknown>,
    @InjectModel(WebhookSubscription.name)
    private readonly webhookSubscriptionModel: Model<unknown>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<unknown>,
    @InjectModel(CheckoutSession.name)
    private readonly checkoutSessionModel: Model<unknown>,
    @InjectModel(CheckoutAttempt.name)
    private readonly checkoutAttemptModel: Model<unknown>,
    @InjectModel(DeviceTombstone.name)
    private readonly deviceTombstoneModel: Model<unknown>,
    @InjectModel(ApiKeyTombstone.name)
    private readonly apiKeyTombstoneModel: Model<unknown>,
    private readonly authService: AuthService,
  ) {}

  /** Same Redis the queues use, connected on first use. */
  protected redisClient(): Redis | null {
    if (!process.env.REDIS_URL) return null
    this.redis ??= new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      protocol: 2,
    })
    return this.redis
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined)
  }

  async eligibility(request: {
    apiKey?: unknown
    user: { _id: Types.ObjectId | string }
  }): Promise<CorrectEmailEligibility> {
    if (request.apiKey) return { eligible: false, reason: 'not_available' }
    const user = await this.loadUser(request.user._id)
    const reason = await this.ineligibleReason(user)
    return reason ? { eligible: false, reason } : { eligible: true }
  }

  async correctEmail(
    request: { apiKey?: unknown; user: { _id: Types.ObjectId | string } },
    body: { newEmail?: unknown; currentPassword?: unknown },
  ): Promise<{ message: string; email: string }> {
    if (request.apiKey) {
      throw fail('Use the dashboard to change your email.', HttpStatus.FORBIDDEN)
    }

    const { newEmail: rawEmail, currentPassword } = body ?? {}
    if (typeof rawEmail !== 'string') {
      throw fail('Invalid email', HttpStatus.BAD_REQUEST)
    }
    if (typeof currentPassword !== 'string') {
      throw fail('Your password is incorrect.', HttpStatus.BAD_REQUEST)
    }
    const newEmail = rawEmail.trim().toLowerCase()
    await this.authService.validateEmail(newEmail)

    if ((await this.countAttempt(request.user._id)) > MAX_ATTEMPTS_PER_DAY) {
      throw TOO_MANY()
    }

    const user = await this.loadUser(request.user._id)
    const reason = await this.ineligibleReason(user)
    if (reason === 'verified') throw ALREADY_VERIFIED()
    if (reason) throw CONTACT_SUPPORT()

    if (!(await bcrypt.compare(currentPassword, user.password))) {
      throw fail('Your password is incorrect.', HttpStatus.BAD_REQUEST)
    }

    if (newEmail === user.email) {
      throw fail('This is already your email.', HttpStatus.BAD_REQUEST)
    }

    const recentChanges = await this.emailHistoryModel.countDocuments({
      user: user._id,
      source: 'user',
      changedAt: { $gte: new Date(Date.now() - DAY_MS) },
    })
    if (recentChanges >= MAX_CHANGES_PER_DAY) throw TOO_MANY()

    if (await this.userModel.exists({ email: newEmail })) throw IN_USE()

    if (await this.suppressionModel.exists({ email: newEmail })) {
      throw fail(
        'We cannot deliver email to this address. Use a different email.',
        HttpStatus.BAD_REQUEST,
      )
    }

    let matched: number
    try {
      const result = await this.userModel.updateOne(
        {
          _id: user._id,
          email: user.email,
          emailVerifiedAt: null,
          emailVerificationWaivedAt: null,
        },
        { $set: { email: newEmail } },
      )
      matched = result.matchedCount
    } catch (e) {
      if (e?.code === 11000) throw IN_USE()
      throw e
    }
    if (matched === 0) {
      const current = await this.loadUser(user._id)
      if (current?.emailVerifiedAt || current?.emailVerificationWaivedAt) {
        throw ALREADY_VERIFIED()
      }
      throw fail(
        'Your email was just changed. Reload the page.',
        HttpStatus.CONFLICT,
      )
    }

    const now = new Date()
    const open = { user: user._id, expiresAt: { $gt: now } }
    await Promise.all([
      this.emailVerificationModel.updateMany(open, { $set: { expiresAt: now } }),
      this.passwordResetModel.updateMany(open, { $set: { expiresAt: now } }),
    ])

    await this.emailHistoryModel.create({
      user: user._id,
      oldEmail: user.email,
      newEmail,
      source: 'user',
      reason: 'unverified-correction',
      oldEmailVerifiedAt: null,
      changedAt: now,
    })

    let result: string | undefined
    try {
      result = await this.authService.sendVerificationLink(user, newEmail)
    } catch (e) {
      this.logger.error(`Failed to send verification email: ${e?.message ?? e}`)
    }
    if (result !== 'sent') {
      return {
        message: `Your email is now ${newEmail}. Press resend to get the verification link.`,
        email: newEmail,
      }
    }
    return {
      message: `We sent a verification link to ${newEmail}.`,
      email: newEmail,
    }
  }

  private loadUser(userId: Types.ObjectId | string) {
    return this.userModel
      .findOne({ _id: userId })
      .select('+password +emailVerificationWaivedAt')
      .lean<User & { _id: Types.ObjectId }>()
  }

  private async ineligibleReason(
    user: (User & { _id: Types.ObjectId }) | null,
  ): Promise<CorrectEmailIneligibleReason | null> {
    if (!user) return 'not_available'
    if (user.emailVerifiedAt || user.emailVerificationWaivedAt) return 'verified'
    const meta = (user.meta ?? {}) as Record<string, unknown>
    if (
      !user.password ||
      user.googleId ||
      user.isBanned ||
      user.accountDeletionRequestedAt ||
      meta.mergedInto ||
      meta.mergedFrom ||
      user.role !== UserRole.REGULAR
    ) {
      return 'not_available'
    }
    return (await this.hasActivity(user._id)) ? 'has_activity' : null
  }

  // Resolves true on the first collection with a row, without waiting for the rest.
  private hasActivity(userId: Types.ObjectId): Promise<boolean> {
    const checks: Array<[Model<unknown>, string]> = [
      [this.deviceModel, 'user'],
      [this.apiKeyModel, 'user'],
      [this.smsModel, 'user'],
      [this.smsBatchModel, 'user'],
      [this.webhookSubscriptionModel, 'user'],
      [this.subscriptionModel, 'user'],
      [this.checkoutSessionModel, 'user'],
      [this.checkoutAttemptModel, 'user'],
      [this.deviceTombstoneModel, 'userId'],
      [this.apiKeyTombstoneModel, 'userId'],
    ]
    return new Promise((resolve, reject) => {
      let pending = checks.length
      for (const [model, field] of checks) {
        Promise.resolve(model.exists({ [field]: userId })).then((found) => {
          if (found) resolve(true)
          else if (--pending === 0) resolve(false)
        }, reject)
      }
    })
  }

  // Returns the attempt number in the current window, or 0 when Redis is unavailable.
  private async countAttempt(userId: Types.ObjectId | string): Promise<number> {
    try {
      const redis = this.redisClient()
      if (!redis) return 0
      const count = await redis.eval(
        COUNT_ATTEMPT,
        1,
        `correct-email:attempts:${userId}`,
        DAY_MS / 1000,
      )
      return Number(count)
    } catch (e) {
      this.logger.warn(`Email change attempt count skipped: ${e?.message ?? e}`)
      return 0
    }
  }
}
