import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type EmailHistoryDocument = EmailHistory & Document

// One row per change of an account's email address.
@Schema({ timestamps: true, collection: 'emailhistory' })
export class EmailHistory {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true })
  user: User | Types.ObjectId

  @Prop({ type: String })
  oldEmail: string

  @Prop({ type: String })
  newEmail: string

  // 'user' or 'admin'.
  @Prop({ type: String })
  source: string

  @Prop({ type: String })
  reason?: string

  @Prop({ type: Date })
  oldEmailVerifiedAt?: Date

  @Prop({ type: Date })
  changedAt: Date

  // Who made an admin change.
  @Prop({ type: SchemaTypes.Mixed })
  actor?: unknown
}

export const EmailHistorySchema = SchemaFactory.createForClass(EmailHistory)
