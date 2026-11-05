import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type PlanDocument = Plan & Document

@Schema({ timestamps: true })
export class Plan {
  @Prop({ required: true, unique: true })
  name: string // free, pro, custom

  @Prop({ required: true })
  dailyLimit: number

  @Prop({ required: true })
  monthlyLimit: number

  @Prop({ required: true })
  bulkSendLimit: number

  // max number of enabled devices; -1 means unlimited
  @Prop({ type: Number, default: -1 })
  deviceLimit?: number

  // max number of webhook subscriptions; -1 means unlimited. No default on
  // purpose: absent falls back to MAX_WEBHOOKS_PER_USER
  @Prop({ type: Number })
  webhookLimit?: number

  @Prop({ required: true })
  monthlyPrice: number // in cents

  @Prop({})
  yearlyPrice: number // in cents

  // sparse: without it, a second plan leaving these unset collides on null
  @Prop({ type: String, index: { unique: true, sparse: true } })
  polarProductId?: string

  @Prop({ type: String, index: { unique: true, sparse: true } })
  polarMonthlyProductId?: string

  @Prop({ type: String, index: { unique: true, sparse: true } })
  polarYearlyProductId?: string

  @Prop({ type: Boolean, default: true })
  isActive: boolean
}

export const PlanSchema = SchemaFactory.createForClass(Plan)
