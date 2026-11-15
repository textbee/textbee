import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, SchemaTypes, Types } from 'mongoose'
import { User } from '../../users/schemas/user.schema'
import type { AppVersionHistoryEntry } from '../app-version-history'
import { INSTALL_SOURCES, InstallSource } from '../install-source'

export type DeviceDocument = Device & Document

/** Default delay between SMS sends (seconds). 5s helps avoid carrier/device throttling. */
export const DEFAULT_SMS_SEND_DELAY_SECONDS = 5

@Schema({ timestamps: true })
export class Device {
  _id?: Types.ObjectId

  @Prop({ type: SchemaTypes.ObjectId, ref: User.name })
  user: User | Types.ObjectId

  @Prop({ type: Boolean, default: false })
  enabled: boolean

  @Prop({ type: Boolean, default: false })
  isDefault: boolean

  @Prop({ type: String })
  fcmToken: string

  @Prop({ type: Date })
  fcmTokenUpdatedAt?: Date

  @Prop({ type: Date })
  fcmTokenInvalidatedAt?: Date

  @Prop({ type: String })
  fcmTokenInvalidReason?: string

  @Prop({ type: String })
  brand: string

  @Prop({ type: String })
  manufacturer: string

  @Prop({ type: String })
  model: string

  @Prop({ type: String, required: false })
  name?: string

  @Prop({ type: String })
  serial: string

  @Prop({ type: String })
  buildId: string

  @Prop({ type: String })
  os: string

  @Prop({ type: String })
  osVersion: string

  @Prop({ type: Number })
  osApiLevel: number

  // How osVersion was arrived at: reported and fingerprint are measured,
  // buildId is inferred from the build's leading letter.
  @Prop({ type: String, enum: ['reported', 'fingerprint', 'buildId'] })
  osVersionSource: string

  // Raw Build.VERSION.BASE_OS string, kept for per-OEM detail.
  @Prop({ type: String })
  osBuildFingerprint: string

  @Prop({ type: String })
  appVersionName: string

  @Prop({ type: Number })
  appVersionCode: number

  @Prop({ type: Number, default: 0 })
  sentSMSCount: number

  @Prop({ type: Number, default: 0 })
  receivedSMSCount: number

  @Prop({ type: Boolean, default: true })
  heartbeatEnabled: boolean

  @Prop({ type: Number, default: 30 })
  heartbeatIntervalMinutes: number

  @Prop({ type: Boolean, default: false })
  receiveSMSEnabled: boolean

  @Prop({ type: Number, default: DEFAULT_SMS_SEND_DELAY_SECONDS })
  smsSendDelaySeconds: number

  @Prop({ type: Date })
  lastHeartbeat: Date

  @Prop({
    type: {
      percentage: Number,
      isCharging: Boolean,
      lastUpdated: Date,
    },
  })
  batteryInfo: {
    percentage?: number
    isCharging?: boolean
    lastUpdated?: Date
  }

  @Prop({
    type: {
      networkType: String,
      lastUpdated: Date,
    },
  })
  networkInfo: {
    networkType?: 'wifi' | 'cellular' | 'none'
    lastUpdated?: Date
  }

  @Prop({
    type: {
      versionName: String,
      versionCode: Number,
      lastUpdated: Date,
    },
  })
  appVersionInfo: {
    versionName?: string
    versionCode?: number
    lastUpdated?: Date
  }

  @Prop({
    type: {
      uptimeMillis: Number,
      lastUpdated: Date,
    },
  })
  deviceUptimeInfo: {
    uptimeMillis?: number
    lastUpdated?: Date
  }

  @Prop({
    type: {
      freeBytes: Number,
      totalBytes: Number,
      maxBytes: Number,
      lastUpdated: Date,
    },
  })
  memoryInfo: {
    freeBytes?: number
    totalBytes?: number
    maxBytes?: number
    lastUpdated?: Date
  }

  @Prop({
    type: {
      availableBytes: Number,
      totalBytes: Number,
      lastUpdated: Date,
    },
  })
  storageInfo: {
    availableBytes?: number
    totalBytes?: number
    lastUpdated?: Date
  }

  @Prop({
    type: {
      timezone: String,
      locale: String,
      lastUpdated: Date,
    },
  })
  systemInfo: {
    timezone?: string
    locale?: string
    lastUpdated?: Date
  }

  @Prop({
    type: {
      lastUpdated: Date,
      sims: [
        {
          subscriptionId: Number,
          iccId: String,
          cardId: Number,
          carrierName: String,
          displayName: String,
          simSlotIndex: Number,
          mcc: String,
          mnc: String,
          countryIso: String,
          subscriptionType: String,
          serviceState: String,
          simState: String,
          isRoaming: Boolean,
          signalLevel: Number,
        },
      ],
    },
  })
  simInfo: {
    lastUpdated?: Date
    sims?: Array<{
      subscriptionId: number
      iccId?: string
      cardId?: number
      carrierName?: string
      displayName?: string
      simSlotIndex?: number
      mcc?: string
      mnc?: string
      countryIso?: string
      subscriptionType?: string
      serviceState?: string
      simState?: string
      isRoaming?: boolean
      signalLevel?: number
    }>
  }

  // Typed by the account owner as a label. Kept apart from simInfo, which
  // every heartbeat replaces, and keyed by slot so it survives SIM id changes.
  @Prop({
    type: [{ slotIndex: Number, phoneNumber: String, _id: false }],
    default: undefined,
  })
  simNumbers?: Array<{ slotIndex: number; phoneNumber: string }>

  // What the OS is doing to the app in the background. A device can be online
  // and healthy here and still not send, which is the case this makes visible.
  @Prop({
    type: {
      isIgnoringBatteryOptimizations: Boolean,
      isDeviceIdleMode: Boolean,
      isPowerSaveMode: Boolean,
      lastUpdated: Date,
    },
  })
  powerInfo: {
    isIgnoringBatteryOptimizations?: boolean
    isDeviceIdleMode?: boolean
    isPowerSaveMode?: boolean
    lastUpdated?: Date
  }

  // Permissions and settings inside the app, reported on every heartbeat.
  @Prop({
    type: {
      hasSendSmsPermission: Boolean,
      hasReceiveSmsPermission: Boolean,
      hasReadPhoneStatePermission: Boolean,
      hasPostNotificationsPermission: Boolean,
      stickyNotificationEnabled: Boolean,
      usingLegacyUi: Boolean,
      lastUpdated: Date,
    },
  })
  appStateInfo: {
    hasSendSmsPermission?: boolean
    hasReceiveSmsPermission?: boolean
    hasReadPhoneStatePermission?: boolean
    hasPostNotificationsPermission?: boolean
    stickyNotificationEnabled?: boolean
    usingLegacyUi?: boolean
    lastUpdated?: Date
  }

  // Per-device overrides of the settings returned on the heartbeat reply.
  @Prop({ type: SchemaTypes.Mixed })
  configOverrides?: Record<string, unknown>

  // Last time the app asked for messages its push may have missed
  @Prop({ type: Date })
  lastPendingPollAt?: Date

  // Random id the app makes once per install, as last reported
  @Prop({ type: String })
  installId?: string

  // The install that reported the current push token, when it sent an id
  @Prop({ type: String })
  pushInstallId?: string

  @Prop({
    type: {
      pullCapable: Boolean,
      lastPushReceivedAt: Date,
      dedupeSkipCount: Number,
      lastUpdated: Date,
    },
  })
  pullInfo?: {
    pullCapable?: boolean
    lastPushReceivedAt?: Date
    dedupeSkipCount?: number
    lastUpdated?: Date
  }

  // Last time the app claimed messages through the claim endpoint
  @Prop({ type: Date })
  lastClaimAt?: Date

  // Projected time the device finishes every message already planned for it
  @Prop({ type: Date, select: false })
  dispatchBusyUntil?: Date

  // The same projection for single-recipient requests that skipped the line
  @Prop({ type: Date, select: false })
  dispatchPriorityBusyUntil?: Date

  // API key the app last sent a heartbeat or registration with
  @Prop({ type: SchemaTypes.ObjectId, ref: 'ApiKey', select: false })
  apiKey?: Types.ObjectId

  // How the current app version was installed, decided from installerPackage
  @Prop({ type: String, enum: INSTALL_SOURCES, select: false })
  installSource?: InstallSource

  // Installer package name as the app reported it; empty when Android has none
  @Prop({ type: String, select: false })
  installerPackage?: string

  @Prop({ type: String, select: false })
  initiatingPackage?: string

  // App versions the device ran, newest last
  @Prop({
    type: [
      {
        versionCode: Number,
        versionName: String,
        installSource: { type: String, enum: INSTALL_SOURCES },
        installerPackage: String,
        installedAt: Date,
        firstSeenAt: Date,
        lastSeenAt: Date,
        seeded: Boolean,
        _id: false,
      },
    ],
    default: undefined,
    select: false,
  })
  appVersionHistory?: AppVersionHistoryEntry[]

  // "{versionCode}|{versionName}|{installer}" of the newest history entry
  @Prop({ type: String, select: false })
  appVersionKey?: string

  // Last time the app reported the newest history entry's version
  @Prop({ type: Date, select: false })
  appVersionLastSeenAt?: Date

  @Prop({ type: Number, select: false })
  appVersionFlapCount?: number

  // Ids of the notices the user closed in the app, newest last; written by the heartbeat only
  @Prop({ type: [String], default: undefined, select: false })
  closedNoticeIds?: string[]

  // set by { timestamps: true }; declared here for typing only, no @Prop
  createdAt?: Date
  updatedAt?: Date
}

export const DeviceSchema = SchemaFactory.createForClass(Device)

// Server-side state and credentials: readable on the document, never serialized
export const DEVICE_HIDDEN_FIELDS = [
  'apiKey',
  'fcmToken',
  'serial',
  'fcmTokenUpdatedAt',
  'fcmTokenInvalidatedAt',
  'fcmTokenInvalidReason',
  'configOverrides',
  'lastPendingPollAt',
  'installId',
  'pushInstallId',
  'pullInfo',
  'lastClaimAt',
  'dispatchBusyUntil',
  'dispatchPriorityBusyUntil',
  'installSource',
  'installerPackage',
  'initiatingPackage',
  'appVersionHistory',
  'appVersionKey',
  'appVersionLastSeenAt',
  'appVersionFlapCount',
  'closedNoticeIds',
] as const

DeviceSchema.set('toJSON', {
  transform: (_doc, ret) => {
    for (const field of DEVICE_HIDDEN_FIELDS) delete ret[field]
    return ret
  },
})

DeviceSchema.index({ user: 1 })
