import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { Device } from './device.schema'
import { SMS } from './sms.schema'
import { User } from '../../users/schemas/user.schema'

export type SMSPartReportDocument = SMSPartReport & Document

export const PART_REPORT_TTL_SECONDS = 90 * 24 * 60 * 60

// One raw status report from the phone, per part. Never returned by the API.
@Schema({ collection: 'smspartreports' })
export class SMSPartReport {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: SMS.name, required: true })
  sms: SMS | Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: Device.name, required: true })
  device: Device | Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user?: User | Types.ObjectId

  // {partIndex}_{status}_{deliveryStatus}, so a repeat is stored once
  @Prop({ type: String, required: true })
  key: string

  @Prop({ type: Number, required: true })
  partIndex: number

  @Prop({ type: Number, required: true })
  partCount: number

  // the status the phone sent
  @Prop({ type: String, required: true })
  status: string

  // the phone time of the report, when it sent a plausible one
  @Prop({ type: Date })
  at?: Date

  @Prop({ type: Number })
  resultCode?: number

  @Prop({ type: Number })
  radioErrorCode?: number

  @Prop({
    type: {
      format: String,
      status: Number,
      dischargeAt: Date,
      pdu: Buffer,
    },
    _id: false,
  })
  deliveryReport?: {
    format?: string
    status?: number
    dischargeAt?: Date
    pdu?: Buffer
  }

  @Prop({ type: Date, required: true })
  receivedAt: Date
}

export const SMSPartReportSchema = SchemaFactory.createForClass(SMSPartReport)

SMSPartReportSchema.index({ sms: 1, key: 1 }, { unique: true })
SMSPartReportSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: PART_REPORT_TTL_SECONDS },
)
