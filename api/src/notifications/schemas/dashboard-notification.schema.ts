import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import {
  DismissMode,
  NotificationKind,
  Placement,
} from '../rules/notification-ranker'

export type DashboardNotificationDocument = DashboardNotification & Document

// One authored message for the dashboard. These are authored outside this
// service; this API
// owns the schema and the indexes and only reads them. Named dashboard* because
// billingnotifications and webhooknotifications already exist and are unrelated.

export const NOTIFICATION_KINDS: NotificationKind[] = ['system', 'campaign']
export const NOTIFICATION_PLACEMENTS: Placement[] = ['tile', 'modal']
export const NOTIFICATION_TONES = [
  'info',
  'success',
  'warning',
  'critical',
  'promo',
] as const
export const NOTIFICATION_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
] as const
export const DISMISS_MODES: DismissMode[] = ['permanent', 'snooze', 'session']

export type NotificationTone = (typeof NOTIFICATION_TONES)[number]
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number]

@Schema({ _id: false })
export class NotificationAction {
  @Prop({ type: String, required: true })
  label: string

  @Prop({ type: String, required: true })
  href: string

  @Prop({ type: String, default: 'primary' })
  style?: string

  @Prop({ type: String, default: 'self' })
  target?: string

  /** Distinguishes clicks when a variant offers two actions. */
  @Prop({ type: String })
  trackAs?: string
}

const NotificationActionSchema = SchemaFactory.createForClass(NotificationAction)

// One piece of copy. Several variants with weights replace the hardcoded arrays
// the old upgrade banner picked from with Math.random on every render.
@Schema({ _id: false })
export class NotificationVariant {
  @Prop({ type: String, required: true })
  id: string

  @Prop({ type: Number, default: 1 })
  weight?: number

  @Prop({ type: String, required: true })
  title: string

  @Prop({ type: String })
  body?: string

  @Prop({ type: [NotificationActionSchema], default: [] })
  actions?: NotificationAction[]
}

const NotificationVariantSchema =
  SchemaFactory.createForClass(NotificationVariant)

@Schema({ _id: false })
export class NotificationSchedule {
  @Prop({ type: Date })
  startsAt?: Date

  @Prop({ type: Date })
  endsAt?: Date
}

const NotificationScheduleSchema =
  SchemaFactory.createForClass(NotificationSchedule)

@Schema({ _id: false })
export class NotificationDismiss {
  @Prop({ type: Boolean, default: false })
  enabled?: boolean

  @Prop({ type: String, enum: DISMISS_MODES, default: 'permanent' })
  mode?: DismissMode

  @Prop({ type: Number })
  snoozeHours?: number

  /** Client-side guard: the close control stays inert for this long. */
  @Prop({ type: Number })
  requireSeconds?: number

  @Prop({ type: Boolean, default: false })
  resetOnConditionChange?: boolean
}

const NotificationDismissSchema =
  SchemaFactory.createForClass(NotificationDismiss)

@Schema({ _id: false })
export class NotificationFrequency {
  @Prop({ type: Number })
  maxImpressionsPerUser?: number

  @Prop({ type: Number })
  minHoursBetweenImpressions?: number

  @Prop({ type: Number })
  maxImpressionsTotal?: number
}

const NotificationFrequencySchema =
  SchemaFactory.createForClass(NotificationFrequency)

@Schema({ _id: false })
export class NotificationStats {
  @Prop({ type: Number, default: 0 })
  impressions?: number

  @Prop({ type: Number, default: 0 })
  clicks?: number

  @Prop({ type: Number, default: 0 })
  dismisses?: number

  /** Per variant, keyed by variant id, for comparing copy. */
  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  byVariant?: Record<string, { impressions?: number; clicks?: number; dismisses?: number }>
}

const NotificationStatsSchema = SchemaFactory.createForClass(NotificationStats)

// Who the message is for, so cross-promotion of the other products and any
// future third-party placement can be told apart in reporting.
@Schema({ _id: false })
export class NotificationSource {
  @Prop({ type: String })
  product?: string

  @Prop({ type: String, default: 'textbee' })
  owner?: string
}

const NotificationSourceSchema = SchemaFactory.createForClass(NotificationSource)

// Named explicitly. This collection is read and written outside this service,
// and leaving the name to Mongoose's pluralisation is how two codebases end up
// on two different collections while looking correct in both.
@Schema({ timestamps: true, collection: 'dashboardnotifications' })
export class DashboardNotification {
  _id?: Types.ObjectId

  // Stable slug. Seeding upserts on it, and the dashboard selects a bespoke
  // renderer by it, so it must not change once a record exists.
  @Prop({ type: String, required: true, unique: true })
  key: string

  @Prop({
    type: String,
    enum: NOTIFICATION_KINDS,
    required: true,
    default: 'campaign',
  })
  kind: NotificationKind

  @Prop({
    type: String,
    enum: NOTIFICATION_PLACEMENTS,
    required: true,
    default: 'tile',
  })
  placement: Placement

  @Prop({ type: String, enum: NOTIFICATION_TONES, default: 'info' })
  tone: NotificationTone

  /** 'standard', or a key the dashboard's renderer map recognises. */
  @Prop({ type: String, default: 'standard' })
  renderer?: string

  @Prop({ type: [NotificationVariantSchema], default: [] })
  variants: NotificationVariant[]

  // Condition tree. Mixed because its shape is recursive; it is validated by
  // hand against the attribute registry before use, since this app has no
  // global ValidationPipe and an operator-authored rule must never reach a
  // query unchecked.
  @Prop({ type: SchemaTypes.Mixed, default: null })
  audience?: Record<string, any> | null

  @Prop({ type: NotificationScheduleSchema })
  schedule?: NotificationSchedule

  @Prop({ type: Number, default: 0 })
  priority: number

  /** Relative odds within one priority, for rotation rather than a fixed order. */
  @Prop({ type: Number, default: 1 })
  weight: number

  /** At most one record per group is served in a feed. */
  @Prop({ type: String, default: null })
  group?: string | null

  @Prop({ type: NotificationDismissSchema, default: () => ({}) })
  dismiss?: NotificationDismiss

  @Prop({ type: NotificationFrequencySchema, default: () => ({}) })
  frequency?: NotificationFrequency

  @Prop({
    type: String,
    enum: NOTIFICATION_STATUSES,
    required: true,
    default: 'draft',
    index: true,
  })
  status: NotificationStatus

  @Prop({ type: NotificationStatsSchema, default: () => ({}) })
  stats?: NotificationStats

  @Prop({ type: NotificationSourceSchema, default: () => ({}) })
  source?: NotificationSource

  /** Registry version the audience was authored against. */
  @Prop({ type: Number, default: 1 })
  audienceSchemaVersion?: number

  @Prop({ type: String })
  notes?: string
}

export const DashboardNotificationSchema = SchemaFactory.createForClass(
  DashboardNotification,
)

// The feed's only query: everything currently publishable, ordered the way the
// ranker wants it before it even starts.
DashboardNotificationSchema.index({ status: 1, priority: -1, createdAt: 1 })
