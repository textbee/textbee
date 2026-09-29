import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type PolarWebhookPayloadDocument = PolarWebhookPayload & Document

@Schema({ timestamps: true })
export class PolarWebhookPayload {
  @Prop()
  userId: string

  @Prop()
  eventType: string

  @Prop()
  name: string

  @Prop()
  email: string

  @Prop({ type: Object })
  payload: Record<string, any>

  @Prop()
  productId: string

  @Prop()
  productName: string
}

export const PolarWebhookPayloadSchema = SchemaFactory.createForClass(PolarWebhookPayload)

// Past events for one provider object, newest first.
PolarWebhookPayloadSchema.index({ 'payload.data.id': 1, createdAt: -1 })
