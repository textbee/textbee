import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type EmailTemplateDocument = EmailTemplate & Document

@Schema({ _id: false })
export class EmailTemplateHistoryEntry {
  @Prop({ type: Number })
  version: number

  @Prop({ type: String })
  subject?: string

  @Prop({ type: String })
  preheader?: string

  @Prop({ type: String })
  body?: string

  @Prop({ type: Boolean })
  enabled?: boolean

  @Prop({ type: Date })
  at: Date

  @Prop({ type: String })
  by: string

  @Prop({
    type: String,
    enum: ['edit', 'toggle', 'reset', 'reset-all', 'restore'],
  })
  action: 'edit' | 'toggle' | 'reset' | 'reset-all' | 'restore'
}

const EmailTemplateHistoryEntrySchema = SchemaFactory.createForClass(
  EmailTemplateHistoryEntry,
)

// Admin overrides of the bundled email copy. No row means the default applies.
@Schema({ collection: 'emailtemplates' })
export class EmailTemplate {
  @Prop({ type: String, required: true, unique: true })
  key: string

  @Prop({ type: String })
  subject?: string

  @Prop({ type: String })
  preheader?: string

  @Prop({ type: String })
  body?: string

  @Prop({ type: Boolean })
  enabled?: boolean

  @Prop({ type: Number, default: 1 })
  version: number

  @Prop({ type: Date })
  updatedAt?: Date

  @Prop({ type: String })
  updatedBy?: string

  @Prop({ type: [EmailTemplateHistoryEntrySchema], default: [] })
  history: EmailTemplateHistoryEntry[]
}

export const EmailTemplateSchema = SchemaFactory.createForClass(EmailTemplate)
