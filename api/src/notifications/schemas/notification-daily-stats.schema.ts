import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'

export type NotificationDailyStatsDocument = NotificationDailyStats & Document

// One document per UTC day describing how the dashboard notification engine
// behaved. Nothing on the feed request path writes here: the accumulator in
// notification-metrics.service.ts holds the counters in process and flushes
// them on a timer, so the volume is fixed no matter how much traffic arrives.
// Operators read these numbers elsewhere.
//
// Every per-record map is keyed by the record's _id hex, never by its key.
// Record keys are operator-authored and only checked for uniqueness, so a key
// containing a dot or a dollar would rewrite the wrong part of the document.

@Schema({ _id: false })
export class NotificationLatencyBuckets {
  @Prop({ type: Number, default: 0 })
  lt50: number

  @Prop({ type: Number, default: 0 })
  lt150: number

  @Prop({ type: Number, default: 0 })
  lt500: number

  @Prop({ type: Number, default: 0 })
  lt1500: number

  @Prop({ type: Number, default: 0 })
  gte1500: number
}

const NotificationLatencyBucketsSchema = SchemaFactory.createForClass(
  NotificationLatencyBuckets,
)

// How much of the account base the targeting rules can actually judge. An
// attribute nobody has data for silently shrinks every audience that reads it.
@Schema({ _id: false })
export class NotificationCoverage {
  @Prop({ type: Number })
  accounts?: number

  @Prop({ type: Number })
  rollupComputed?: number

  @Prop({ type: Number })
  milestoneFirstSms?: number

  @Prop({ type: Number })
  stateRows?: number

  @Prop({ type: Date })
  at?: Date
}

const NotificationCoverageSchema =
  SchemaFactory.createForClass(NotificationCoverage)

// Named explicitly. This collection is read outside this service, and leaving
// the name to Mongoose's pluralisation is how two codebases end up on two
// different collections while looking correct in both.
@Schema({ timestamps: true, collection: 'dashboardnotificationdailystats' })
export class NotificationDailyStats {
  _id?: Types.ObjectId

  /** UTC day, as 2026-10-26. The accumulator upserts on it. */
  @Prop({ type: String, required: true, unique: true })
  day: string

  /** Every feed request, whatever it returned, including the errored ones. */
  @Prop({ type: Number, default: 0 })
  feeds: number

  @Prop({ type: Number, default: 0 })
  feedsEngineOff: number

  @Prop({ type: Number, default: 0 })
  feedsGlobalOff: number

  @Prop({ type: Number, default: 0 })
  feedsNoCandidates: number

  // Engine on, candidates existed, nothing survived the rules. The one empty
  // feed that means something is wrong rather than something is switched off.
  @Prop({ type: Number, default: 0 })
  feedsZeroServed: number

  // A throw drops the dashboard back to its built-in messages, so without this
  // a completely broken engine looks the same as one deliberately turned off.
  @Prop({ type: Number, default: 0 })
  feedsErrored: number

  /** Divide by feeds for the mean. Buckets carry the shape. */
  @Prop({ type: Number, default: 0 })
  latencyMsTotal: number

  @Prop({ type: NotificationLatencyBucketsSchema, default: () => ({}) })
  latencyBuckets?: NotificationLatencyBuckets

  @Prop({ type: Number, default: 0 })
  candidateCacheHits: number

  @Prop({ type: Number, default: 0 })
  candidateCacheMisses: number

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  servedById?: Record<string, number>

  /** Keyed `${idHex}:${reason}`, so one record's verdicts stay separable. */
  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  filteredByIdReason?: Record<string, number>

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  filteredByReason?: Record<string, number>

  /** Attribute keys with dots replaced by underscores, so they are writable. */
  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  unknownAttrs?: Record<string, number>

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  impressionsById?: Record<string, number>

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  clicksById?: Record<string, number>

  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  dismissesById?: Record<string, number>

  /** Replayed dismissals, held apart so they cannot distort a dismiss rate. */
  @Prop({ type: SchemaTypes.Mixed, default: () => ({}) })
  migratedDismissesById?: Record<string, number>

  // Accounts whose whole feed was undismissable operational tiles while
  // something else was waiting on the budget.
  @Prop({ type: Number, default: 0 })
  capBlockedBySystem: number

  /** A sample of the accounts above, capped, so a few can be looked at. */
  @Prop({ type: [String], default: [] })
  capBlockedSample?: string[]

  @Prop({ type: NotificationCoverageSchema, default: () => ({}) })
  coverage?: NotificationCoverage
}

export const NotificationDailyStatsSchema = SchemaFactory.createForClass(
  NotificationDailyStats,
)
