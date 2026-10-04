import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { PAID_MONTHLY_LIMIT_MULTIPLIER } from '../billing/billing.service'
import { Plan, PlanDocument } from '../billing/schemas/plan.schema'
import {
  Subscription,
  SubscriptionDocument,
} from '../billing/schemas/subscription.schema'
import { Device, DeviceDocument } from '../gateway/schemas/device.schema'
import { SMS, SMSDocument } from '../gateway/schemas/sms.schema'
import { loadSmsPermissionStatus } from '../gateway/sms-permission-status'
import { User, UserDocument } from '../users/schemas/user.schema'
import { EvaluationContext } from './rules/types'
import {
  allowancePercent,
  billingPeriod,
  dailyWindowStart,
  periodAnchor,
} from './rules/usage-window'
import { NotificationSettings } from './schemas/notification-settings.schema'

// The resolver half of the attribute registry. The same attributes are resolved
// attributes from the same stored data, so its preview cannot disagree with what
// this feed serves.
//
// Four groups cost a query, and each is loaded only when some active audience
// actually asks for it. Most campaigns target plan and tenure, which are already
// on the user document the auth guard loaded, so the common feed adds no reads
// at all.

const DAY_MS = 24 * 60 * 60 * 1000

const daysSince = (value: Date | null | undefined, now: Date): number | undefined =>
  value ? Math.floor((now.getTime() - new Date(value).getTime()) / DAY_MS) : undefined

const daysUntil = (value: Date | null | undefined, now: Date): number | undefined =>
  value ? Math.floor((new Date(value).getTime() - now.getTime()) / DAY_MS) : undefined

const groupOf = (key: string): string => key.split('.')[0]

export interface BuildContextInput {
  user: UserDocument
  settings: Pick<NotificationSettings, 'latestAppVersionCode'>
  now: Date
  /** Attribute keys mentioned by the candidates being evaluated. */
  referenced: Iterable<string>
}

interface EffectiveLimits {
  monthlyAllowance?: number
  dailyAllowance?: number
  monthlyPeriodStart: Date
}

@Injectable()
export class NotificationContextLoader {
  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(Plan.name) private readonly planModel: Model<PlanDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(SMS.name) private readonly smsModel: Model<SMSDocument>,
    @InjectModel(Device.name)
    private readonly deviceModel: Model<DeviceDocument>,
  ) {}

  async build(input: BuildContextInput): Promise<EvaluationContext> {
    const { user, settings, now } = input
    const referenced = new Set(input.referenced)
    const groups = new Set([...referenced].map(groupOf))

    const needsSubscription = groups.has('subscription') || groups.has('usage')
    const needsUsage = groups.has('usage')
    const needsWaiver = referenced.has('user.verificationWaived')
    const needsSending = groups.has('sending')

    let context: EvaluationContext = {
      ...this.userContext(user, now),
      ...this.clientContext(user, now),
      ...this.onboardingContext(user),
      ...this.milestonesContext(user, now),
      ...this.statsContext(user, settings),
    }

    if (needsWaiver) {
      context['user.verificationWaived'] = await this.verificationWaived(
        user._id,
      )
    }

    if (needsSending) {
      context = { ...context, ...(await this.sendingContext(user._id, now)) }
    }

    if (needsSubscription) {
      const { context: subscriptionContext, limits } =
        await this.subscriptionContext(user, now)
      context = { ...context, ...subscriptionContext }

      if (needsUsage) {
        context = {
          ...context,
          ...(await this.usageContext(user._id, now, limits)),
        }
      }
    }

    return context
  }

  private userContext(user: UserDocument, now: Date): EvaluationContext {
    return {
      'user.accountAgeDays': daysSince((user as any).createdAt, now),
      // A real boolean, not the raw date. Unverified accounts have no date at
      // all rather than a null one, which is exactly why the original
      // verification gate never fired for anybody.
      'user.emailVerified': Boolean(user.emailVerifiedAt),
      'user.country': user.signupCountry ?? undefined,
      'user.accessCountries': user.access?.countries ?? [],
      'user.signupSource': user.signupSource ?? undefined,
      'user.signupDevice': user.signupDevice ?? undefined,
      'user.marketingOptIn': Boolean(user.marketingOptIn),
      'user.daysSinceLastLogin': daysSince(user.lastLoginAt, now),
      'user.deletionRequested': Boolean(user.accountDeletionRequestedAt),
      'user.role': user.role ?? undefined,
      'user.isBanned': Boolean(user.isBanned),
    }
  }

  private clientContext(user: UserDocument, now: Date): EvaluationContext {
    // client.last only fills in over time, so a recent account may have nothing
    // but its signup client.
    const client = user.client?.last ?? user.client?.signup
    return {
      'client.os': client?.os ?? undefined,
      'client.browser': client?.browser ?? undefined,
      'client.device': client?.device ?? undefined,
      'client.daysSinceLastSeen': daysSince(user.client?.last?.at, now),
    }
  }

  private onboardingContext(user: UserDocument): EvaluationContext {
    return {
      'onboarding.completed': Boolean(user.onboarding?.completedAt),
      'onboarding.currentStepId': user.onboarding?.currentStepId ?? undefined,
    }
  }

  private milestonesContext(user: UserDocument, now: Date): EvaluationContext {
    // These were added in September 2026 and not backfilled, so an older
    // account reads as never having reached a step it in fact reached. The
    // backfill in user-rollup.service fills them in; until it has run for an
    // account, treat milestone targeting as unreliable rather than wrong.
    const milestones = user.milestones
    return {
      'milestones.hasDevice': Boolean(milestones?.firstDeviceAt),
      'milestones.hasApiKey': Boolean(milestones?.firstApiKeyAt),
      // Backed by the rollup as well as the milestone, so this one boolean is
      // trustworthy even for an account the milestone backfill has not reached.
      // The rollup half only counts once it has been computed.
      'milestones.hasSentSms':
        Boolean(milestones?.firstSmsAt) ||
        (Boolean(user.rollup?.computedAt) &&
          (user.rollup?.totalSentSms ?? 0) > 0),
      'milestones.hasPaid': Boolean(milestones?.firstPaidAt),
      'milestones.daysSinceFirstSms': daysSince(milestones?.firstSmsAt, now),
    }
  }

  private statsContext(
    user: UserDocument,
    settings: Pick<NotificationSettings, 'latestAppVersionCode'>,
  ): EvaluationContext {
    // Straight off the rollup. Deriving these here instead would mean scanning
    // every device document on every dashboard load.
    const rollup = user.rollup
    // Nothing here is trusted until the rollup has actually been computed.
    // Without this gate an account nobody has measured reads as owning zero
    // devices, which is a targetable fact rather than an absence, and campaigns
    // aimed at "no devices yet" would go to the whole unmeasured population.
    const measured = Boolean(rollup?.computedAt)
    const oldest = rollup?.minAppVersionCode
    const latest = settings.latestAppVersionCode

    return {
      'stats.deviceCount': measured ? rollup.deviceCount : undefined,
      'stats.apiKeyCount': measured ? rollup.apiKeyCount : undefined,
      'stats.totalSentSms': measured ? rollup.totalSentSms : undefined,
      'stats.hasOutdatedApp':
        !measured ||
        oldest === undefined ||
        oldest === null ||
        latest === undefined ||
        latest === null
          ? undefined
          : oldest < latest,
    }
  }

  private async subscriptionContext(
    user: UserDocument,
    now: Date,
  ): Promise<{ context: EvaluationContext; limits: EffectiveLimits }> {
    const subscription = await this.subscriptionModel
      .findOne({ user: user._id, isActive: true })
      .populate('plan')
      .lean()

    // An account with no subscription row is on free and active, which is how
    // the rest of the app already treats it.
    const plan: any = subscription?.plan
      ? subscription.plan
      : await this.planModel.findOne({ name: 'free' }).lean()

    const planName: string | undefined = plan?.name
    const isPaid = Boolean(
      planName && planName !== 'free' && (plan?.monthlyPrice ?? 0) > 0,
    )

    // Custom overrides on the subscription win over the plan's own limits.
    const monthlyLimit = subscription?.customMonthlyLimit ?? plan?.monthlyLimit
    const dailyLimit = subscription?.customDailyLimit ?? plan?.dailyLimit

    // Paid plans may run a little past the nominal monthly limit before sends
    // are refused, so measuring against the plain limit would report 100% while
    // sending still works. That mismatch is the thing these alerts exist to
    // stop getting wrong.
    const monthlyAllowance =
      isPaid && typeof monthlyLimit === 'number' && monthlyLimit > 0
        ? Math.floor(monthlyLimit * PAID_MONTHLY_LIMIT_MULTIPLIER)
        : monthlyLimit

    const anchor =
      periodAnchor({
        signupAt: (user as any).createdAt ?? user._id.getTimestamp(),
        subscription: subscription
          ? {
              planName,
              subscriptionStartDate: subscription.subscriptionStartDate,
              createdAt: (subscription as any).createdAt,
            }
          : null,
      }) ?? now

    return {
      context: {
        'subscription.planName': planName ?? undefined,
        'subscription.isPaid': isPaid,
        'subscription.status': subscription?.status ?? 'active',
        'subscription.cancelAtPeriodEnd': Boolean(
          subscription?.cancelAtPeriodEnd,
        ),
        'subscription.daysUntilPeriodEnd': daysUntil(
          subscription?.currentPeriodEnd,
          now,
        ),
      },
      limits: {
        monthlyAllowance,
        dailyAllowance: dailyLimit,
        monthlyPeriodStart: billingPeriod(anchor, now).start,
      },
    }
  }

  private async usageContext(
    userId: Types.ObjectId,
    now: Date,
    limits: EffectiveLimits,
  ): Promise<EvaluationContext> {
    // Counted on demand against the same windows the quota gate uses, rather
    // than read from a stored counter. A number that disagreed with the real
    // wall would make these warnings lie.
    const [dailyCount, monthlyCount] = await Promise.all([
      this.smsModel.countDocuments({
        user: userId,
        createdAt: { $gte: dailyWindowStart(now) },
      }),
      this.smsModel.countDocuments({
        user: userId,
        createdAt: { $gte: limits.monthlyPeriodStart },
      }),
    ])

    return {
      'usage.dailyCount': dailyCount,
      'usage.monthlyCount': monthlyCount,
      'usage.dailyPercent': allowancePercent(
        dailyCount,
        limits.dailyAllowance,
      ),
      'usage.monthlyPercent': allowancePercent(
        monthlyCount,
        limits.monthlyAllowance,
      ),
    }
  }

  private async sendingContext(
    userId: Types.ObjectId,
    now: Date,
  ): Promise<EvaluationContext> {
    const status = await loadSmsPermissionStatus(
      this.smsModel,
      this.deviceModel,
      userId,
      now,
    )
    return {
      'sending.needsSmsPermission': status.needsSmsPermission ?? undefined,
      'sending.hoursSinceLastPermissionFailure':
        status.hoursSinceFailure ?? undefined,
    }
  }

  private async verificationWaived(userId: Types.ObjectId): Promise<boolean> {
    // select:false, so it needs asking for explicitly. This is the field the
    // dashboard can never see, which is why the old banner ignored it.
    const record = await this.userModel
      .findById(userId)
      .select('+emailVerificationWaivedAt')
      .lean()
    return Boolean((record as any)?.emailVerificationWaivedAt)
  }
}
