import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NotificationSettingsDocument = NotificationSettings & Document

// A single document. Two of these flags are easy to confuse and must not be:
//
//   engineEnabled  chooses WHICH implementation renders. False means the
//                  dashboard keeps showing the original hardcoded banners, so it
//                  is the rollback, and it is the shipped default.
//   globalEnabled  decides whether ANY message shows once the engine is live.
//                  False silences even past-due and verification warnings, so it
//                  is a kill switch, not a rollback.
// Explicit: pluralising the class name would give 'notificationsettings', which
// is not the collection the engine flag is written to.
@Schema({ timestamps: true, collection: 'dashboardnotificationsettings' })
export class NotificationSettings {
  _id?: Types.ObjectId

  /** Only one settings document exists; this pins it. */
  @Prop({ type: String, required: true, unique: true, default: 'default' })
  scope: string

  @Prop({ type: Boolean, default: false })
  engineEnabled: boolean

  // Forces the engine on for named accounts while everyone else stays on the
  // legacy path, so it can be proven against production data with an audience
  // of one. Checked only while engineEnabled is false.
  @Prop({ type: [String], default: [] })
  engineEnabledForUserIds: string[]

  @Prop({ type: Boolean, default: true })
  globalEnabled: boolean

  @Prop({ type: Number, default: 2 })
  maxTilesAtOnce: number

  @Prop({ type: Number, default: 1 })
  maxModalsPerLoad: number

  @Prop({ type: Number, default: 24 })
  modalMinIntervalHours: number

  /** Operational alerts are exempt from the tile cap, but still take a slot. */
  @Prop({ type: Boolean, default: true })
  systemBypassesCap: boolean

  // Moved here from a build-time constant in the dashboard, so the outdated-app
  // prompt follows a release without a redeploy.
  @Prop({ type: Number, default: 20 })
  latestAppVersionCode: number
}

export const NotificationSettingsSchema =
  SchemaFactory.createForClass(NotificationSettings)
