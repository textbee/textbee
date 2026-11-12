import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes } from 'mongoose'

export type AppConfigDocument = AppConfig & Document<string>

// Changed app settings per platform; textbee-admin writes, this API reads
@Schema({ collection: 'appconfigs', versionKey: false })
export class AppConfig {
  @Prop({ type: String })
  _id: string

  @Prop({ type: SchemaTypes.Mixed })
  values?: Record<string, unknown>

  @Prop({ type: Date })
  updatedAt?: Date

  @Prop({ type: SchemaTypes.Mixed })
  updatedBy?: unknown
}

export const AppConfigSchema = SchemaFactory.createForClass(AppConfig)
