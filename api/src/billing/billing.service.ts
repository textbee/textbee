import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Plan, PlanDocument } from './schemas/plan.schema'
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema'
import {
  createPolar,
  webhooks,
  type models,
  type Polar,
} from '@polar-sh/sdk/2026-10'
import { User, UserDocument } from '../users/schemas/user.schema'
import { UsersService } from '../users/users.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { CheckoutResponseDTO, PlanDTO } from './billing.dto'
import { SMSDocument } from '../gateway/schemas/sms.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import {
  PolarWebhookPayload,
  PolarWebhookPayloadDocument,
} from './schemas/polar-webhook-payload.schema'
import {
  CheckoutSession,
  CheckoutSessionDocument,
} from './schemas/checkout-session.schema'
import {
  BillingNotificationsService,
  BillingNotificationType,
} from './billing-notifications.service'
import { resolveClientAddress } from '../common/client-address'
import {
  BillingPeriod,
  billingPeriod,
  dailyWindowStart,
  periodAnchor,
} from '../notifications/rules/usage-window'
import { usageEmailKey } from './usage-emails'
import { decideSync, ENDED_STATUSES } from './polar-subscription-sync'
import { formatDateTime, pluralize, verifyLink } from '../mail/email-render'
import {
  appPublicUrl,
  billingUrl,
  emailLinkSecret,
} from '../mail/email-links'

// Paid plans are allowed a little past their nominal monthly limit before sends
// are refused. Exported because notification targeting measures usage against
// the same effective allowance, and two copies of this number would drift.
export const PAID_MONTHLY_LIMIT_MULTIPLIER = 1.1

/** One Polar subscription state, as a webhook or an API response carries it. */
export type PolarSubscriptionSync = {
  userId?: string
  newPlanName?: string
  newPlanPolarProductId?: string
  currentPeriodStart?: Date | null
  currentPeriodEnd?: Date | null
  subscriptionStartDate?: Date | null
  status?: string
  amount?: number
  currency?: string
  recurringInterval?: string
  polarSubscriptionId?: string
  polarCustomerId?: string
  cancelAtPeriodEnd?: boolean
  /** When a scheduled cancellation takes effect. */
  endsAt?: Date | null
  endedAt?: Date | null
  modifiedAt?: Date | null
  /** The event was subscription.revoked. */
  revoked?: boolean
}

// Update fields left undefined are not written.
const defined = <T extends Record<string, any>>(fields: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>

// Polar returns timestamps as ISO strings
export const toDate = (value?: string | null): Date | null | undefined =>
  value == null ? (value as null | undefined) : new Date(value)

@Injectable()
export class BillingService {
  private polarApi: Polar

  constructor(
    @InjectModel(Plan.name) private planModel: Model<PlanDocument>,
    @InjectModel(Subscription.name)
    private subscriptionModel: Model<SubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMSDocument>,
    @InjectModel(PolarWebhookPayload.name)
    private polarWebhookPayloadModel: Model<PolarWebhookPayloadDocument>,
    @InjectModel(CheckoutSession.name)
    private checkoutSessionModel: Model<CheckoutSessionDocument>,
    private readonly billingNotifications: BillingNotificationsService,
    private readonly usersService: UsersService,
    private readonly analyticsService: AnalyticsService,
  ) {
    this.polarApi = createPolar({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
      environment:
        process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox',
    })
  }

  async getPlans(): Promise<PlanDTO[]> {
    return this.planModel.find({
      isActive: true,
    })
  }

  async getCurrentSubscription(user: any) {
    const subscription = await this.subscriptionModel
      .findOne({
        user: user._id,
        isActive: true,
      })
      .populate('plan')

    if (subscription) {
      return {
        ...subscription.toObject(),
        usage: await this.usageSummary(user, subscription, subscription.plan),
      }
    }

    const plan = await this.planModel.findOne({ name: 'free' })

    return {
      plan,
      isActive: true,
      usage: await this.usageSummary(user, null, plan),
    }
  }

  // The monthly allowance is counted over this period. See usage-window.ts.
  private usagePeriod(
    user: any,
    subscription: any,
    plan: any,
    now: Date,
  ): BillingPeriod {
    const anchor = periodAnchor({
      signupAt:
        user?.createdAt ?? new Types.ObjectId(String(user._id)).getTimestamp(),
      subscription: subscription
        ? {
            planName: plan?.name,
            subscriptionStartDate: subscription.subscriptionStartDate,
            createdAt: subscription.createdAt,
          }
        : null,
    })
    return billingPeriod(anchor ?? now, now)
  }

  private async usageSummary(user: any, subscription: any, plan: any) {
    const now = new Date()
    const period = this.usagePeriod(user, subscription, plan, now)
    const processedSmsToday = await this.smsModel.countDocuments({
      user: user._id,
      createdAt: { $gte: dailyWindowStart(now) },
    })
    const processedSmsLastMonth = await this.smsModel.countDocuments({
      user: user._id,
      createdAt: { $gte: period.start },
    })

    const { dailyLimit, monthlyLimit, bulkSendLimit, deviceLimit } =
      this.getEffectiveLimits(subscription, plan)
    const remaining = (limit: number, used: number) =>
      limit === -1 ? -1 : limit - used
    const percent = (limit: number, used: number) =>
      limit === -1 ? 0 : Math.round((used / limit) * 100)

    return {
      processedSmsToday,
      processedSmsLastMonth,
      monthlyPeriodStart: period.start,
      monthlyResetAt: period.end,
      dailyLimit,
      monthlyLimit,
      bulkSendLimit,
      deviceLimit,
      dailyRemaining: remaining(dailyLimit, processedSmsToday),
      monthlyRemaining: remaining(monthlyLimit, processedSmsLastMonth),
      dailyUsagePercentage: percent(dailyLimit, processedSmsToday),
      monthlyUsagePercentage: percent(monthlyLimit, processedSmsLastMonth),
    }
  }

  async getCheckoutUrl({
    user,
    payload,
    req,
  }: {
    user: any
    payload: any
    req: any
  }): Promise<CheckoutResponseDTO> {
    const billingInterval =
      payload.billingInterval === 'yearly' ? 'yearly' : 'monthly'

    // A user with an active paid Polar subscription must not get a new
    // checkout (it would create a second subscription and double-bill them);
    // their existing Polar subscription gets updated instead, after the
    // frontend shows a confirmation screen
    const planChange = await this.resolvePlanChange({
      user,
      planName: payload.planName,
      billingInterval,
    })

    if (planChange.isPlanChange) {
      const currentPlan = planChange.currentSubscription.plan as Plan
      return {
        planChange: {
          currentPlan: currentPlan.name,
          currentInterval:
            this.normalizeBillingInterval(
              planChange.currentSubscription.recurringInterval,
            ) ?? 'monthly',
          newPlan: planChange.selectedPlan.name,
          newInterval: billingInterval,
          isUpgrade:
            (planChange.selectedPlan.monthlyPrice ?? 0) >
            (currentPlan.monthlyPrice ?? 0),
          cancelAtPeriodEnd: !!planChange.polarSubscription.cancel_at_period_end,
        },
      }
    }

    const selectedPlan = planChange.selectedPlan

    const existingCheckoutSession = await this.checkoutSessionModel.findOne({
      user: user._id,
      expiresAt: { $gt: new Date() },
      isCompleted: { $ne: true },
      isAbandoned: { $ne: true },
    })

    // Only reuse a cached checkout created for the same plan and billing
    // interval, otherwise Polar would preselect the wrong product
    if (
      existingCheckoutSession &&
      existingCheckoutSession.planName === payload.planName &&
      existingCheckoutSession.billingInterval === billingInterval
    ) {
      return { redirectUrl: existingCheckoutSession.checkoutUrl }
    }

    // const product = await this.polarApi.products.get(selectedPlan.polarProductId)

    const discountId =
      payload.discountId ?? process.env.POLAR_DEFAULT_DISCOUNT_ID

    try {
      // Polar preselects the first product in the list, so order it by the
      // billing interval the user chose
      const orderedProductIds = (
        billingInterval === 'yearly'
          ? [selectedPlan.polarYearlyProductId, selectedPlan.polarMonthlyProductId]
          : [selectedPlan.polarMonthlyProductId, selectedPlan.polarYearlyProductId]
      ).filter(Boolean)

      // Resolved once so the billing provider and the conversion event agree
      // on who started this checkout.
      const clientAddress = resolveClientAddress(req)

      const checkoutOptions: models.CheckoutCreate = {
        products: orderedProductIds,
        success_url: `${process.env.FRONTEND_URL}/dashboard/account?checkout-success=1&checkout_id={CHECKOUT_ID}`,
        customer_email: user.email,
        customer_name: user.name,
        customer_ip_address: clientAddress.ip,
        metadata: {
          userId: user._id?.toString(),
          ...(user.signupSource && { signupSource: user.signupSource }),
          ...(user.attribution?.first?.campaign && {
            utmCampaign: user.attribution.first.campaign,
          }),
        },
        external_customer_id: user._id?.toString(),
      }

      try {
        let discount = null;
        if (discountId) {
          discount = await this.polarApi.discounts.get(discountId)
          if (discount) {
            checkoutOptions.discount_id = discount.id
          }
        }
      } catch (error) {
        console.error('failed to get discount', error)
      }

      const checkout = await this.polarApi.checkouts.create(checkoutOptions)

      this.analyticsService.checkoutStarted(user as any, payload.planName, {
        ...clientAddress,
        userAgent: req.headers?.['user-agent'],
      })

      this.checkoutSessionModel
        .updateOne(
          {
            user: user._id,
          },
          {
            $set: {
              user: user._id,
              checkoutSessionId: checkout.id,
              checkoutUrl: checkout.url,
              planName: payload.planName,
              billingInterval,
              expiresAt: new Date(checkout.expires_at),
              payload: checkout,
              sessionStartedAt: new Date(),
              isCompleted: false,
              isAbandoned: false,
            },
            $unset: { completedAt: 1 },
          },
          { upsert: true },
        )
        .catch((error) => {
          console.error(error)
        })

      return { redirectUrl: checkout.url }
    } catch (error) {
      console.error(error)
      throw new Error('Failed to create checkout')
    }
  }

  // Polar reports recurringInterval as 'month'/'year', checkout requests use
  // 'monthly'/'yearly'
  private normalizeBillingInterval(
    interval?: string,
  ): 'monthly' | 'yearly' | undefined {
    if (interval === 'month' || interval === 'monthly') return 'monthly'
    if (interval === 'year' || interval === 'yearly') return 'yearly'
    return undefined
  }

  // Decides whether a checkout request is actually a plan change on an
  // existing paid Polar subscription. Throws for requests that are valid in
  // neither path (same plan+interval, custom plans, payment issues).
  private async resolvePlanChange({
    user,
    planName,
    billingInterval,
  }: {
    user: any
    planName: string
    billingInterval: 'monthly' | 'yearly'
  }): Promise<{
    selectedPlan: PlanDocument
    isPlanChange: boolean
    currentSubscription?: SubscriptionDocument
    polarSubscription?: models.Subscription
    targetProductId?: string
  }> {
    // a missing plan name is a client bug, not an unpurchasable plan
    if (!planName || typeof planName !== 'string') {
      console.error(
        `Checkout requested without a plan name (received: ${JSON.stringify(planName)})`,
      )
      throw new BadRequestException({
        message: 'No plan was selected. Please pick a plan and try again.',
        code: 'PLAN_NAME_REQUIRED',
      })
    }

    const selectedPlan = await this.planModel.findOne({ name: planName })

    if (!selectedPlan) {
      console.error(`Checkout requested for unknown plan "${planName}"`)
      throw new BadRequestException({
        message: `Plan "${planName}" was not found.`,
        code: 'PLAN_NOT_FOUND',
      })
    }

    if (
      !selectedPlan.polarMonthlyProductId &&
      !selectedPlan.polarYearlyProductId
    ) {
      console.error(
        `Plan "${planName}" has no Polar product ids and cannot be purchased`,
      )
      throw new BadRequestException('Plan cannot be purchased')
    }

    const currentSubscription = await this.subscriptionModel
      .findOne({ user: user._id, isActive: true })
      .populate('plan')

    const currentPlan = currentSubscription?.plan as Plan | undefined
    const currentInterval = this.normalizeBillingInterval(
      currentSubscription?.recurringInterval,
    )

    if (currentPlan?.name?.startsWith('custom')) {
      throw new BadRequestException({
        message:
          'You are on a custom plan, please contact billing@textbee.dev to change your plan',
        code: 'CONTACT_BILLING',
      })
    }

    // Same plan with a different billing interval is a valid change
    // (e.g. pro monthly -> pro yearly), each interval is a separate product
    if (
      currentPlan?.name === planName &&
      (!currentInterval || currentInterval === billingInterval)
    ) {
      throw new BadRequestException({
        message: `You are already on ${planName} plan, please contact billing@textbee.dev to get a custom plan`,
        code: 'ALREADY_ON_PLAN',
      })
    }

    if (!currentPlan || currentPlan.name === 'free') {
      return { selectedPlan, isPlanChange: false, currentSubscription }
    }

    let polarSubscription: models.Subscription | null = null
    if (currentSubscription.polarSubscriptionId) {
      try {
        polarSubscription = await this.polarApi.subscriptions.get(
          currentSubscription.polarSubscriptionId,
        )
      } catch (error) {
        console.error('failed to fetch polar subscription by stored id', error)
      }
    }

    // Older subscriptions predate storing polarSubscriptionId; checkouts have
    // always set externalCustomerId to the user id, so recover it from there
    if (!polarSubscription || polarSubscription.status === 'canceled') {
      try {
        const page = await this.polarApi.subscriptions.list({
          external_customer_id: user._id.toString(),
          active: true,
          limit: 1,
        })
        polarSubscription = page?.items?.[0] ?? null

        if (polarSubscription) {
          this.subscriptionModel
            .updateOne(
              { _id: currentSubscription._id },
              {
                polarSubscriptionId: polarSubscription.id,
                polarCustomerId: polarSubscription.customer_id,
              },
            )
            .catch((error) => {
              console.error(error)
            })
        }
      } catch (error) {
        console.error('failed to list polar subscriptions', error)
      }
    }

    if (!polarSubscription) {
      // Paid subscription with no Polar record (e.g. manually granted):
      // a regular checkout is the correct path for these users
      console.warn(
        `No active polar subscription found for user ${user._id} on paid plan ${currentPlan.name}, falling back to checkout`,
      )
      return { selectedPlan, isPlanChange: false, currentSubscription }
    }

    const targetProductId =
      billingInterval === 'yearly'
        ? selectedPlan.polarYearlyProductId
        : selectedPlan.polarMonthlyProductId

    if (!targetProductId) {
      throw new BadRequestException(
        `Plan ${planName} cannot be purchased with ${billingInterval} billing`,
      )
    }

    // Catches drift between our DB and Polar
    if (polarSubscription.product_id === targetProductId) {
      throw new BadRequestException({
        message: `You are already on ${planName} plan, please contact billing@textbee.dev to get a custom plan`,
        code: 'ALREADY_ON_PLAN',
      })
    }

    if (['past_due', 'incomplete', 'unpaid'].includes(polarSubscription.status)) {
      throw new BadRequestException({
        message:
          'Your subscription has a payment issue. Please update your payment method in the customer portal before changing plans.',
        code: 'PAYMENT_ISSUE',
      })
    }

    return {
      selectedPlan,
      isPlanChange: true,
      currentSubscription,
      polarSubscription,
      targetProductId,
    }
  }

  async changePlan({ user, payload }: { user: any; payload: any }) {
    const billingInterval =
      payload.billingInterval === 'yearly' ? 'yearly' : 'monthly'

    const { isPlanChange, selectedPlan, polarSubscription, targetProductId } =
      await this.resolvePlanChange({
        user,
        planName: payload.planName,
        billingInterval,
      })

    if (!isPlanChange) {
      throw new BadRequestException({
        message:
          'No active paid subscription found to change, please use the checkout instead',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      })
    }

    try {
      // A product update on a subscription scheduled for cancellation is
      // rejected by Polar; changing plans clearly signals intent to stay
      if (polarSubscription.cancel_at_period_end) {
        await this.polarApi.subscriptions.update(polarSubscription.id, {
          cancel_at_period_end: false,
        })
      }

      // prorationBehavior omitted on purpose: use the Polar org default
      const updated = await this.polarApi.subscriptions.update(
        polarSubscription.id,
        { product_id: targetProductId },
      )

      // Update local state right away so the dashboard reflects the change;
      // the subscription.updated webhook that follows is an idempotent no-op
      await this.switchPlan({
        userId: user._id.toString(),
        newPlanPolarProductId: updated.product_id ?? targetProductId,
        currentPeriodStart: toDate(updated.current_period_start),
        currentPeriodEnd: toDate(updated.current_period_end),
        subscriptionStartDate: toDate(updated.started_at ?? updated.created_at),
        endsAt: toDate(updated.ends_at),
        endedAt: toDate(updated.ended_at),
        modifiedAt: toDate(updated.modified_at),
        status: updated.status,
        amount: updated.amount,
        currency: updated.currency,
        recurringInterval: updated.recurring_interval,
        polarSubscriptionId: updated.id,
        polarCustomerId: updated.customer_id,
        cancelAtPeriodEnd: updated.cancel_at_period_end,
      })

      // An open cached checkout for the old plan must not be reusable anymore
      this.checkoutSessionModel
        .updateOne(
          { user: user._id, isCompleted: { $ne: true } },
          { isAbandoned: true },
        )
        .catch((error) => {
          console.error(error)
        })

      return { success: true, plan: selectedPlan.name }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      console.error('failed to change plan', error)

      const statusCode = error?.statusCode
      if (statusCode === 402) {
        throw new BadRequestException({
          message:
            'The prorated charge failed. Please update your payment method in the customer portal and try again.',
          code: 'PAYMENT_ISSUE',
        })
      }
      if (statusCode === 403) {
        throw new BadRequestException({
          message:
            'Your subscription is canceled or ending and cannot be changed. Please resume it in the customer portal or contact billing@textbee.dev.',
          code: 'SUBSCRIPTION_ENDING',
        })
      }
      if (statusCode === 409) {
        throw new BadRequestException({
          message:
            'A plan change is already in progress for your subscription. Please try again later or contact billing@textbee.dev.',
          code: 'PENDING_UPDATE',
        })
      }
      throw new BadRequestException({
        message:
          'Failed to change plan, please try again or contact billing@textbee.dev',
        code: 'PLAN_CHANGE_FAILED',
      })
    }
  }

  async getActiveSubscription(userId: string) {
    const user = await this.userModel.findById(new Types.ObjectId(userId))
    const plans = await this.planModel.find()

    const customPlans = plans.filter((plan) => plan.name?.startsWith('custom'))
    const scalePlan = plans.find((plan) => plan.name === 'scale')
    const proPlan = plans.find((plan) => plan.name === 'pro')
    const freePlan = plans.find((plan) => plan.name === 'free')

    const customPlanSubscription = await this.subscriptionModel.findOne({
      user: user._id,
      plan: { $in: customPlans.map((plan) => plan._id) },
      isActive: true,
    })

    if (customPlanSubscription) {
      return customPlanSubscription.populate('plan')
    }

    if (scalePlan) {
      const scalePlanSubscription = await this.subscriptionModel.findOne({
        user: user._id,
        plan: scalePlan._id,
        isActive: true,
      })

      if (scalePlanSubscription) {
        return scalePlanSubscription.populate('plan')
      }
    }

    const proPlanSubscription = await this.subscriptionModel.findOne({
      user: user._id,
      plan: proPlan._id,
      isActive: true,
    })

    if (proPlanSubscription) {
      return proPlanSubscription.populate('plan')
    }

    const freePlanSubscription = await this.subscriptionModel.findOne({
      user: user._id,
      plan: freePlan._id,
      isActive: true,
    })

    if (freePlanSubscription) {
      return freePlanSubscription.populate('plan')
    }

    // create a new free plan subscription
    // const newFreePlanSubscription = await this.subscriptionModel.create({
    //   user: user._id,
    //   plan: freePlan._id,
    //   isActive: true,
    //   startDate: new Date(),
    // })

    // return newFreePlanSubscription.populate('plan')
    return {
      user,
      plan: freePlan,
      isActive: true,
      status: 'active',
      amount: 0,
    }
  }

  private getEffectiveLimits(subscription: any, plan: any) {
    if (!subscription) {
      return {
        dailyLimit: plan.dailyLimit,
        monthlyLimit: plan.monthlyLimit,
        bulkSendLimit: plan.bulkSendLimit,
        deviceLimit: plan.deviceLimit ?? -1,
      }
    }

    return {
      dailyLimit: subscription.customDailyLimit ?? plan.dailyLimit,
      monthlyLimit: subscription.customMonthlyLimit ?? plan.monthlyLimit,
      bulkSendLimit: subscription.customBulkSendLimit ?? plan.bulkSendLimit,
      deviceLimit:
        subscription.customDeviceLimit ?? plan.deviceLimit ?? -1,
    }
  }

  private notifyApproachingLimits(
    userId: Types.ObjectId,
    planName: string,
    used: { today: number; thisPeriod: number },
    limits: { dailyLimit: number; monthlyLimit: number },
    period: BillingPeriod,
  ) {
    const notify = (
      type: BillingNotificationType,
      title: string,
      message: string,
      meta: Record<string, any>,
    ) =>
      this.billingNotifications
        .notifyOnce({
          userId,
          type,
          title,
          message,
          meta: { ...meta, planName },
          emailKey: usageEmailKey(type, planName),
        })
        .catch(() => {})

    const { dailyLimit, monthlyLimit } = limits
    if (dailyLimit > 0 && used.today >= dailyLimit * 0.8 && used.today < dailyLimit) {
      notify(
        BillingNotificationType.DAILY_LIMIT_APPROACHING,
        "You're close to today's message limit",
        `Your account has used ${used.today} of its ${dailyLimit} messages for today, counting sent and received. ${dailyLimit - used.today} are left.`,
        { processedSmsToday: used.today, dailyLimit },
      )
    }
    if (
      monthlyLimit > 0 &&
      used.thisPeriod >= monthlyLimit * 0.8 &&
      used.thisPeriod < monthlyLimit
    ) {
      notify(
        BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
        "You're close to your monthly message limit",
        `Your account has used ${used.thisPeriod} of its ${monthlyLimit} messages for this billing period, counting sent and received. ${monthlyLimit - used.thisPeriod} are left. The allowance resets on ${formatDateTime(period.end, new Date())}.`,
        {
          processedSmsLastMonth: used.thisPeriod,
          monthlyLimit,
          monthlyPeriodStart: period.start,
          monthlyResetAt: period.end,
        },
      )
    }
  }

  private isLimitExempt(userId: string) {
    return (process.env.LIMIT_EXEMPT_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .includes(String(userId))
  }

  private receivesOverLimitAllowed() {
    return process.env.RECEIVE_SMS_OVER_LIMIT !== 'reject'
  }

  async getUserLimits(userId: string) {
    const subscription = await this.subscriptionModel
      .findOne({ user: new Types.ObjectId(userId), isActive: true })
      .populate('plan')

    if (!subscription) {
      // Default to free plan limits
      const freePlan = await this.planModel.findOne({ name: 'free' })
      return this.getEffectiveLimits(null, freePlan)
    }

    // Use custom limits if set, otherwise fall back to plan limits
    return this.getEffectiveLimits(subscription, subscription.plan)
  }

  async notifyDeviceLimitReached(
    userId: Types.ObjectId | string,
    deviceLimit: number,
    activeDeviceCount: number,
  ) {
    const subscription = await this.subscriptionModel
      .findOne({ user: new Types.ObjectId(String(userId)), isActive: true })
      .populate('plan')
    const planName = (subscription?.plan as Plan | undefined)?.name ?? 'free'
    await this.billingNotifications.notifyOnce({
      userId,
      type: BillingNotificationType.DEVICE_LIMIT_REACHED,
      title: 'Active device limit reached',
      message: `Your plan allows up to ${deviceLimit} active device(s) and you have ${activeDeviceCount}. Disable or delete another device, or upgrade your plan to connect more devices.`,
      meta: {
        deviceLimit,
        activeDeviceCount,
        planName,
      },
      emailKey: usageEmailKey(
        BillingNotificationType.DEVICE_LIMIT_REACHED,
        planName,
      ),
    })
  }

  /**
   * Applies one Polar subscription state to the local rows. Rows are keyed by
   * the Polar subscription id and plan: a plan change keeps the old plan's row
   * as history, and a new purchase gets a row of its own. Which events apply,
   * and when a plan set by hand survives, is decided in
   * polar-subscription-sync.ts.
   */
  async switchPlan(input: PolarSubscriptionSync) {
    const { polarSubscriptionId } = input
    const now = new Date()
    const rows = polarSubscriptionId
      ? await this.subscriptionModel.find({ polarSubscriptionId })
      : []
    const userId = input.userId || (rows[0] ? String(rows[0].user) : undefined)
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new Error(`No user for Polar subscription ${polarSubscriptionId}`)
    }
    const user = new Types.ObjectId(userId)
    const plan = await this.planFor(input.newPlanPolarProductId, input.newPlanName)

    const decision = decideSync({
      snapshot: {
        productId: input.newPlanPolarProductId,
        status: input.status,
        modifiedAt: input.modifiedAt,
        endedAt: input.endedAt,
        revoked: input.revoked,
      },
      rows,
      now,
    })

    if (decision.action === 'ignore') {
      console.log(
        `Ignored a ${decision.reason} event for Polar subscription ${polarSubscriptionId}`,
      )
      return { success: true, plan: plan?.name, ignored: decision.reason }
    }

    if (decision.action === 'end') {
      await this.endPolarSubscription({
        user,
        plan,
        input,
        hasRows: rows.length > 0,
        endedAt: decision.endedAt,
      })
      console.log(`Ended Polar subscription ${polarSubscriptionId} for user ${userId}`)
      return { success: true, plan: plan?.name }
    }

    if (!plan) {
      throw new Error('Plan not found')
    }
    const planId = decision.keepPlan ?? plan._id

    // Two live Polar subscriptions on one account: the newest started one wins,
    // so renewals of the older one cannot flip the plan back and forth.
    const rivals = polarSubscriptionId
      ? await this.subscriptionModel.find({
          user,
          isActive: true,
          polarSubscriptionId: { $nin: [null, polarSubscriptionId] },
          polarEndedAt: null,
        })
      : []
    const started = input.subscriptionStartDate?.getTime() ?? 0
    const outranked = rivals.some(
      (row: any) =>
        !ENDED_STATUSES.has(row.status) &&
        (row.subscriptionStartDate?.getTime?.() ?? 0) > started,
    )
    if (outranked) {
      console.warn(
        `User ${userId} has more than one live Polar subscription; ${polarSubscriptionId} is not the newest`,
      )
    }

    // A running subscription has no end cause.
    const running = input.status === 'active' && !input.cancelAtPeriodEnd
    const update = {
      $set: defined({
        user,
        plan: planId,
        isActive: !outranked,
        currentPeriodStart: input.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd,
        subscriptionStartDate: input.subscriptionStartDate,
        subscriptionEndDate: input.cancelAtPeriodEnd
          ? (input.endsAt ?? input.currentPeriodEnd ?? null)
          : null,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        recurringInterval: input.recurringInterval,
        polarSubscriptionId,
        polarCustomerId: input.polarCustomerId,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        polarProductId: input.newPlanPolarProductId,
        polarEventAt: input.modifiedAt,
      }),
      ...(running && { $unset: { churnCause: 1 } }),
    }
    const key = polarSubscriptionId
      ? { polarSubscriptionId, plan: planId }
      : { user, plan: planId }
    const current = await this.upsertSubscription(key, update)

    if (current && !outranked) {
      const result = await this.subscriptionModel.updateMany(
        { user, isActive: true, _id: { $ne: current._id } },
        { $set: { isActive: false, subscriptionEndDate: now } },
      )
      console.log(`Deactivated subscriptions: ${result?.modifiedCount ?? 0}`)
    }

    await this.reportFirstPayment({
      userId,
      plan: plan.name,
      status: input.status,
      amount: input.amount,
      currency: input.currency,
      polarSubscriptionId,
    })

    return { success: true, plan: plan.name }
  }

  private async planFor(polarProductId?: string, planName?: string) {
    if (polarProductId) {
      return this.planModel.findOne({
        $or: [
          { polarMonthlyProductId: polarProductId },
          { polarYearlyProductId: polarProductId },
        ],
      })
    }
    if (planName) return this.planModel.findOne({ name: planName })
    return null
  }

  // Concurrent webhooks race the upsert; the unique index turns the loser into an update.
  private async upsertSubscription(key: Record<string, any>, update: any) {
    try {
      return await this.subscriptionModel.findOneAndUpdate(key, update, {
        upsert: true,
        new: true,
      })
    } catch (error) {
      if (error?.code !== 11000) throw error
      return this.subscriptionModel.findOneAndUpdate(key, update, { new: true })
    }
  }

  /** Ends every row of a Polar subscription. Ending is final; see decideSync. */
  private async endPolarSubscription({
    user,
    plan,
    input,
    hasRows,
    endedAt,
  }: {
    user: Types.ObjectId
    plan: PlanDocument | null
    input: PolarSubscriptionSync
    hasRows: boolean
    endedAt: Date
  }) {
    const { polarSubscriptionId } = input
    const status =
      input.status && ENDED_STATUSES.has(input.status) ? input.status : 'canceled'

    if (polarSubscriptionId && hasRows) {
      await this.subscriptionModel.updateMany(
        { polarSubscriptionId, isActive: true },
        { $set: { isActive: false, status, subscriptionEndDate: endedAt } },
      )
      await this.subscriptionModel.updateMany(
        { polarSubscriptionId, polarEndedAt: null },
        { $set: { polarEndedAt: endedAt } },
      )
      return
    }

    if (!plan) {
      console.error(
        `Polar subscription ${polarSubscriptionId} ended on an unknown product ${input.newPlanPolarProductId}`,
      )
      return
    }

    // No row carries this id: a row from before ids were stored, or the end
    // arrived before the start. Either way the end is recorded, so a late
    // start event finds it and cannot revive the subscription.
    const fields = defined({
      polarSubscriptionId,
      polarCustomerId: input.polarCustomerId,
      polarProductId: input.newPlanPolarProductId,
      isActive: false,
      status,
      subscriptionStartDate: input.subscriptionStartDate,
      subscriptionEndDate: endedAt,
      polarEndedAt: endedAt,
      currentPeriodStart: input.currentPeriodStart,
      currentPeriodEnd: input.currentPeriodEnd,
      amount: input.amount,
      currency: input.currency,
      recurringInterval: input.recurringInterval,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    })
    const legacy = await this.subscriptionModel.findOneAndUpdate(
      {
        user,
        plan: plan._id,
        isActive: true,
        polarSubscriptionId: null,
        assignedBy: null,
      },
      { $set: fields },
    )
    if (legacy || !polarSubscriptionId) return
    await this.upsertSubscription(
      { polarSubscriptionId, plan: plan._id },
      { $set: { user, plan: plan._id, ...fields } },
    )
  }

  /**
   * Reports a sale to the ad platforms the first time an account actually pays.
   * The milestone write is the only gate, which makes renewals, upgrades and
   * re-subscribes idempotent: whichever webhook arrives first wins, and every
   * later one is a no-op.
   *
   * subscription.created can arrive before payment succeeds, so a status that
   * is not active is ignored rather than reported as revenue.
   */
  private async reportFirstPayment({
    userId,
    plan,
    status,
    amount,
    currency,
    polarSubscriptionId,
  }: {
    userId: string
    plan?: string
    status?: string
    amount?: number
    currency?: string
    polarSubscriptionId?: string
  }) {
    if (status !== 'active') return
    if (typeof amount !== 'number' || amount <= 0) return

    try {
      const isFirstPayment = await this.usersService.markMilestone(
        userId,
        'firstPaidAt',
      )
      if (!isFirstPayment) return

      // Loaded only now, and only once per account, because the conversion
      // event needs the email to hash for matching.
      const user = await this.userModel.findById(userId)
      if (!user) return

      this.analyticsService.purchase(user as any, {
        amount,
        currency,
        plan,
        subscriptionId: polarSubscriptionId,
      })
    } catch (error) {
      console.error('Failed to report first payment', error)
    }
  }

  /** Stores when the current payment retry period started, and clears it once paid. */
  async syncPastDue({
    polarSubscriptionId,
    status,
    pastDueAt,
    eventAt,
  }: {
    polarSubscriptionId?: string
    status?: string
    pastDueAt?: Date | string
    eventAt: Date
  }) {
    if (!polarSubscriptionId) return
    if (status !== 'past_due' && status !== 'active') return
    // Events can arrive out of order; only a newer status change is applied.
    const newer = {
      polarSubscriptionId,
      $or: [{ statusEventAt: null }, { statusEventAt: { $lt: eventAt } }],
    }
    if (status === 'active') {
      await this.subscriptionModel.updateMany(newer, {
        $set: { statusEventAt: eventAt },
        $unset: { pastDueAt: 1 },
      })
      return
    }
    if (pastDueAt) {
      await this.subscriptionModel.updateMany(
        { ...newer, isActive: true },
        { $set: { pastDueAt: new Date(pastDueAt), statusEventAt: eventAt } },
      )
      return
    }
    // Keeps the first start of the retry period.
    await this.subscriptionModel.updateMany(
      { ...newer, isActive: true, pastDueAt: null },
      { $set: { pastDueAt: eventAt, statusEventAt: eventAt } },
    )
    await this.subscriptionModel.updateMany(
      { ...newer, isActive: true },
      { $set: { statusEventAt: eventAt } },
    )
  }

  /** payment_failed when the provider ended the plan right after a failed renewal. */
  async churnCause({
    polarSubscriptionId,
    status,
    cancelAtPeriodEnd,
    endsAt,
    eventAt,
  }: {
    polarSubscriptionId?: string
    status?: string
    cancelAtPeriodEnd?: boolean
    endsAt?: Date | string | null
    eventAt: Date
  }): Promise<'customer' | 'payment_failed'> {
    const ends = endsAt ? new Date(endsAt).getTime() : NaN
    const endsNow =
      status === 'canceled' &&
      cancelAtPeriodEnd === false &&
      Math.abs(ends - eventAt.getTime()) <= 3 * 60 * 60 * 1000
    if (!endsNow || !polarSubscriptionId) return 'customer'

    const pastDue = await this.subscriptionModel.exists({
      polarSubscriptionId,
      pastDueAt: { $ne: null },
    })
    if (pastDue) return 'payment_failed'

    const recentPastDue = await this.polarWebhookPayloadModel.exists({
      'payload.data.id': polarSubscriptionId,
      'payload.data.status': 'past_due',
      createdAt: { $gte: new Date(eventAt.getTime() - 35 * 24 * 60 * 60 * 1000) },
    })
    return recentPastDue ? 'payment_failed' : 'customer'
  }

  /** Records why a Polar subscription is ending, on every row it has. */
  async recordChurnCause({
    polarSubscriptionId,
    churnCause,
  }: {
    polarSubscriptionId?: string
    churnCause?: 'customer' | 'payment_failed'
  }) {
    if (!polarSubscriptionId || !churnCause) return
    await this.subscriptionModel.updateMany(
      { polarSubscriptionId },
      { $set: { churnCause } },
    )
  }

  async canPerformAction(
    userId: string,
    action: 'send_sms' | 'receive_sms' | 'bulk_send_sms',
    value: number,
  ): Promise<{ overLimit: boolean }> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('+emailVerificationWaivedAt')
      if (!user) {
        throw new HttpException(
          { message: 'User not found' },
          HttpStatus.NOT_FOUND,
        )
      }

      if (user.isBanned) {
        throw new HttpException(
          {
            message: 'Sorry, we cannot process your request at the moment',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }

      if (!user.emailVerifiedAt && !user.emailVerificationWaivedAt) {
        console.warn('canPerformAction: User email not verified')
        throw new HttpException(
          {
            message: 'Please verify your email to continue',
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      if (this.isLimitExempt(userId)) {
        return { overLimit: false }
      }

      let plan: PlanDocument
      const subscription = await this.subscriptionModel.findOne({
        user: user._id,
        isActive: true,
      })

      if (!subscription) {
        plan = await this.planModel.findOne({ name: 'free' })
      } else {
        plan = await this.planModel.findById(subscription.plan)
      }

      const effectiveLimits = this.getEffectiveLimits(subscription, plan)

      if (plan.name?.startsWith('custom')) {
        // For custom plans, check if custom limits are set to unlimited (-1)
        if (
          effectiveLimits.dailyLimit === -1 &&
          effectiveLimits.monthlyLimit === -1 &&
          effectiveLimits.bulkSendLimit === -1
        ) {
          return { overLimit: false }
        }
        // Otherwise, continue with limit checks using effective limits
      }

      const now = new Date()
      const period = this.usagePeriod(user, subscription, plan, now)
      const processedSmsToday = await this.smsModel.countDocuments({
        user: user._id,
        createdAt: { $gte: dailyWindowStart(now) },
      })
      const processedSmsLastMonth = await this.smsModel.countDocuments({
        user: user._id,
        createdAt: { $gte: period.start },
      })

      const { dailyLimit, monthlyLimit, bulkSendLimit } = effectiveLimits
      const dailyFinite = dailyLimit !== -1
      const monthlyFinite = monthlyLimit !== -1
      // Paid plans may run a little past their nominal monthly limit.
      const monthlyCeiling =
        monthlyFinite && plan.name !== 'free'
          ? Math.floor(monthlyLimit * PAID_MONTHLY_LIMIT_MULTIPLIER)
          : monthlyLimit

      // Checked in this order: batch size, then the billing period, then today.
      // A batch larger than the room left in a window counts as a hit on that window.
      const monthlyRoom = monthlyFinite ? monthlyCeiling - processedSmsLastMonth : Infinity
      const dailyRoom = dailyFinite ? dailyLimit - processedSmsToday : Infinity
      let tripped: 'bulk' | 'monthly' | 'daily' | null = null
      let reached = false
      if (bulkSendLimit !== -1 && value > bulkSendLimit) {
        tripped = 'bulk'
        reached = true
      } else if (monthlyFinite && monthlyRoom <= 0) {
        tripped = 'monthly'
        reached = true
      } else if (dailyFinite && dailyRoom <= 0) {
        tripped = 'daily'
        reached = true
      } else if (value > Math.min(monthlyRoom, dailyRoom)) {
        tripped = dailyRoom <= monthlyRoom ? 'daily' : 'monthly'
      }

      if (tripped) {
        const room = tripped === 'daily' ? dailyRoom : monthlyRoom
        const roomText = `${pluralize(room, 'message', 'messages')} left ${
          tripped === 'daily' ? 'today' : 'in its monthly allowance'
        }`
        const message = !reached
          ? `This batch had ${value} recipients and your account has ${roomText}. Nothing was sent.`
          : {
              bulk: `This batch has ${value} recipients, and your plan allows ${bulkSendLimit} per batch. Nothing was sent. Split it into smaller batches or upgrade your plan.`,
              monthly: `Your account has used its ${monthlyLimit} messages for this billing period. Sent and received messages both count. Sending starts again when the allowance resets on ${formatDateTime(period.end, now)}, or upgrade your plan to keep sending now.`,
              daily: `Your account has used all ${dailyLimit} messages your plan allows today. Sent and received messages both count. Sending starts again at midnight UTC, or upgrade your plan to keep sending now.`,
            }[tripped]

        const storeReceive =
          action === 'receive_sms' && this.receivesOverLimitAllowed()

        if (!storeReceive) {
          console.warn('canPerformAction: hasReachedLimit')
          console.warn(
            JSON.stringify({
              userId,
              userEmail: user.email,
              userName: user.name,
              action,
              value,
              message,
              hasReachedLimit: true,
              tripped,
              reached,
              dailyLimit,
              dailyRemaining: dailyLimit - processedSmsToday,
              monthlyRemaining: monthlyLimit - processedSmsLastMonth,
              bulkSendLimit,
              monthlyLimit,
            }),
          )
        }

        const type = {
          bulk: BillingNotificationType.BULK_SMS_LIMIT_REACHED,
          monthly: BillingNotificationType.MONTHLY_LIMIT_REACHED,
          daily: BillingNotificationType.DAILY_LIMIT_REACHED,
        }[tripped]
        const title = !reached
          ? 'Your batch did not fit'
          : {
              bulk: 'Your batch was too big for your plan',
              monthly: "You've reached your monthly message limit",
              daily: "You've reached today's message limit",
            }[tripped]
        const emailKey = reached
          ? usageEmailKey(type, plan.name)
          : usageEmailKey(BillingNotificationType.BULK_SMS_LIMIT_REACHED, plan.name)
        // A failed notice must never let an over-limit action through.
        const notification = this.billingNotifications.notifyOnce({
          userId: user._id,
          type,
          title,
          message,
          meta: {
            processedSmsToday,
            processedSmsLastMonth,
            attempted: value,
            dailyLimit,
            monthlyLimit,
            bulkSendLimit,
            planName: plan.name,
            limitTripped: tripped,
            monthlyPeriodStart: period.start,
            monthlyResetAt: period.end,
            ...(!reached && { roomWindow: tripped, roomLeft: room }),
          },
          emailKey,
          recordHit: tripped !== 'bulk',
        })
        const logged = notification.catch((error) => {
          console.error('canPerformAction: failed to record a limit notice', {
            userId,
            error: error?.message ?? error,
          })
        })
        if (!storeReceive) await logged

        if (storeReceive) {
          return { overLimit: true }
        }

        throw new HttpException(
          {
            message: message,
            hasReachedLimit: true,
            dailyLimit,
            dailyRemaining: dailyLimit - processedSmsToday,
            monthlyRemaining: monthlyLimit - processedSmsLastMonth,
            monthlyResetAt: period.end,
            bulkSendLimit,
            monthlyLimit,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }

      this.notifyApproachingLimits(
        user._id,
        plan.name,
        {
          today: processedSmsToday + value,
          thisPeriod: processedSmsLastMonth + value,
        },
        effectiveLimits,
        period,
      )

      return { overLimit: false }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      console.error('canPerformAction: Exception in canPerformAction', {
        userId,
        action,
        error: error?.stack ?? error,
      })
      return { overLimit: false }
    }
  }

  async getUsage(userId: string) {
    const user = await this.userModel.findById(userId).select('createdAt')
    const subscription = await this.subscriptionModel.findOne({
      user: new Types.ObjectId(userId),
      isActive: true,
    })

    let plan: PlanDocument
    if (!subscription) {
      plan = await this.planModel.findOne({ name: 'free' })
    } else {
      plan = await this.planModel.findById(subscription.plan)
    }

    return this.usageSummary(
      user ?? { _id: new Types.ObjectId(userId) },
      subscription,
      plan,
    )
  }

  async validatePolarWebhookPayload(payload: any, headers: any) {
    const webhookHeaders = {
      'webhook-id': headers['webhook-id'] ?? '',
      'webhook-timestamp': headers['webhook-timestamp'] ?? '',
      'webhook-signature': headers['webhook-signature'] ?? '',
    }
    try {
      const webhookPayload = await webhooks.validateEvent(
        payload,
        webhookHeaders,
        process.env.POLAR_WEBHOOK_SECRET ?? '',
      )
      return webhookPayload
    } catch (error) {
      // Signed but newer than this SDK knows; acknowledge so Polar stops retrying
      if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
        console.log('ignoring unknown polar webhook event type', error.eventType)
        return null
      }
      console.log('failed to validate polar webhook payload')
      console.error(error)
      throw new Error('Invalid webhook payload')
    }
  }

  async storePolarWebhookPayload(payload: any) {
    const userId = payload.data?.metadata?.userId || payload.data?.user_id
    const eventType = payload.type
    const name = payload.data?.customer?.name || payload.data?.customer_name
    const email = payload.data?.customer?.email || payload.data?.customer_email
    const productId = payload.data?.product?.id || payload.data?.product_id
    const productName = payload.data?.product?.name || payload.data?.product_name

    await this.polarWebhookPayloadModel.create({
      userId,
      eventType,
      name,
      email,
      payload,
      productId,
      productName,
    })
  }

  private linkId(token: unknown, purpose: string): string | null {
    const secret = emailLinkSecret()
    if (!secret) return null
    return verifyLink(secret, token, purpose, Math.floor(Date.now() / 1000))
  }

  /** Where a signed card update link leads: the customer portal, or the billing page. */
  async cardUpdateRedirect(token: unknown): Promise<string> {
    const fallback = billingUrl()
    const polarSubscriptionId = this.linkId(token, 'card')
    if (!polarSubscriptionId) return fallback
    try {
      const subscription = await this.subscriptionModel.findOne({
        polarSubscriptionId,
        polarCustomerId: { $nin: [null, ''] },
      })
      if (!subscription?.polarCustomerId) return fallback
      const session = await this.polarApi.customerSessions.create({
        customer_id: subscription.polarCustomerId,
        return_url: fallback,
      })
      const url = session?.customer_portal_url
      return typeof url === 'string' && url.startsWith('https://') ? url : fallback
    } catch (error) {
      console.error('failed to open the customer portal from an email link', error?.message)
      return fallback
    }
  }

  /** Where a signed checkout link leads: the open checkout, or a new one for the same plan. */
  async checkoutResumeRedirect(token: unknown): Promise<string> {
    const checkoutSessionId = this.linkId(token, 'checkout-resume')
    if (!checkoutSessionId) return billingUrl()
    let session: CheckoutSessionDocument | null = null
    try {
      session = await this.checkoutSessionModel.findOne({ checkoutSessionId })
    } catch (error) {
      console.error('failed to load a checkout from an email link', error?.message)
    }
    if (
      session &&
      !session.isCompleted &&
      !session.isAbandoned &&
      session.expiresAt?.getTime() > Date.now() &&
      session.checkoutUrl?.startsWith('https://')
    ) {
      return session.checkoutUrl
    }
    const plan = encodeURIComponent(session?.planName || 'pro')
    const interval = session?.billingInterval === 'yearly' ? 'yearly' : 'monthly'
    return `${appPublicUrl()}/checkout/${plan}?billingInterval=${interval}`
  }

  /**
   * Mirror a Polar checkout's terminal status onto our cached checkout session.
   *
   * Without this nothing ever writes isCompleted, so a checkout the customer
   * already paid for stayed reusable until it expired, and the completed count
   * read as zero. Keyed on checkoutSessionId rather than user because the cache
   * holds one row per user: once a newer checkout replaces it, a late webhook
   * for the old id should match nothing rather than clobber the new row.
   */
  async syncCheckoutSessionStatus({
    checkoutSessionId,
    status,
  }: {
    checkoutSessionId: string
    status: string
  }) {
    if (!checkoutSessionId) return

    // open and confirmed are still in flight, and failed is retryable, so the
    // cached session stays valid for all three.
    let update: Record<string, any> | null = null
    if (status === 'succeeded') {
      update = { isCompleted: true, completedAt: new Date() }
    } else if (status === 'expired') {
      update = { isAbandoned: true }
    }
    if (!update) return

    await this.checkoutSessionModel
      .updateOne({ checkoutSessionId }, update)
      .catch((error) => {
        console.error('failed to sync checkout session status', error)
      })
  }
}
