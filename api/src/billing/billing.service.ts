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
import { Polar } from '@polar-sh/sdk'
import { User, UserDocument } from '../users/schemas/user.schema'
import { CheckoutResponseDTO, PlanDTO } from './billing.dto'
import { SMSDocument } from '../gateway/schemas/sms.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { validateEvent } from '@polar-sh/sdk/webhooks'
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

@Injectable()
export class BillingService {
  private polarApi

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
  ) {
    this.polarApi = new Polar({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
      server:
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

    const processedSmsToday = await this.smsModel.countDocuments({
      user: user._id,
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    })

    const processedSmsLastMonth = await this.smsModel.countDocuments({
      user: user._id,
      createdAt: {
        $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
      },
    })

    if (subscription) {
      const plan = subscription.plan
      const effectiveLimits = this.getEffectiveLimits(subscription, plan)

      try {
        if (effectiveLimits.dailyLimit && effectiveLimits.dailyLimit > 0) {
          const dailyPct = processedSmsToday / effectiveLimits.dailyLimit
          if (
            dailyPct >= 0.8 &&
            processedSmsToday < effectiveLimits.dailyLimit
          ) {
            this.billingNotifications
              .notifyOnce({
                userId: user._id,
                type: BillingNotificationType.DAILY_LIMIT_APPROACHING,
                title: "You're nearing today's SMS limit",
                message: `You've used ${Math.round(dailyPct * 100)}% of today's SMS allocation. ${effectiveLimits.dailyLimit - processedSmsToday} messages remain for today. Consider upgrading your plan or scheduling sends for later.`,
                meta: {
                  processedSmsToday,
                  dailyLimit: effectiveLimits.dailyLimit,
                },
                sendEmail: true,
              })
              .catch(() => {})
          }
        }
        if (effectiveLimits.monthlyLimit && effectiveLimits.monthlyLimit > 0) {
          const monthlyPct =
            processedSmsLastMonth / effectiveLimits.monthlyLimit
          if (
            monthlyPct >= 0.8 &&
            processedSmsLastMonth < effectiveLimits.monthlyLimit
          ) {
            this.billingNotifications
              .notifyOnce({
                userId: user._id,
                type: BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
                title: "You're nearing this month's SMS limit",
                message: `You've used ${Math.round(monthlyPct * 100)}% of the messages your plan allows over the last 30 days. ${effectiveLimits.monthlyLimit - processedSmsLastMonth} are left.`,
                meta: {
                  processedSmsLastMonth,
                  monthlyLimit: effectiveLimits.monthlyLimit,
                },
                sendEmail: true,
              })
              .catch(() => {})
          }
        }
      } catch {}
      return {
        ...subscription.toObject(),
        usage: {
          processedSmsToday,
          processedSmsLastMonth,
          dailyLimit: effectiveLimits.dailyLimit,
          monthlyLimit: effectiveLimits.monthlyLimit,
          bulkSendLimit: effectiveLimits.bulkSendLimit,
          deviceLimit: effectiveLimits.deviceLimit,
          dailyRemaining:
            effectiveLimits.dailyLimit === -1
              ? -1
              : effectiveLimits.dailyLimit - processedSmsToday,
          monthlyRemaining:
            effectiveLimits.monthlyLimit === -1
              ? -1
              : effectiveLimits.monthlyLimit - processedSmsLastMonth,
          dailyUsagePercentage:
            effectiveLimits.dailyLimit === -1
              ? 0
              : Math.round(
                  (processedSmsToday / effectiveLimits.dailyLimit) * 100,
                ),
          monthlyUsagePercentage:
            effectiveLimits.monthlyLimit === -1
              ? 0
              : Math.round(
                  (processedSmsLastMonth / effectiveLimits.monthlyLimit) * 100,
                ),
        },
      }
    }

    const plan = await this.planModel.findOne({ name: 'free' })
    const effectiveLimits = this.getEffectiveLimits(null, plan)

    // fire-and-forget: approaching threshold notifications
    try {
      if (effectiveLimits.dailyLimit && effectiveLimits.dailyLimit > 0) {
        const dailyPct = processedSmsToday / effectiveLimits.dailyLimit
        if (dailyPct >= 0.8 && processedSmsToday < effectiveLimits.dailyLimit) {
          this.billingNotifications
            .notifyOnce({
              userId: user._id,
              type: BillingNotificationType.DAILY_LIMIT_APPROACHING,
              title: "You're nearing today's SMS limit",
              message: `You've used ${Math.round(dailyPct * 100)}% of today's SMS allocation. ${effectiveLimits.dailyLimit - processedSmsToday} messages remain for today. Consider upgrading your plan or scheduling sends for later.`,
              meta: {
                processedSmsToday,
                dailyLimit: effectiveLimits.dailyLimit,
              },
              sendEmail: true,
            })
            .catch(() => {})
        }
      }
      if (effectiveLimits.monthlyLimit && effectiveLimits.monthlyLimit > 0) {
        const monthlyPct = processedSmsLastMonth / effectiveLimits.monthlyLimit
        if (
          monthlyPct >= 0.8 &&
          processedSmsLastMonth < effectiveLimits.monthlyLimit
        ) {
          this.billingNotifications
            .notifyOnce({
              userId: user._id,
              type: BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
              title: "You're nearing this month's SMS limit",
              message: `You've used ${Math.round(monthlyPct * 100)}% of the messages your plan allows over the last 30 days. ${effectiveLimits.monthlyLimit - processedSmsLastMonth} are left.`,
              meta: {
                processedSmsLastMonth,
                monthlyLimit: effectiveLimits.monthlyLimit,
              },
              sendEmail: true,
            })
            .catch(() => {})
        }
      }
    } catch {}

    return {
      plan,
      isActive: true,
      usage: {
        processedSmsToday,
        processedSmsLastMonth,
        dailyLimit: effectiveLimits.dailyLimit,
        monthlyLimit: effectiveLimits.monthlyLimit,
        bulkSendLimit: effectiveLimits.bulkSendLimit,
        deviceLimit: effectiveLimits.deviceLimit,
        dailyRemaining:
          effectiveLimits.dailyLimit === -1
            ? -1
            : effectiveLimits.dailyLimit - processedSmsToday,
        monthlyRemaining:
          effectiveLimits.monthlyLimit === -1
            ? -1
            : effectiveLimits.monthlyLimit - processedSmsLastMonth,
        dailyUsagePercentage:
          effectiveLimits.dailyLimit === -1
            ? 0
            : Math.round(
                (processedSmsToday / effectiveLimits.dailyLimit) * 100,
              ),
        monthlyUsagePercentage:
          effectiveLimits.monthlyLimit === -1
            ? 0
            : Math.round(
                (processedSmsLastMonth / effectiveLimits.monthlyLimit) * 100,
              ),
      },
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
          cancelAtPeriodEnd: !!planChange.polarSubscription.cancelAtPeriodEnd,
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

      const checkoutOptions: any = {
        // productId: selectedPlan.polarProductId, // deprecated
        products: orderedProductIds,
        successUrl: `${process.env.FRONTEND_URL}/dashboard/account?checkout-success=1&checkout_id={CHECKOUT_ID}`,
        cancelUrl: `${process.env.FRONTEND_URL}/dashboard/account?checkout-cancel=1&checkout_id={CHECKOUT_ID}`,
        customerEmail: user.email,
        customerName: user.name,
        customerIpAddress: req.ip,
        metadata: {
          userId: user._id?.toString(),
        },
        externalCustomerId: user._id?.toString(),
      }

      try {
        let discount = null;
        if (discountId) {
          discount = await this.polarApi.discounts.get({
            id: discountId,
          })
          if (discount) {
            checkoutOptions.discountId = discount.id
          }
        }
      } catch (error) {
        console.error('failed to get discount', error)
      }

      const checkout = await this.polarApi.checkouts.create(checkoutOptions)

      this.checkoutSessionModel
        .updateOne(
          {
            user: user._id,
          },
          {
            user: user._id,
            checkoutSessionId: checkout.id,
            checkoutUrl: checkout.url,
            planName: payload.planName,
            billingInterval,
            expiresAt: new Date(checkout.expiresAt),
            payload: checkout,
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
    polarSubscription?: any
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

    let polarSubscription = null
    if (currentSubscription.polarSubscriptionId) {
      try {
        polarSubscription = await this.polarApi.subscriptions.get({
          id: currentSubscription.polarSubscriptionId,
        })
      } catch (error) {
        console.error('failed to fetch polar subscription by stored id', error)
      }
    }

    // Older subscriptions predate storing polarSubscriptionId; checkouts have
    // always set externalCustomerId to the user id, so recover it from there
    if (!polarSubscription || polarSubscription.status === 'canceled') {
      try {
        const page = await this.polarApi.subscriptions.list({
          externalCustomerId: user._id.toString(),
          active: true,
          limit: 1,
        })
        polarSubscription = page?.result?.items?.[0] ?? null

        if (polarSubscription) {
          this.subscriptionModel
            .updateOne(
              { _id: currentSubscription._id },
              {
                polarSubscriptionId: polarSubscription.id,
                polarCustomerId: polarSubscription.customerId,
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
    if (polarSubscription.productId === targetProductId) {
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
      if (polarSubscription.cancelAtPeriodEnd) {
        await this.polarApi.subscriptions.update({
          id: polarSubscription.id,
          subscriptionUpdate: { cancelAtPeriodEnd: false },
        })
      }

      // prorationBehavior omitted on purpose: use the Polar org default
      const updated = await this.polarApi.subscriptions.update({
        id: polarSubscription.id,
        subscriptionUpdate: { productId: targetProductId },
      })

      // Update local state right away so the dashboard reflects the change;
      // the subscription.updated webhook that follows is an idempotent no-op
      await this.switchPlan({
        userId: user._id.toString(),
        newPlanPolarProductId: updated.productId ?? targetProductId,
        currentPeriodStart: updated.currentPeriodStart,
        currentPeriodEnd: updated.currentPeriodEnd,
        subscriptionStartDate: updated.startedAt ?? updated.createdAt,
        subscriptionEndDate: updated.canceledAt,
        status: updated.status,
        amount: updated.amount,
        currency: updated.currency,
        recurringInterval: updated.recurringInterval,
        polarSubscriptionId: updated.id,
        polarCustomerId: updated.customerId,
        cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
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
    await this.billingNotifications.notifyOnce({
      userId,
      type: BillingNotificationType.DEVICE_LIMIT_REACHED,
      title: 'Active device limit reached',
      message: `Your plan allows up to ${deviceLimit} active device(s) and you have ${activeDeviceCount}. Disable or delete another device, or upgrade your plan to connect more devices.`,
      meta: {
        deviceLimit,
        activeDeviceCount,
      },
      sendEmail: true,
    })
  }

  async switchPlan({
    userId,
    newPlanName,
    newPlanPolarProductId,
    currentPeriodStart,
    currentPeriodEnd,
    subscriptionStartDate,
    subscriptionEndDate,
    status,
    amount,
    currency,
    recurringInterval,
    polarSubscriptionId,
    polarCustomerId,
    cancelAtPeriodEnd,
  }: {
    userId: string
    newPlanName?: string
    newPlanPolarProductId?: string
    createdAt?: Date
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    subscriptionStartDate?: Date
    subscriptionEndDate?: Date
    status?: string
    amount?: number
    currency?: string
    recurringInterval?: string
    polarSubscriptionId?: string
    polarCustomerId?: string
    cancelAtPeriodEnd?: boolean
  }) {
    console.log(`Switching plan for user: ${userId}`)

    // Convert userId to ObjectId
    const userObjectId = new Types.ObjectId(userId)

    let plan: PlanDocument
    if (newPlanPolarProductId) {
      plan = await this.planModel.findOne({
        $or: [
          { polarMonthlyProductId: newPlanPolarProductId },
          { polarYearlyProductId: newPlanPolarProductId },
        ],
      })
    } else if (newPlanName) {
      plan = await this.planModel.findOne({ name: newPlanName })
    }

    if (!plan) {
      throw new Error('Plan not found')
    }

    console.log(`Found plan: ${plan.name}`)

    // Deactivate current active subscriptions
    const result = await this.subscriptionModel.updateMany(
      { user: userObjectId, plan: { $ne: plan._id }, isActive: true },
      { isActive: false, subscriptionEndDate: new Date() },
    )
    console.log(`Deactivated subscriptions: ${result.modifiedCount}`)

    // Create or update the new subscription
    const updateResult = await this.subscriptionModel.updateOne(
      { user: userObjectId, plan: plan._id },
      {
        isActive: true,
        currentPeriodStart,
        currentPeriodEnd,
        subscriptionStartDate,
        subscriptionEndDate,
        status,
        amount,
        currency,
        recurringInterval,
        polarSubscriptionId,
        polarCustomerId,
        cancelAtPeriodEnd,
      },
      { upsert: true },
    )
    console.log(
      `Updated or created subscription: ${updateResult.upsertedCount > 0 ? 'Created' : 'Updated'}`,
    )

    return { success: true, plan: plan.name }
  }

  async cancelSubscription({
    userId,
    polarProductId,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    status,
  }: {
    userId: string
    polarProductId?: string
    cancelAtPeriodEnd?: boolean
    currentPeriodEnd?: Date
    status?: string
  }) {
    const userObjectId = new Types.ObjectId(userId)

    const plan = await this.planModel.findOne({
      $or: [
        { polarMonthlyProductId: polarProductId },
        { polarYearlyProductId: polarProductId },
      ],
    })

    if (!plan) {
      throw new Error(`No plan found for product ID: ${polarProductId}`)
    }

    // Polar "subscription.canceled" = cancellation SCHEDULED. The subscription
    // stays active until period end. Record the intent; do NOT downgrade here.
    // The actual downgrade happens on the "subscription.revoked" event.
    await this.subscriptionModel.updateOne(
      { user: userObjectId, plan: plan._id, isActive: true },
      {
        cancelAtPeriodEnd: cancelAtPeriodEnd ?? true,
        ...(currentPeriodEnd && {
          currentPeriodEnd,
          subscriptionEndDate: currentPeriodEnd,
        }),
        ...(status && { status }),
      },
    )

    console.log(
      `Recorded scheduled cancellation for user ${userId} on plan ${plan.name} (ends ${currentPeriodEnd ?? 'unknown'})`,
    )
    return { success: true, plan: plan.name }
  }

  async revokeSubscription({
    userId,
    polarProductId,
  }: {
    userId: string
    polarProductId?: string
  }) {
    const userObjectId = new Types.ObjectId(userId)

    const plan = await this.planModel.findOne({
      $or: [
        { polarMonthlyProductId: polarProductId },
        { polarYearlyProductId: polarProductId },
      ],
    })

    if (!plan) {
      throw new Error(`No plan found for product ID: ${polarProductId}`)
    }

    await this.subscriptionModel.updateOne(
      { user: userObjectId, plan: plan._id, isActive: true },
      { isActive: false, subscriptionEndDate: new Date() },
    )

    console.log(`Revoked subscription for user ${userId} on plan ${plan.name}`)
    return { success: true, plan: plan.name }
  }

  async canPerformAction(
    userId: string,
    action: 'send_sms' | 'receive_sms' | 'bulk_send_sms',
    value: number,
  ) {
    try {
      const user = await this.userModel.findById(userId)
      if (user.isBanned) {
        throw new HttpException(
          {
            message: 'Sorry, we cannot process your request at the moment',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }

      if (user.emailVerifiedAt === null) {
        console.warn('canPerformAction: User email not verified')
        throw new HttpException(
          {
            message: 'Please verify your email to continue',
          },
          HttpStatus.BAD_REQUEST,
        )
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
          return true
        }
        // Otherwise, continue with limit checks using effective limits
      }

      let hasReachedLimit = false
      let message = ''

      const processedSmsToday = await this.smsModel.countDocuments({
        user: user._id,
        createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      })
      const processedSmsLastMonth = await this.smsModel.countDocuments({
        user: user._id,
        createdAt: {
          $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
        },
      })

      let dailyExceeded = false
      let monthlyExceeded = false
      let bulkExceeded = false

      if (['send_sms', 'receive_sms', 'bulk_send_sms'].includes(action)) {
        const dailyFinite = effectiveLimits.dailyLimit !== -1
        const monthlyFinite = effectiveLimits.monthlyLimit !== -1

        // exceeded checks
        dailyExceeded =
          dailyFinite && processedSmsToday + value > effectiveLimits.dailyLimit
        monthlyExceeded =
          monthlyFinite &&
          processedSmsLastMonth + value > effectiveLimits.monthlyLimit
        bulkExceeded =
          effectiveLimits.bulkSendLimit !== -1 &&
          value > effectiveLimits.bulkSendLimit

        if (dailyExceeded) {
          hasReachedLimit = true
          message = `You have sent all ${effectiveLimits.dailyLimit} messages your plan allows today. Sending resumes automatically when the allowance resets at midnight, or move up a plan to carry on now.`
        }

        if (monthlyExceeded) {
          hasReachedLimit = true
          message = `You have sent all ${effectiveLimits.monthlyLimit} messages your plan allows over the last 30 days. Usage is counted on a rolling window, so sending resumes as your earliest messages pass that mark, or move up a plan to carry on now.`
        }

        if (bulkExceeded) {
          hasReachedLimit = true
          message = `That batch had ${value} recipients and your plan allows ${effectiveLimits.bulkSendLimit} per batch, so nothing was sent. Split it into smaller batches to send it as it is, or move up a plan for a larger batch size.`
        }
      }

      if (hasReachedLimit) {
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
            dailyLimit: effectiveLimits.dailyLimit,
            dailyRemaining: effectiveLimits.dailyLimit - processedSmsToday,
            monthlyRemaining:
              effectiveLimits.monthlyLimit - processedSmsLastMonth,
            bulkSendLimit: effectiveLimits.bulkSendLimit,
            monthlyLimit: effectiveLimits.monthlyLimit,
          }),
        )

        let type: BillingNotificationType
        let titleForEmail = ''
        if (dailyExceeded) {
          type = BillingNotificationType.DAILY_LIMIT_REACHED
          titleForEmail = 'Daily SMS limit reached'
        } else if (monthlyExceeded) {
          type = BillingNotificationType.MONTHLY_LIMIT_REACHED
          titleForEmail = 'Monthly SMS limit reached'
        } else if (bulkExceeded) {
          type = BillingNotificationType.BULK_SMS_LIMIT_REACHED
          titleForEmail = 'Bulk send limit exceeded'
        }
        if (type) {
          await this.billingNotifications.notifyOnce({
            userId: user._id,
            type,
            title: titleForEmail || 'Usage limit notice',
            message,
            meta: {
              processedSmsToday,
              processedSmsLastMonth,
              attempted: value,
              dailyLimit: effectiveLimits.dailyLimit,
              monthlyLimit: effectiveLimits.monthlyLimit,
              bulkSendLimit: effectiveLimits.bulkSendLimit,
            },
            sendEmail: true,
          })
        }

        // if plan is not free and monthly limit is exceeded, give them 80% more monthly limit
        if (
          plan.name !== 'free' &&
          monthlyExceeded &&
          !dailyExceeded &&
          !bulkExceeded
        ) {
          const extendedMonthlyLimit = Math.floor(
            effectiveLimits.monthlyLimit * 1.8,
          )
          const exceedsExtended =
            processedSmsLastMonth + value > extendedMonthlyLimit
          if (!exceedsExtended) {
            return true
          }
        }
        throw new HttpException(
          {
            message: message,
            hasReachedLimit: true,
            dailyLimit: effectiveLimits.dailyLimit,
            dailyRemaining: effectiveLimits.dailyLimit - processedSmsToday,
            monthlyRemaining:
              effectiveLimits.monthlyLimit - processedSmsLastMonth,
            bulkSendLimit: effectiveLimits.bulkSendLimit,
            monthlyLimit: effectiveLimits.monthlyLimit,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }

      return true
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      console.error('canPerformAction: Exception in canPerformAction')
      console.error(JSON.stringify(error))
      return true
    }
  }

  async getUsage(userId: string) {
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

    const effectiveLimits = this.getEffectiveLimits(subscription, plan)

    const processedSmsToday = await this.smsModel.countDocuments({
      user: new Types.ObjectId(userId),
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    })

    const processedSmsLastMonth = await this.smsModel.countDocuments({
      user: new Types.ObjectId(userId),
      createdAt: {
        $gte: new Date(new Date().setMonth(new Date().getMonth() - 1)),
      },
    })

    return {
      processedSmsToday,
      processedSmsLastMonth,
      dailyLimit: effectiveLimits.dailyLimit,
      monthlyLimit: effectiveLimits.monthlyLimit,
      bulkSendLimit: effectiveLimits.bulkSendLimit,
      deviceLimit: effectiveLimits.deviceLimit,
      dailyRemaining:
        effectiveLimits.dailyLimit === -1
          ? -1
          : effectiveLimits.dailyLimit - processedSmsToday,
      monthlyRemaining:
        effectiveLimits.monthlyLimit === -1
          ? -1
          : effectiveLimits.monthlyLimit - processedSmsLastMonth,
    }
  }

  async validatePolarWebhookPayload(payload: any, headers: any) {
    const webhookHeaders = {
      'webhook-id': headers['webhook-id'] ?? '',
      'webhook-timestamp': headers['webhook-timestamp'] ?? '',
      'webhook-signature': headers['webhook-signature'] ?? '',
    }
    try {
      const webhookPayload = validateEvent(
        payload,
        webhookHeaders,
        process.env.POLAR_WEBHOOK_SECRET,
      )
      return webhookPayload
    } catch (error) {
      console.log('failed to validate polar webhook payload')
      console.error(error)
      throw new Error('Invalid webhook payload')
    }
  }

  async storePolarWebhookPayload(payload: any) {
    const userId = payload.data?.metadata?.userId || payload.data?.userId
    const eventType = payload.type
    const name = payload.data?.customer?.name || payload.data?.customerName
    const email = payload.data?.customer?.email || payload.data?.customerEmail
    const productId = payload.data?.product?.id || payload.data?.productId
    const productName = payload.data?.product?.name || payload.data?.productName

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
