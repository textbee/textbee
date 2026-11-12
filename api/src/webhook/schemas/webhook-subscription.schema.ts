import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { Device } from '../../gateway/schemas/device.schema'
import { WebhookEvent } from '../webhook-event.enum'

export type WebhookSubscriptionDocument = WebhookSubscription & Document

@Schema({ timestamps: true })
export class WebhookSubscription {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user: User

  @Prop({ type: String, maxlength: 64, trim: true })
  name?: string

  @Prop({ type: Boolean, default: true })
  isActive: boolean

  @Prop({ type: [String], default: [WebhookEvent.MESSAGE_RECEIVED] })
  events: string[]

  // When set, only messages handled by this device are delivered. Unset means
  // every device on the account.
  @Prop({ type: SchemaTypes.ObjectId, ref: Device.name })
  deviceId?: Types.ObjectId

  @Prop({ type: String, required: true })
  deliveryUrl: string

  @Prop({ type: String, required: true })
  signingSecret: string

  @Prop({ type: Number, default: 0 })
  successfulDeliveryCount: number

  @Prop({ type: Number, default: 0 })
  deliveryFailureCount: number
  @Prop({ type: Number, default: 0 })
  deliveryAttemptCount: number

  @Prop({ type: Date })
  lastDeliveryAttemptAt: Date

  @Prop({ type: Date })
  lastDeliverySuccessAt: Date

  @Prop({ type: Date })
  lastDeliveryFailureAt: Date

  // Set when a user re-enables a previously disabled webhook. Used to prevent
  // the auto-disable cron from immediately disabling again due to historical
  // failures still within the lookback window.
  @Prop({ type: Date })
  lastEnabledAt?: Date

  @Prop({
    type: [{ at: { type: Date }, text: { type: String } }],
    default: [],
  })
  notes: { at: Date; text: string }[]

  @Prop({ type: Date })
  deletedAt?: Date
}

export const WebhookSubscriptionSchema =
  SchemaFactory.createForClass(WebhookSubscription)

// Replaces the legacy `{ user, events }` unique index. Multiple subscriptions
// per user are allowed; this compound index keeps the per-event fan-out query
// in `deliverNotification` fast.
WebhookSubscriptionSchema.index({ user: 1, isActive: 1, events: 1 })
