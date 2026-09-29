import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import { DashboardNotification } from './dashboard-notification.schema'

export type NotificationStateDocument = NotificationState & Document

// One account's history with one notification. Server side rather than
// localStorage so a dismissal survives a new browser or device, so prior
// exposure is targetable, and so there is anything at all to report on.
// Explicit: pluralising the class name would give 'notificationstates', which
// is not the collection read outside this service.
@Schema({ timestamps: true, collection: 'dashboardnotificationstates' })
export class NotificationState {
  _id?: Types.ObjectId

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: User.name,
    required: true,
    index: true,
  })
  user: User | Types.ObjectId

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DashboardNotification.name,
    required: true,
  })
  notification: DashboardNotification | Types.ObjectId

  @Prop({ type: Number, default: 0 })
  impressions: number

  @Prop({ type: Date })
  firstSeenAt?: Date

  @Prop({ type: Date })
  lastSeenAt?: Date

  @Prop({ type: Date })
  clickedAt?: Date

  @Prop({ type: Date })
  dismissedAt?: Date

  @Prop({ type: Date })
  snoozedUntil?: Date

  /** Which copy this account was last shown, so reporting can attribute it. */
  @Prop({ type: String })
  lastVariantId?: string
}

export const NotificationStateSchema =
  SchemaFactory.createForClass(NotificationState)

// The feed reads every row for one account in a single query, and the event
// endpoint upserts on the pair. billingnotifications upserts on {user, type}
// without such an index; do not repeat that here.
NotificationStateSchema.index({ user: 1, notification: 1 }, { unique: true })

// The per-account history view, newest first.
NotificationStateSchema.index({ user: 1, lastSeenAt: -1 })

// Per-notification reporting across accounts.
NotificationStateSchema.index({ notification: 1, lastSeenAt: -1 })
