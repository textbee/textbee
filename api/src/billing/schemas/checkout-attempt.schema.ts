import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type CheckoutAttemptDocument = CheckoutAttempt & Document

@Schema({ timestamps: true })
export class CheckoutAttempt {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true, index: true })
  user: Types.ObjectId

  @Prop({ type: String, enum: ['checkout', 'plan_change'], required: true })
  kind: 'checkout' | 'plan_change'

  @Prop({ type: String })
  planName?: string

  @Prop({ type: String, enum: ['monthly', 'yearly'] })
  billingInterval?: 'monthly' | 'yearly'

  @Prop({ type: String })
  from?: string

  @Prop({ type: String })
  ref?: string

  @Prop({ type: String })
  priorFrom?: string

  @Prop({ type: String })
  priorRef?: string

  @Prop({ type: Boolean })
  fromCookie?: boolean

  @Prop({ type: String, index: true })
  checkoutSessionId?: string

  @Prop({ type: Boolean })
  reusedCheckout?: boolean

  // Polar discount on the checkout, null when none.
  @Prop({ type: String })
  discountId?: string | null

  @Prop({ type: Date })
  completedAt?: Date
}

export const CheckoutAttemptSchema = SchemaFactory.createForClass(CheckoutAttempt)

CheckoutAttemptSchema.index({ user: 1, createdAt: -1 })
CheckoutAttemptSchema.index({ createdAt: -1 })
