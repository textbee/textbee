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

  /** Campaign tiles shown by default. */
  @Prop({ type: Number, default: 2 })
  maxTilesAtOnce: number

  // Operational tiles draw on their own budget. Sharing one with campaigns let
  // a few alerts nobody can dismiss make every campaign unreachable.
  @Prop({ type: Number, default: 2 })
  maxSystemTilesAtOnce: number

  /** Extra campaign tiles served collapsed, behind a "more" control. */
  @Prop({ type: Number, default: 3 })
  overflowTiles: number

  /** Shared across kinds, so at most one dialog is ever open. */
  @Prop({ type: Number, default: 1 })
  maxModalsPerLoad: number

  /** Holds back campaign dialogs after the account has seen any dialog. */
  @Prop({ type: Number, default: 24 })
  modalMinIntervalHours: number

  // Moved here from a build-time constant in the dashboard, so the prompt to
  // update follows a release without a redeploy.
  @Prop({ type: Number, default: 20 })
  latestAppVersionCode: number

  // How recently a phone must have reported in for its "permission is off"
  // report to count. A phone rewrites this on every heartbeat, so a live one is
  // never far behind; too long a window instead flags phones that went offline
  // and tells those accounts the wrong thing. Tunable because the right value
  // depends on how often phones actually check in.
  @Prop({ type: Number, default: 6 })
  smsPermissionHeartbeatHours: number

  /** How long "gone for this visit" lasts, since there is no session here. */
  @Prop({ type: Number, default: 4 })
  sessionSnoozeHours: number
}

export const NotificationSettingsSchema =
  SchemaFactory.createForClass(NotificationSettings)
