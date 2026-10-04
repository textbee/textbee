import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Plan } from './plan.schema'

export enum SubscriptionStatus {
  Incomplete = 'incomplete',
  IncompleteExpired = 'incomplete_expired',
  Trialing = 'trialing',
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Unpaid = 'unpaid',
}

export type SubscriptionDocument = Subscription & Document

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: Plan.name, required: true })
  plan: Plan | Types.ObjectId

  @Prop({ type: String, index: true })
  polarSubscriptionId?: string

  @Prop({ type: String })
  polarCustomerId?: string

  @Prop({ type: Boolean })
  cancelAtPeriodEnd?: boolean

  @Prop({ type: String })
  recurringInterval?: string

  @Prop({ type: Date })
  subscriptionStartDate?: Date

  @Prop({ type: Number })
  amount?: number

  @Prop({ type: String })
  currency?: string

  @Prop({ type: Date })
  subscriptionEndDate?: Date

  @Prop({ type: Date })
  currentPeriodStart?: Date

  @Prop({ type: Date })
  currentPeriodEnd?: Date

  @Prop({ type: String })
  status: string

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  // Custom limits for custom plans
  @Prop({ type: Number })
  customDailyLimit?: number

  @Prop({ type: Number })
  customMonthlyLimit?: number

  @Prop({ type: Number })
  customBulkSendLimit?: number

  // no default on purpose: absent means "no override", fall back to plan.deviceLimit
  @Prop({ type: Number })
  customDeviceLimit?: number

  // Start of the current payment retry period; cleared once payment succeeds.
  @Prop({ type: Date })
  pastDueAt?: Date

  // Provider time of the last applied status change, to ignore older events.
  @Prop({ type: Date })
  statusEventAt?: Date

  @Prop({ type: String, enum: ['customer', 'payment_failed'] })
  churnCause?: 'customer' | 'payment_failed'

  // The Polar product this row last carried. A plan is re-derived only when it changes.
  @Prop({ type: String })
  polarProductId?: string

  // Polar modified_at of the newest event applied, to ignore older events.
  @Prop({ type: Date })
  polarEventAt?: Date

  // When Polar ended the subscription. An ended subscription is never revived.
  @Prop({ type: Date })
  polarEndedAt?: Date
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription)

// switchPlan keeps one active row per user. No unique index enforces it:
// ended rows stay as history, so a user has many inactive rows.
SubscriptionSchema.index({ user: 1, isActive: 1 })

// One row per Polar subscription and plan; concurrent webhooks cannot duplicate it.
SubscriptionSchema.index(
  { polarSubscriptionId: 1, plan: 1 },
  {
    unique: true,
    partialFilterExpression: { polarSubscriptionId: { $type: 'string' } },
  },
)

// Scheduled email rules read ended plans by end date.
SubscriptionSchema.index({ subscriptionEndDate: 1 })
