import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type PasswordResetDocument = PasswordReset & Document

@Schema({ timestamps: true })
export class PasswordReset {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user: User | Types.ObjectId

  @Prop({ type: String })
  otp: string

  @Prop({ type: Date })
  expiresAt: Date

  // OTP verification attempts, used to lock the record out of brute-forcing.
  @Prop({ type: Number, default: 0 })
  attempts: number

  // The address the code was mailed to. Absent on older rows.
  @Prop({ type: String })
  email?: string

  createdAt?: Date
}

export const PasswordResetSchema = SchemaFactory.createForClass(PasswordReset)
