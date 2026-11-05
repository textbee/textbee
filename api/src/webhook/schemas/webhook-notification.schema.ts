import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { WebhookSubscription } from './webhook-subscription.schema'
import { SMS } from '../../gateway/schemas/sms.schema'

export type WebhookNotificationDocument = WebhookNotification & Document

@Schema({ timestamps: true })
export class WebhookNotification {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: WebhookSubscription.name, required: true })
  webhookSubscription: Types.ObjectId | WebhookSubscription

  @Prop({ type: String, required: true })
  event: string

  @Prop({ type: Object, required: true })
  payload: object

  @Prop({ type: SchemaTypes.ObjectId, ref: SMS.name })
  sms: SMS

  @Prop({ type: Date })
  deliveredAt: Date

  @Prop({ type: Date })
  lastDeliveryAttemptAt: Date

  @Prop({ type: Date })
  nextDeliveryAttemptAt: Date

  @Prop({ type: Number, default: 0 })
  deliveryAttemptCount: number

  @Prop({ type: Date })
  deliveryAttemptAbortedAt: Date

  @Prop({ type: String })
  idempotencyKey?: string

  @Prop({ type: String, enum: ['retryable', 'non-retryable'] })
  errorType?: string

  @Prop({ type: Number })
  httpStatusCode?: number

  @Prop({ type: String, maxlength: 1000 })
  responseBody?: string

  @Prop({ type: String })
  deliveryUrl?: string
}

export const WebhookNotificationSchema =
  SchemaFactory.createForClass(WebhookNotification)

// Serves the repeated-report check on every status update. Build on Atlas
// before deploying.
WebhookNotificationSchema.index({ sms: 1, event: 1, webhookSubscription: 1 })

// Serves delivery history: one subscription's notifications, newest first,
// and their count. Build on Atlas before deploying.
WebhookNotificationSchema.index({
  webhookSubscription: 1,
  createdAt: -1,
  _id: -1,
})
