import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { UserRole } from '../user-roles.enum'

export type UserDocument = User & Document

// One visit that brought someone to the site. Stored as captured so a later
// report can group by whichever field turns out to matter, rather than only by
// the normalised signupSource.
@Schema({ _id: false })
export class AttributionTouch {
  @Prop({ type: String })
  source?: string

  @Prop({ type: String })
  medium?: string

  @Prop({ type: String })
  campaign?: string

  @Prop({ type: String })
  content?: string

  @Prop({ type: String })
  term?: string

  @Prop({ type: String })
  ref?: string

  @Prop({ type: String })
  referrer?: string

  @Prop({ type: String })
  landingPath?: string

  @Prop({ type: String })
  fbclid?: string

  @Prop({ type: String })
  gclid?: string

  @Prop({ type: Date })
  at?: Date
}

const AttributionTouchSchema = SchemaFactory.createForClass(AttributionTouch)

// The first visit ever, source or not. Kept separate from first-touch so a
// direct visit records where it landed without claiming credit from a later
// campaign click.
@Schema({ _id: false })
export class AttributionEntry {
  @Prop({ type: String })
  landingPath?: string

  @Prop({ type: Date })
  at?: Date
}

const AttributionEntrySchema = SchemaFactory.createForClass(AttributionEntry)

@Schema({ _id: false })
export class Attribution {
  @Prop({ type: AttributionEntrySchema })
  entry?: AttributionEntry

  @Prop({ type: AttributionTouchSchema })
  first?: AttributionTouch

  @Prop({ type: AttributionTouchSchema })
  last?: AttributionTouch

  // Meta's browser cookie, needed to match a server-side conversion event back
  // to the ad click.
  @Prop({ type: String })
  fbp?: string

  @Prop({ type: Date })
  capturedAt?: Date
}

const AttributionSchema = SchemaFactory.createForClass(Attribution)

// First time the account reached each step. Written once and never updated, so
// a funnel report is a query over users alone rather than a scan of sends.
@Schema({ _id: false })
export class UserMilestones {
  @Prop({ type: Date })
  firstDeviceAt?: Date

  @Prop({ type: Date })
  firstApiKeyAt?: Date

  @Prop({ type: Date })
  firstSmsAt?: Date

  @Prop({ type: Date })
  firstPaidAt?: Date
}

const UserMilestonesSchema = SchemaFactory.createForClass(UserMilestones)

// Lifetime summary of where an account has been used from. The rows behind it
// live in their own collection, one per distinct origin, and expire; these
// sets do not, so a report can still say which regions an account has ever
// been used from after the detail has aged out.
@Schema({ _id: false })
export class UserAccess {
  @Prop({ type: [String], default: [] })
  countries: string[]

  @Prop({ type: [String], default: [] })
  channels: string[]

  // Distinct origins ever recorded. Compared against a ceiling before a new
  // one is written, so one account cannot grow the collection without bound.
  @Prop({ type: Number, default: 0 })
  addressesSeen: number

  @Prop({ type: Date })
  updatedAt?: Date
}

const UserAccessSchema = SchemaFactory.createForClass(UserAccess)

@Schema({ _id: false })
export class ClientInfo {
  @Prop({ type: String })
  device?: string

  @Prop({ type: String })
  os?: string

  @Prop({ type: String })
  browser?: string

  @Prop({ type: String })
  userAgent?: string

  @Prop({ type: Date })
  at?: Date
}

const ClientInfoSchema = SchemaFactory.createForClass(ClientInfo)

@Schema({ _id: false })
export class UserClient {
  @Prop({ type: ClientInfoSchema })
  signup?: ClientInfo

  @Prop({ type: ClientInfoSchema })
  last?: ClientInfo
}

const UserClientSchema = SchemaFactory.createForClass(UserClient)

// Slow-to-derive counts about the account, kept here rather than computed on
// read.
//
// Two apps have to resolve the same targeting attributes and they never call
// each other, so anything either would compute by aggregation is a candidate to
// be stored once here instead. Reading these also removes a per-request scan of
// every device document from the dashboard's critical path.
//
// Deliberately NOT here: the monthly and daily message counts. The quota the
// account is actually measured against is a sliding window (see
// billing.service canPerformAction), which no counter can track by increment,
// and a stored number that disagreed with the real wall would make the quota
// warnings wrong. Those are counted on demand instead, against the shared
// window boundaries in notifications/rules/usage-window.ts.
@Schema({ _id: false })
export class UserRollup {
  // No defaults on the counts. A zero here would be indistinguishable from
  // "never computed", and zero devices is a targetable fact. Readers gate on
  // computedAt, and this keeps the stored document from asserting a zero nobody
  // measured.
  @Prop({ type: Number })
  deviceCount?: number

  @Prop({ type: Number })
  apiKeyCount?: number

  /** Summed from the device counters, matching the dashboard's own totals. */
  @Prop({ type: Number })
  totalSentSms?: number

  /** Oldest app build across the account's devices, for the update prompt. */
  @Prop({ type: Number })
  minAppVersionCode?: number

  @Prop({ type: Date })
  computedAt?: Date
}

const UserRollupSchema = SchemaFactory.createForClass(UserRollup)

@Schema({ _id: false })
export class EmailPreferences {
  @Prop({ type: Boolean })
  productEmails?: boolean

  @Prop({ type: Date })
  changedAt?: Date
}

const EmailPreferencesSchema = SchemaFactory.createForClass(EmailPreferences)

@Schema({ timestamps: true })
export class User {
  _id?: Types.ObjectId

  @Prop({ type: String })
  name: string

  @Prop({ type: String, required: true, unique: true, lowercase: true })
  email: string

  @Prop({ type: String, unique: true, sparse: true })
  googleId?: string

  @Prop({ type: String })
  avatar?: string

  @Prop({ type: String, trim: true })
  phone?: string

  // Never loaded unless a caller asks with .select('+password').
  @Prop({ type: String, select: false })
  password: string

  @Prop({ type: String, default: UserRole.REGULAR })
  role: string

  @Prop({ type: Date })
  lastLoginAt: Date

  @Prop({ type: Date })
  emailVerifiedAt: Date

  // Lets an unverified account send and receive. Set by an operator only.
  @Prop({ type: Date, select: false })
  emailVerificationWaivedAt?: Date

  @Prop({ type: String, select: false })
  emailVerificationWaivedReason?: string

  @Prop({ type: Boolean, default: false })
  isBanned: boolean

  @Prop({ type: Date })
  accountDeletionRequestedAt: Date

  @Prop({ type: String })
  accountDeletionReason: string

  @Prop({ type: Object })
  meta: Object

  // Normalised acquisition channel, for example meta, reddit, google, direct.
  @Prop({ type: String, index: true })
  signupSource?: string

  // Device class the account was created on: android, ios, desktop or other.
  // An advert seen on an iPhone can still lead to a gateway on a spare Android,
  // so this is compared against milestones.firstDeviceAt rather than assumed.
  @Prop({ type: String })
  signupDevice?: string

  @Prop({ type: UserClientSchema })
  client?: UserClient

  // Two-letter region code of the request that created the account, when the
  // edge network reported one.
  @Prop({ type: String })
  signupCountry?: string

  @Prop({ type: UserAccessSchema, default: () => ({}) })
  access?: UserAccess

  @Prop({ type: AttributionSchema })
  attribution?: Attribution

  @Prop({ type: Boolean, default: false })
  marketingOptIn?: boolean

  // Absent means product emails are on. Account notices ignore it.
  @Prop({ type: EmailPreferencesSchema })
  emailPreferences?: EmailPreferences

  @Prop({ type: UserMilestonesSchema, default: () => ({}) })
  milestones?: UserMilestones

  // Read on every authenticated request, because the auth guard loads the whole
  // user document. That is accepted: it is a handful of numbers on a document
  // that already carries attribution, access, client, milestones and
  // onboarding, and marking it select:false would break every req.user.rollup
  // read for no meaningful saving.
  @Prop({ type: UserRollupSchema, default: () => ({}) })
  rollup?: UserRollup

  @Prop({
    type: {
      completedAt: { type: Date },
      currentStepId: { type: String, default: 'verify_email' },
      skippedStepIds: { type: [String], default: [] },
    },
    default: () => ({ currentStepId: 'verify_email', skippedStepIds: [] }),
  })
  onboarding?: {
    completedAt?: Date
    currentStepId?: string
    skippedStepIds?: string[]
  }
}

export const UserSchema = SchemaFactory.createForClass(User)

// Acquisition reports read by channel over a date window.
UserSchema.index({ signupSource: 1, createdAt: -1 })

// The same reports read by region, and the users list filters on where an
// account has been used from.
UserSchema.index({ signupCountry: 1, createdAt: -1 })
UserSchema.index({ 'access.countries': 1 })

UserSchema.index({ signupDevice: 1, createdAt: -1 })

// Scheduled emails find accounts verified in a recent window.
UserSchema.index({ emailVerifiedAt: 1 })

// Scheduled emails find accounts that connected their first phone recently.
UserSchema.index({ 'milestones.firstDeviceAt': 1 })

// Scheduled emails find accounts that sent their first message recently.
UserSchema.index({ 'milestones.firstSmsAt': 1 })
