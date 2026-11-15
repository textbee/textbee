import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type EmailVerificationDocument = EmailVerification & Document

@Schema({ timestamps: true })
export class EmailVerification {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user: User | Types.ObjectId

  @Prop({ type: String })
  verificationCode: string // hashed

  @Prop({ type: Date })
  expiresAt: Date

  // The address the link was mailed to. Absent on older rows.
  @Prop({ type: String })
  email?: string

  // 'reminder' for links minted by the reminder job, absent otherwise.
  @Prop({ type: String })
  source?: string

  createdAt?: Date
}

export const EmailVerificationSchema =
  SchemaFactory.createForClass(EmailVerification)
