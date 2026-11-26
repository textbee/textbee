import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'

export type ApiKeyDocument = ApiKey & Document

// A key the server made for one phone when the phone signed in
export const DEVICE_LINK_KEY_SOURCE = 'device-link'
export const API_KEY_SOURCES = [DEVICE_LINK_KEY_SOURCE] as const
export type ApiKeySource = (typeof API_KEY_SOURCES)[number]

@Schema({ timestamps: true })
export class ApiKey {
  _id?: Types.ObjectId

  @Prop({ type: String })
  apiKey: string // save first few chars only [ abc123****** ]

  @Prop({ type: String, default: 'API Key' })
  name: string
  
  @Prop({ type: String })
  hashedApiKey: string

  // Deterministic hash, so a presented key resolves in one indexed lookup.
  @Prop({ type: String })
  hashedApiKeySha256?: string

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user: User | Types.ObjectId

  @Prop({ type: Number, default: 0 })
  usageCount: number

  @Prop({ type: Date })
  lastUsedAt: Date

  @Prop({ type: Date })
  revokedAt?: Date

  // Missing for a key made in the dashboard
  @Prop({ type: String, enum: API_KEY_SOURCES })
  source?: ApiKeySource

  // The one device a phone sign-in key works for
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Device' })
  linkedDevice?: Types.ObjectId

  // The sign-in request that made this key
  @Prop({ type: SchemaTypes.ObjectId })
  deviceLink?: Types.ObjectId
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey)

ApiKeySchema.index({ apiKey: 1 })
ApiKeySchema.index({ linkedDevice: 1 }, { sparse: true })
ApiKeySchema.index({ deviceLink: 1 }, { sparse: true })
// Sparse: keys issued before the sha256 migration have no value here yet.
// Unique so a bad bulk backfill fails loudly at write time, not at auth time.
ApiKeySchema.index({ hashedApiKeySha256: 1 }, { unique: true, sparse: true })
