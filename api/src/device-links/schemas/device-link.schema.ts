import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type DeviceLinkDocument = DeviceLink & Document

export const DEVICE_LINK_STATUSES = [
  'pending',
  'approved',
  'denied',
  'delivering',
  'delivered',
  'completed',
  'expired',
] as const
export type DeviceLinkStatus = (typeof DEVICE_LINK_STATUSES)[number]

export const DEVICE_LINK_ACTIONS = ['new', 'reconnect'] as const
export type DeviceLinkAction = (typeof DEVICE_LINK_ACTIONS)[number]

export const DEVICE_LINK_MODES = ['choose', 'reconnect-only', 'blocked'] as const
export type DeviceLinkMode = (typeof DEVICE_LINK_MODES)[number]

// One attempt of a phone to connect to an account by sign-in
@Schema({ timestamps: true, collection: 'devicelinks' })
export class DeviceLink {
  _id?: Types.ObjectId

  // 8 characters, stored without the hyphen
  @Prop({ type: String, required: true })
  code: string

  // SHA-256 of the poll token; the token itself is never stored
  @Prop({ type: String, required: true })
  pollTokenHash: string

  @Prop({ type: String, enum: DEVICE_LINK_STATUSES, required: true })
  status: DeviceLinkStatus

  // Facts the phone sent at create
  @Prop({ type: String })
  deviceName: string

  @Prop({ type: String })
  brand: string

  @Prop({ type: String })
  manufacturer?: string

  @Prop({ type: String })
  model: string

  @Prop({ type: Number })
  appVersionCode: number

  @Prop({ type: String })
  appVersionName?: string

  @Prop({ type: Number })
  osApiLevel?: number

  @Prop({ type: String })
  locale?: string

  @Prop({ type: String })
  installerPackage?: string

  @Prop({ type: Number })
  playServicesStatus?: number

  @Prop({ type: Boolean })
  hasStoredKey?: boolean

  @Prop({ type: Boolean })
  keyRejected?: boolean

  @Prop({ type: Number })
  clientProtocol?: number

  // The Device ID the phone already had, if any
  @Prop({ type: SchemaTypes.ObjectId })
  requestDeviceId?: Types.ObjectId

  @Prop({ type: String })
  installId?: string

  // Server hash of the phone id header, comparable with device.phoneId
  @Prop({ type: String })
  phoneId?: string

  @Prop({ type: String })
  phoneSigner?: string

  // Network of the phone's request: kind, server hash, network number, country
  @Prop({ type: String, enum: ['v4', 'v6'] })
  netKind?: 'v4' | 'v6'

  @Prop({ type: String })
  netHash?: string

  @Prop({ type: Number })
  asn?: number

  @Prop({ type: String })
  country?: string

  // The account that approved or cancelled the request
  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user?: Types.ObjectId

  @Prop({ type: String, enum: DEVICE_LINK_ACTIONS })
  action?: DeviceLinkAction

  // Mode of the choices at approval; reconnect-only keeps the device's enabled state
  @Prop({ type: String, enum: DEVICE_LINK_MODES })
  mode?: DeviceLinkMode

  @Prop({ type: SchemaTypes.ObjectId })
  chosenDeviceId?: Types.ObjectId

  @Prop({ type: String })
  chosenName?: string

  @Prop({ type: Boolean })
  changedSuggestion?: boolean

  // The user asked at approval to make the new device the account's default
  @Prop({ type: Boolean })
  makeDefault?: boolean

  @Prop({ type: Date })
  approvedAt?: Date

  // Set when a poll claims the delivery, so a stopped delivery can be taken over
  @Prop({ type: Date })
  deliveringAt?: Date

  @Prop({ type: Date })
  deliveredAt?: Date

  @Prop({ type: Date })
  completedAt?: Date

  // Why a request ended denied without a cancel: the device limit, or an
  // account that may no longer connect phones, at delivery
  @Prop({ type: String, enum: ['device-limit', 'account'] })
  deniedReason?: 'device-limit' | 'account'

  @Prop({ type: Number, default: 0 })
  repeatCount: number

  @Prop({ type: SchemaTypes.ObjectId })
  apiKeyId?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId })
  deviceId?: Types.ObjectId

  @Prop({ type: Date })
  lastPolledAt?: Date

  @Prop({ type: Date, required: true })
  expiresAt: Date

  // The TTL index removes the record at this time
  @Prop({ type: Date, required: true })
  deleteAt: Date

  createdAt?: Date
  updatedAt?: Date
}

export const DeviceLinkSchema = SchemaFactory.createForClass(DeviceLink)

DeviceLinkSchema.index({ code: 1 }, { unique: true })
DeviceLinkSchema.index({ pollTokenHash: 1 }, { unique: true })
DeviceLinkSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 })
DeviceLinkSchema.index({ status: 1, expiresAt: 1 })
// One account's requests, newest first
DeviceLinkSchema.index({ user: 1, createdAt: -1 })
