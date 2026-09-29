import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type CheckoutSessionDocument = CheckoutSession & Document

@Schema({ timestamps: true })
export class CheckoutSession {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user: User

  @Prop({ type: String, required: true })
  checkoutSessionId: string

  @Prop({ type: String, required: true })
  checkoutUrl: string

  @Prop({ type: String })
  planName?: string

  @Prop({ type: String, enum: ['monthly', 'yearly'] })
  billingInterval?: string

  @Prop({ type: Date, required: true })
  expiresAt: Date

  @Prop({ type: Object, required: true, default: {} })
  payload: any

  @Prop({ type: Boolean, default: false })
  isCompleted: boolean

  @Prop({ type: Boolean, default: false })
  isAbandoned: boolean

  @Prop({ type: Date })
  completedAt?: Date

  // Set on every new checkout, since one document is reused per user.
  @Prop({ type: Date })
  sessionStartedAt?: Date
}

export const CheckoutSessionSchema = SchemaFactory.createForClass(CheckoutSession)
