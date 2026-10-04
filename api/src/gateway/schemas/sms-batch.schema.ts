import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { Device } from './device.schema'
import { User } from '../../users/schemas/user.schema'

export type SMSBatchDocument = SMSBatch & Document

@Schema({ timestamps: true })
export class SMSBatch {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name, required: true, index: true })
  user: User | Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: Device.name })
  device: Device

  @Prop({ type: String })
  message: string

  @Prop({ type: Boolean, default: false })
  encrypted: boolean

  @Prop({ type: String })
  encryptedMessage: string

  @Prop({ type: Number })
  recipientCount: number

  @Prop({ type: String })
  recipientPreview: string

  // Counters are recalculated from the batch's messages
  @Prop({ type: Number, default: 0 })
  successCount: number

  @Prop({ type: Number, default: 0 })
  failureCount: number

  @Prop({ type: Number })
  pendingCount: number

  @Prop({ type: Number })
  dispatchedCount: number

  @Prop({ type: Number })
  sentCount: number

  @Prop({ type: Number })
  deliveredCount: number

  @Prop({ type: Number })
  unknownCount: number

  @Prop({ type: String, default: 'pending' })
  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'partial_success'
    | 'failed'
    | 'unknown'

  @Prop({ type: String })
  error: string

  @Prop({ type: Date })
  completedAt: Date

  @Prop({ type: Date })
  statusCheckedAt: Date

  // misc metadata for debugging
  @Prop({ type: Object })
  metadata: Record<string, any>
}

export const SMSBatchSchema = SchemaFactory.createForClass(SMSBatch)

SMSBatchSchema.index({ user: 1, createdAt: -1 })
