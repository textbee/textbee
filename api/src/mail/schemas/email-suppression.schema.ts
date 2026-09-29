import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type EmailSuppressionDocument = EmailSuppression & Document

// Addresses that bounced permanently or complained. No email goes to them.
@Schema({ collection: 'emailsuppressions' })
export class EmailSuppression {
  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  email: string

  @Prop({ type: String, enum: ['bounce', 'complaint'], required: true })
  reason: 'bounce' | 'complaint'

  @Prop({ type: String, default: 'ses' })
  source: string

  @Prop({ type: Date, required: true })
  at: Date

  @Prop({ type: String })
  detail?: string
}

export const EmailSuppressionSchema = SchemaFactory.createForClass(EmailSuppression)
