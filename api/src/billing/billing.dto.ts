import { ApiProperty } from '@nestjs/swagger'

export class PlanDTO {
  @ApiProperty({
    type: String,
    description: 'Plan identifier, used as planName when starting a checkout.',
    example: 'pro',
  })
  name: string

  @ApiProperty({
    type: Number,
    description: 'Monthly price in the plan currency.',
  })
  monthlyPrice: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Yearly price, when the plan can be billed yearly.',
  })
  yearlyPrice?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Polar product backing this plan.',
  })
  polarProductId?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Polar product for monthly billing.',
  })
  polarMonthlyProductId?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Polar product for yearly billing.',
  })
  polarYearlyProductId?: string

  @ApiProperty({
    type: Boolean,
    description: 'Whether the plan can be subscribed to right now.',
  })
  isActive: boolean
}

export class PlansResponseDTO extends Array<PlanDTO> {}

export class CheckoutInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Plan to subscribe to, by name.',
    example: 'pro',
  })
  planName: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Polar discount to apply at checkout.',
  })
  discountId?: string

  @ApiProperty({
    enum: ['monthly', 'yearly'],
    required: false,
    description: 'Billing period. Defaults to monthly.',
  })
  billingInterval?: 'monthly' | 'yearly'
}

export class PlanChangePreviewDTO {
  @ApiProperty({ type: String, description: 'Plan the account is on now.' })
  currentPlan: string

  @ApiProperty({
    enum: ['monthly', 'yearly'],
    description: 'Billing period in force now.',
  })
  currentInterval: string

  @ApiProperty({ type: String, description: 'Plan being moved to.' })
  newPlan: string

  @ApiProperty({
    enum: ['monthly', 'yearly'],
    description: 'Billing period being moved to.',
  })
  newInterval: string

  @ApiProperty({
    type: Boolean,
    description: 'Whether the change raises the plan level.',
  })
  isUpgrade: boolean

  @ApiProperty({
    type: Boolean,
    description: 'Whether the current subscription ends at the period end.',
  })
  cancelAtPeriodEnd: boolean
}

export class CheckoutResponseDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Polar checkout URL to send the user to.',
  })
  redirectUrl?: string

  // returned instead of redirectUrl when the user already has an active paid
  // Polar subscription, so the frontend shows a confirmation screen
  @ApiProperty({
    type: PlanChangePreviewDTO,
    required: false,
    description:
      'Returned instead of redirectUrl when the account already pays for a plan. Confirm it, then call POST /billing/change-plan.',
  })
  planChange?: PlanChangePreviewDTO
}

export class ChangePlanInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Plan to switch to, by name.',
    example: 'pro',
  })
  planName: string

  @ApiProperty({
    enum: ['monthly', 'yearly'],
    required: false,
    description: 'Billing period to switch to.',
  })
  billingInterval?: 'monthly' | 'yearly'
}

export class ChangePlanResponseDTO {
  @ApiProperty({ type: Boolean, description: 'Whether the switch succeeded.' })
  success: boolean

  @ApiProperty({ type: String, description: 'Plan the account is now on.' })
  plan: string
}

export class SubscriptionUsageDTO {
  @ApiProperty({ type: Number, description: 'Messages processed today.' })
  processedSmsToday: number

  @ApiProperty({
    type: Number,
    description:
      'Messages processed in the current billing period. The name is kept for compatibility.',
  })
  processedSmsLastMonth: number

  @ApiProperty({
    type: Date,
    description:
      'Start of the current billing period. Free accounts count from the signup date each month, paid accounts from the plan start date.',
  })
  monthlyPeriodStart: Date

  @ApiProperty({
    type: Date,
    description: 'When the monthly allowance resets and the next billing period starts.',
  })
  monthlyResetAt: Date

  @ApiProperty({
    type: Number,
    description: 'Messages allowed per day. -1 means unlimited.',
  })
  dailyLimit: number

  @ApiProperty({
    type: Number,
    description: 'Messages allowed per billing period. -1 means unlimited.',
  })
  monthlyLimit: number

  @ApiProperty({
    type: Number,
    description: 'Messages allowed in one bulk send. -1 means unlimited.',
  })
  bulkSendLimit: number

  @ApiProperty({
    type: Number,
    description: 'Devices allowed on the account. -1 means unlimited.',
  })
  deviceLimit: number

  @ApiProperty({
    type: Number,
    description: 'Messages left today. -1 when the daily limit is unlimited.',
  })
  dailyRemaining: number

  @ApiProperty({
    type: Number,
    description:
      'Messages left in the current billing period. -1 when the monthly limit is unlimited.',
  })
  monthlyRemaining: number

  @ApiProperty({
    type: Number,
    description: 'Share of the daily allowance used, 0 to 100.',
  })
  dailyUsagePercentage: number

  @ApiProperty({
    type: Number,
    description: 'Share of the billing period allowance used, 0 to 100.',
  })
  monthlyUsagePercentage: number
}

export class CurrentSubscriptionResponseDTO {
  @ApiProperty({
    type: PlanDTO,
    description: 'Plan in force. Accounts without a paid plan get the free one.',
  })
  plan: PlanDTO

  @ApiProperty({
    type: Boolean,
    description: 'Whether the subscription is currently active.',
  })
  isActive: boolean

  @ApiProperty({
    type: String,
    required: false,
    description: 'Subscription state reported by Polar.',
  })
  status?: string

  @ApiProperty({
    enum: ['monthly', 'yearly'],
    required: false,
    description: 'Billing period. Absent on the free plan.',
  })
  recurringInterval?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the plan ends when the paid period does.',
  })
  cancelAtPeriodEnd?: boolean

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Start of the paid period.',
  })
  currentPeriodStart?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'End of the paid period.',
  })
  currentPeriodEnd?: Date

  @ApiProperty({
    type: SubscriptionUsageDTO,
    description: 'Limits and how much of them the account has used.',
  })
  usage: SubscriptionUsageDTO
}

export class BillingNotificationDTO {
  @ApiProperty({ type: String, description: 'Notification id.' })
  _id: string

  @ApiProperty({
    type: String,
    description: 'What triggered it, for example a limit being reached.',
  })
  type: string

  @ApiProperty({ type: String, description: 'Headline shown in the dashboard.' })
  title: string

  @ApiProperty({ type: String, description: 'Body text.' })
  message: string

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the account read it. Absent while unread.',
  })
  readAt?: Date

  @ApiProperty({ type: Date, description: 'When it was raised.' })
  createdAt: Date
}
