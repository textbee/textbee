import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes } from 'mongoose'

export type AppConfigDocument = AppConfig & Document<string>

// App settings per platform; textbee-admin writes values, this API writes env
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

  // This API's env level, written at startup for the admin page; never read here
  @Prop({ type: SchemaTypes.Mixed })
  env?: Record<string, unknown>

  @Prop({ type: Date })
  envUpdatedAt?: Date
}

export const AppConfigSchema = SchemaFactory.createForClass(AppConfig)
