import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type BillingSettingDocument = BillingSetting & Document

export const BILLING_SETTINGS_KEY = 'default'

// One document, keyed 'default'. The admin app writes it and this API only
// reads it. The collection name is shared, so it is set explicitly.
@Schema({ collection: 'billingsettings' })
export class BillingSetting {
  @Prop({ type: String, required: true })
  key: string

  // Polar discount applied to new checkouts. Unset means the env fallback.
  @Prop({ type: String, default: null })
  checkoutDiscountId?: string | null

  // Earliest time the discount is applied. Unset means the Polar start only.
  @Prop({ type: Date, default: null })
  checkoutDiscountActiveFrom?: Date | null

  @Prop({ type: Date })
  updatedAt?: Date

  @Prop({ type: String })
  updatedBy?: string
}

export const BillingSettingSchema = SchemaFactory.createForClass(BillingSetting)
