import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type SentEmailDocument = SentEmail & Document

@Schema({ timestamps: true, collection: 'sentemails' })
export class SentEmail {
  _id?: Types.ObjectId

  @Prop({ type: String, enum: ['api', 'plus', 'backfill'], required: true })
  source: 'api' | 'plus' | 'backfill'

  @Prop({ type: String })
  category?: string

  @Prop({ type: String })
  type?: string

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user?: User | Types.ObjectId

  @Prop({ type: [String], default: [] })
  to: string[]

  @Prop({ type: [String], default: [] })
  cc: string[]

  @Prop({ type: String })
  from?: string

  @Prop({ type: String })
  replyTo?: string

  @Prop({ type: String })
  subject?: string

  @Prop({ type: String, default: null })
  html?: string | null

  @Prop({ type: String, enum: ['sent', 'failed', 'skipped'], required: true })
  status: 'sent' | 'failed' | 'skipped'

  @Prop({ type: String })
  error?: string

  @Prop({ type: String })
  providerMessageId?: string

  @Prop({ type: String })
  providerResponse?: string

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta?: Record<string, any>

  @Prop({ type: Date, required: true })
  sentAt: Date

  @Prop({ type: String })
  backfillKey?: string
}

export const SentEmailSchema = SchemaFactory.createForClass(SentEmail)

SentEmailSchema.index({ user: 1, sentAt: -1 })
SentEmailSchema.index({ sentAt: -1 })
SentEmailSchema.index({ type: 1, sentAt: -1 })
SentEmailSchema.index({ to: 1 })
SentEmailSchema.index(
  { backfillKey: 1 },
  { unique: true, partialFilterExpression: { backfillKey: { $exists: true } } },
)
