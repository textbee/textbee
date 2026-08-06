import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
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

/** The statuses under which a subscriber still has paid access. */
export const ACTIVE_SUBSCRIPTION_STATUSES: string[] = [
  SubscriptionStatus.Trialing,
  SubscriptionStatus.Active,
  SubscriptionStatus.PastDue,
]

/**
 * Whether a Polar status should grant access.
 *
 * An absent status counts as active: a payload that simply omits it must never
 * be read as a revocation, since that would silently cut off a paying customer.
 */
export function isActiveSubscriptionStatus(status?: string): boolean {
  if (status === undefined || status === null) return true
  return ACTIVE_SUBSCRIPTION_STATUSES.includes(status)
}

export type SubscriptionDocument = Subscription & Document

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: Plan.name, required: true })
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
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription)

// A user can only have one ACTIVE subscription at a time. Partial on purpose:
// the previous unique { user, isActive } also forbade a second *inactive* row,
// so it could never build against real history and was absent in production,
// leaving this rule unenforced.
SubscriptionSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)
