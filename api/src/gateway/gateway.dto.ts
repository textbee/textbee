import { ApiProperty, getSchemaPath } from '@nestjs/swagger'
import { SMSType } from './sms-type.enum'

export class SimInfoDTO {
  @ApiProperty({
    type: Number,
    required: true,
    description:
      'Android subscription id of the SIM. Pass it as simSubscriptionId when sending to choose this SIM.',
    example: 1,
  })
  subscriptionId: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'ICCID of the SIM card.',
  })
  iccId?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Android card id of the SIM slot.',
  })
  cardId?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Mobile network operator, as reported by Android.',
    example: 'Safaricom',
  })
  carrierName?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Label the user gave this SIM on the device.',
  })
  displayName?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Physical SIM slot, starting at 0.',
    example: 0,
  })
  simSlotIndex?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Mobile country code.',
    example: '639',
  })
  mcc?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Mobile network code.',
    example: '02',
  })
  mnc?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Two letter country code of the SIM.',
    example: 'ke',
  })
  countryIso?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Whether the SIM is physical or an eSIM.',
    enum: ['PHYSICAL_SIM', 'ESIM'],
  })
  subscriptionType?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Whether the SIM had network service when the device last reported.',
    enum: [
      'IN_SERVICE',
      'OUT_OF_SERVICE',
      'EMERGENCY_ONLY',
      'POWER_OFF',
      'UNKNOWN',
    ],
  })
  serviceState?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'State of the SIM card itself, as reported by Android.',
    example: 'READY',
  })
  simState?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the SIM was roaming when the device last reported.',
  })
  isRoaming?: boolean

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Signal strength on a 0 to 4 scale, where 0 is no signal.',
    example: 3,
  })
  signalLevel?: number
}

export class SimInfoCollectionDTO {
  @ApiProperty({
    type: Date,
    required: true,
    description: 'When the device last reported its SIM list.',
  })
  lastUpdated: Date

  @ApiProperty({
    type: [SimInfoDTO],
    required: true,
    description: 'SIMs currently installed in the device.',
  })
  sims: SimInfoDTO[]
}

export class RegisterDeviceInputDTO {
  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the device may send and receive SMS.',
  })
  enabled?: boolean

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Firebase Cloud Messaging token. textbee pushes send jobs to this token, so a stale value stops delivery.',
  })
  fcmToken?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device brand.',
    example: 'google',
  })
  brand?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device manufacturer.',
    example: 'Google',
  })
  manufacturer?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device model.',
    example: 'Pixel 7',
  })
  model?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Your own label for the device, shown in the dashboard.',
    example: 'Office phone',
  })
  name?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Hardware serial. Stored, but never returned by the API.',
  })
  serial?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Android build id.',
    example: 'TQ3A.230805.001',
  })
  buildId?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Operating system name.',
    example: 'Android',
  })
  os?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Android release version.',
    example: '16',
  })
  osVersion?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Android SDK level.',
    example: 36,
  })
  osApiLevel?: number

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Android build fingerprint. Used to fill in the release version when the device does not report one.',
  })
  osBuildFingerprint?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'textbee app version name.',
    example: '1.9.0',
  })
  appVersionName?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'textbee app version code.',
    example: 190,
  })
  appVersionCode?: number

  @ApiProperty({
    type: SimInfoCollectionDTO,
    required: false,
    description: 'SIMs installed in the device.',
  })
  simInfo?: SimInfoCollectionDTO
}

/**
 * Fields a client may write on a device. There is no global ValidationPipe, so
 * without this the whole request body reaches `$set` and any device field is
 * settable, `user` and the SMS counters included.
 *
 * Applied at the controller, which is where input stops being trusted. The
 * service also receives internally built payloads (registerDevice hands its own
 * data to updateDevice) that legitimately carry fields absent from this list.
 */
const DEVICE_WRITABLE_FIELDS = [
  'enabled',
  'fcmToken',
  'brand',
  'manufacturer',
  'model',
  'name',
  'serial',
  'buildId',
  'os',
  'osVersion',
  'osApiLevel',
  'osBuildFingerprint',
  'appVersionName',
  'appVersionCode',
  'simInfo',
] as const

export function pickDeviceWritableFields(
  input: RegisterDeviceInputDTO,
): RegisterDeviceInputDTO {
  const picked: any = {}
  for (const field of DEVICE_WRITABLE_FIELDS) {
    if (input?.[field] !== undefined) picked[field] = input[field]
  }
  return picked
}

export class SMSData {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Text of the message. Long messages are split by the carrier.',
    example: 'Your appointment is confirmed for Tuesday at 10am.',
  })
  message: string

  @ApiProperty({
    type: [String],
    required: true,
    description:
      'Phone numbers to send to, in international format. Each recipient is billed as one message.',
    example: ['+12025550123', '+12025550124'],
  })
  recipients: string[]

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'SIM to send from, as subscriptionId from the device simInfo. Defaults to the device default SIM.',
    example: 1,
  })
  simSubscriptionId?: number

  @ApiProperty({
    type: String,
    required: false,
    description:
      'ISO 8601 time to send the message. Must be in the future. Omit to send now.',
    example: '2024-01-15T10:30:00Z',
  })
  scheduledAt?: string

  // TODO: restructure the Payload such that it contains bactchId, smsId, recipients and message in an optimized way
  // message: string
  // bactchId: string
  // list: {
  //   smsId: string
  //   recipient: string
  // }

  @ApiProperty({
    type: String,
    required: false,
    deprecated: true,
    description: 'Legacy alias for message. Used only when message is absent.',
  })
  smsBody: string

  @ApiProperty({
    type: [String],
    required: false,
    deprecated: true,
    description:
      'Legacy alias for recipients. Used only when recipients is absent.',
    example: ['+12025550123', '+12025550124'],
  })
  receivers: string[]
}
export class SendSMSInputDTO extends SMSData {}

export class SendBulkSMSInputDTO {
  @ApiProperty({
    type: String,
    required: false,
    description:
      'Optional label for the batch. Each entry in messages carries its own text.',
  })
  messageTemplate: string

  @ApiProperty({
    type: [SMSData],
    required: true,
    description:
      'Messages to send. Every message can target different recipients and use a different SIM.',
  })
  messages: SMSData[]
}

export class SendSMSRequestDTO extends SendSMSInputDTO {
  @ApiProperty({
    type: String,
    required: false,
    description:
      'Device to send from. When omitted, uses your default device, or the enabled device with the most recent heartbeat.',
  })
  deviceId?: string
}

export class SendBulkSMSRequestDTO extends SendBulkSMSInputDTO {
  @ApiProperty({
    type: String,
    required: false,
    description:
      'Device to send from. When omitted, uses your default device, or the enabled device with the most recent heartbeat.',
  })
  deviceId?: string
}

export class ReceivedSMSDTO {
  @ApiProperty({
    type: String,
    required: true,
    description:
      'Text of the message. An empty string is acknowledged but not stored.',
    example: 'Your code is 482913',
  })
  message: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Phone number or name of the sender. A message without a sender is acknowledged but not stored.',
    example: '+15555550123',
  })
  sender?: string

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the phone received the message, as an ISO 8601 date. Used when receivedAtInMillis is missing or 0.',
    example: '2026-09-13T10:30:00.000Z',
  })
  receivedAt?: Date

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'When the phone received the message, in milliseconds since the Unix epoch. Takes precedence over receivedAt. When neither is a valid time, the server time is used.',
    example: 1789295400000,
  })
  receivedAtInMillis?: number
}

// The device summary embedded in message responses. Message queries populate
// only these fields, so it is deliberately smaller than DeviceDTO.
export class MessageDeviceDTO {
  @ApiProperty({ type: String, description: 'Device id.' })
  _id: string

  @ApiProperty({
    type: Boolean,
    description: 'Whether the device may send and receive SMS.',
  })
  enabled: boolean

  @ApiProperty({
    type: String,
    required: false,
    description: 'Your own label for the device.',
    example: 'Office phone',
  })
  name?: string

  @ApiProperty({ type: String, description: 'Device brand.', example: 'google' })
  brand: string

  @ApiProperty({
    type: String,
    description: 'Device model.',
    example: 'Pixel 7',
  })
  model: string

  @ApiProperty({ type: String, description: 'Android build id.' })
  buildId: string
}

export class BatteryInfoDTO {
  @ApiProperty({
    type: Number,
    required: false,
    description: 'Battery level, 0 to 100.',
  })
  percentage?: number

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the device was charging at the last heartbeat.',
  })
  isCharging?: boolean

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class NetworkInfoDTO {
  @ApiProperty({
    type: String,
    required: false,
    enum: ['wifi', 'cellular', 'none'],
    description: 'Connection the device last reported.',
  })
  networkType?: string

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class AppVersionInfoDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'textbee app version name.',
    example: '1.9.0',
  })
  versionName?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'textbee app version code.',
    example: 190,
  })
  versionCode?: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class DeviceUptimeInfoDTO {
  @ApiProperty({
    type: Number,
    required: false,
    description: 'Milliseconds since the device booted.',
  })
  uptimeMillis?: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class PowerInfoDTO {
  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Whether the app is exempt from battery optimization. When false, Android may delay the app in the background.',
  })
  isIgnoringBatteryOptimizations?: boolean

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the device was in Doze at the last heartbeat.',
  })
  isDeviceIdleMode?: boolean

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether battery saver was on at the last heartbeat.',
  })
  isPowerSaveMode?: boolean

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class MemoryInfoDTO {
  @ApiProperty({
    type: Number,
    required: false,
    description: 'Free memory in bytes.',
  })
  freeBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Total memory in bytes.',
  })
  totalBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Maximum memory the app may use, in bytes.',
  })
  maxBytes?: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class StorageInfoDTO {
  @ApiProperty({
    type: Number,
    required: false,
    description: 'Free storage in bytes.',
  })
  availableBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Total storage in bytes.',
  })
  totalBytes?: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

export class DeviceSystemInfoDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Device timezone.',
    example: 'Africa/Addis_Ababa',
  })
  timezone?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device locale.',
    example: 'en_US',
  })
  locale?: string

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When this reading was taken.',
  })
  lastUpdated?: Date
}

// Full device as returned by the device endpoints. The push token and hardware
// serial are stored but never returned.
export class DeviceDTO {
  @ApiProperty({
    type: String,
    description: 'Device id. Pass it as deviceId when sending.',
  })
  _id: string

  @ApiProperty({ type: String, description: 'Owner account id.' })
  user: string

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the device may send and receive SMS. Sending to a disabled device fails.',
  })
  enabled: boolean

  @ApiProperty({
    type: Boolean,
    description: 'Whether sends without a deviceId go out from this device.',
  })
  isDefault: boolean

  @ApiProperty({ type: String, description: 'Device brand.', example: 'google' })
  brand: string

  @ApiProperty({
    type: String,
    description: 'Device manufacturer.',
    example: 'Google',
  })
  manufacturer: string

  @ApiProperty({
    type: String,
    description: 'Device model.',
    example: 'Pixel 7',
  })
  model: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Your own label for the device.',
    example: 'Office phone',
  })
  name?: string

  @ApiProperty({ type: String, description: 'Android build id.' })
  buildId: string

  @ApiProperty({
    type: String,
    description: 'Operating system name.',
    example: 'Android',
  })
  os: string

  @ApiProperty({
    type: String,
    description: 'Android release version.',
    example: '16',
  })
  osVersion: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Android SDK level.',
    example: 36,
  })
  osApiLevel?: number

  @ApiProperty({
    type: String,
    required: false,
    enum: ['reported', 'fingerprint', 'buildId'],
    description: 'How osVersion was determined.',
  })
  osVersionSource?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Android build fingerprint.',
  })
  osBuildFingerprint?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'textbee app version name.',
    example: '1.9.0',
  })
  appVersionName?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'textbee app version code.',
    example: 190,
  })
  appVersionCode?: number

  @ApiProperty({
    type: Number,
    description: 'Messages this device has sent.',
  })
  sentSMSCount: number

  @ApiProperty({
    type: Number,
    description: 'Messages this device has received.',
  })
  receivedSMSCount: number

  @ApiProperty({
    type: Boolean,
    description: 'Whether the device reports heartbeats.',
  })
  heartbeatEnabled: boolean

  @ApiProperty({
    type: Number,
    description: 'Minutes between heartbeats.',
    example: 30,
  })
  heartbeatIntervalMinutes: number

  @ApiProperty({
    type: Boolean,
    description:
      'Whether incoming messages are forwarded to textbee. Required for received message history and webhooks.',
  })
  receiveSMSEnabled: boolean

  @ApiProperty({
    type: Number,
    description: 'Seconds the device waits between messages in a batch.',
  })
  smsSendDelaySeconds: number

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'Last heartbeat. A device silent for long is likely offline and sends will queue.',
  })
  lastHeartbeat?: Date

  @ApiProperty({
    type: BatteryInfoDTO,
    required: false,
    description: 'Battery level at the last heartbeat.',
  })
  batteryInfo?: BatteryInfoDTO

  @ApiProperty({
    type: NetworkInfoDTO,
    required: false,
    description: 'Connection the device was on at the last heartbeat.',
  })
  networkInfo?: NetworkInfoDTO

  @ApiProperty({
    type: AppVersionInfoDTO,
    required: false,
    description: 'textbee app version running on the device.',
  })
  appVersionInfo?: AppVersionInfoDTO

  @ApiProperty({
    type: DeviceUptimeInfoDTO,
    required: false,
    description: 'How long the device has been up.',
  })
  deviceUptimeInfo?: DeviceUptimeInfoDTO

  @ApiProperty({
    type: MemoryInfoDTO,
    required: false,
    description: 'Memory reported at the last heartbeat.',
  })
  memoryInfo?: MemoryInfoDTO

  @ApiProperty({
    type: StorageInfoDTO,
    required: false,
    description: 'Storage reported at the last heartbeat.',
  })
  storageInfo?: StorageInfoDTO

  @ApiProperty({
    type: DeviceSystemInfoDTO,
    required: false,
    description: 'Timezone and locale of the device.',
  })
  systemInfo?: DeviceSystemInfoDTO

  @ApiProperty({
    type: PowerInfoDTO,
    required: false,
    description:
      'Android power state reported at the last heartbeat. Explains a device that is online but slow to send.',
  })
  powerInfo?: PowerInfoDTO

  @ApiProperty({
    type: SimInfoCollectionDTO,
    required: false,
    description: 'SIMs installed in the device.',
  })
  simInfo?: SimInfoCollectionDTO

  @ApiProperty({ type: Date, description: 'When the device was registered.' })
  createdAt: Date

  @ApiProperty({ type: Date, description: 'When the device was last updated.' })
  updatedAt: Date
}

export class RetrieveSMSDTO {
  @ApiProperty({ type: String, description: 'Message id.' })
  _id: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Message text. Empty when the message is end to end encrypted.',
  })
  message: string

  @ApiProperty({
    type: MessageDeviceDTO,
    description: 'Device that sent or received the message.',
  })
  device: MessageDeviceDTO

  @ApiProperty({
    enum: SMSType,
    deprecated: true,
    description:
      'Direction of the message, uppercase. Deprecated: read the lowercase direction field instead, whose values match the direction query filter.',
  })
  type: string

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    enum: [
      'pending',
      'dispatched',
      'sent',
      'delivered',
      'failed',
      'unknown',
      'received',
    ],
    description:
      'Delivery state, lowercase. Incoming messages are always received. Outgoing messages move from pending to sent, then to delivered when the carrier confirms. Absent on messages stored before status tracking, so treat a missing value as unknown.',
  })
  status?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Sender number. Set on received messages.',
  })
  sender?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Destination number. Set on sent messages.',
  })
  recipient?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Id of the batch this message was sent in.',
  })
  smsBatch?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Whether the body is end to end encrypted. Encrypted bodies can only be read by your own client.',
  })
  encrypted?: boolean

  @ApiProperty({
    type: Number,
    required: false,
    description: 'SIM the message was sent from.',
  })
  simSubscriptionId?: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the message was received. Received messages only.',
  })
  receivedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the send was requested. Sent messages only.',
  })
  requestedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the queue is due to hand the message to the push service. Set for queued messages that wait server-side before dispatch: scheduled sends, and large sends, which are released in waves paced to the device send delay so the phone is never asked to hold more than it can send. Absent for immediate sends.',
  })
  dispatchDueAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the push service accepted the message for delivery to the device. Does not mean the device has received it; sentAt is the first device-confirmed timestamp.',
  })
  dispatchedAt?: Date

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'How many times the message has been handed to the push service. Normally 1; higher when a message was dispatched again.',
  })
  dispatchAttempts?: number

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the device received the push for this message. Absent for messages handled by app versions that do not report it.',
  })
  pushReceivedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the device handed the message to the radio. The gap to sentAt is time spent in the radio; the gap from pushReceivedAt is time the message waited on the device.',
  })
  sendAttemptedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the device reported the message as sent.',
  })
  sentAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the carrier confirmed delivery.',
  })
  deliveredAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the message failed.',
  })
  failedAt?: Date

  @ApiProperty({
    type: String,
    required: false,
    description: 'Failure code reported by the device.',
  })
  errorCode?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Failure reason reported by the device.',
  })
  errorMessage?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'True when the message was received while the account was over its plan limit. Received messages only. Absent otherwise.',
  })
  overLimit?: boolean

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the platform stored the message. Set only on a received message uploaded more than 24 hours after receivedAt, whose createdAt is set to receivedAt.',
  })
  originalCreatedAt?: Date

  @ApiProperty({
    type: Date,
    description:
      'When the record was created. For a received message uploaded more than 24 hours after receivedAt, this equals receivedAt and originalCreatedAt holds the upload time.',
  })
  createdAt: Date

  @ApiProperty({ type: Date, description: 'When the record was last updated.' })
  updatedAt: Date
}

export class PaginationMetaDTO {
  @ApiProperty({
    type: 'integer',
    required: true,
    description: 'Current page number',
  })
  page: number;

  @ApiProperty({
    type: 'integer',
    required: true,
    description: 'Number of items per page',
  })
  limit: number;

  @ApiProperty({
    type: 'integer',
    required: true,
    description: 'Total number of items',
  })
  total: number;

  @ApiProperty({
    type: 'integer',
    required: true,
    description: 'Total number of pages',
  })
  totalPages: number;
}

export class RetrieveSMSResponseDTO {
  @ApiProperty({
    type: [RetrieveSMSDTO],
    required: true,
    description: 'The received SMS data',
  })
  data: RetrieveSMSDTO[]

  @ApiProperty({
    type: PaginationMetaDTO,
    required: true,
    description: 'Pagination metadata',
  })
  meta?: PaginationMetaDTO
}

export class MessageDTO extends RetrieveSMSDTO {
  @ApiProperty({
    enum: ['sent', 'received'],
    description:
      'Direction of the message, lowercase. Values match the direction query filter, so a response value can be passed straight back as a filter. Not the same thing as status: direction=sent means outbound, status=sent means the device dispatched it.',
  })
  direction: 'sent' | 'received'

  @ApiProperty({
    enum: ['sms'],
    required: false,
    description:
      'Message channel. Currently always sms; mms will appear here when supported. Absent means sms.',
  })
  channel?: string
}

export class CursorPaginationMetaDTO {
  @ApiProperty({ type: 'integer', description: 'Number of items per page.' })
  limit: number

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque cursor for the next page. Pass it back as the cursor query parameter. Null when there is nothing further.',
  })
  nextCursor: string | null

  @ApiProperty({
    type: Boolean,
    description: 'Whether more messages exist beyond this page.',
  })
  hasMore: boolean
}

// Page mode carries the cursor fields too, so a poller can start from a plain
// page-mode call and switch to cursor mode without a bootstrap step.
export class MessagePageMetaDTO extends PaginationMetaDTO {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque cursor positioned after the last message on this page. Pass it back as the cursor query parameter. Null on the final page.',
  })
  nextCursor: string | null

  @ApiProperty({
    type: Boolean,
    description: 'Whether more messages exist beyond this page.',
  })
  hasMore: boolean
}

export class MessageListResponseDTO {
  @ApiProperty({ type: [MessageDTO], description: 'Messages, newest first unless order=asc.' })
  data: MessageDTO[]

  @ApiProperty({
    description:
      'Pagination metadata. Page mode (no cursor) returns page, limit, total, totalPages plus nextCursor and hasMore; cursor mode returns limit, nextCursor, and hasMore only, skipping the expensive total count. anyOf rather than oneOf: a page-mode object also satisfies the cursor-mode shape, and oneOf would make strict validators reject it.',
    anyOf: [
      { $ref: getSchemaPath(MessagePageMetaDTO) },
      { $ref: getSchemaPath(CursorPaginationMetaDTO) },
    ],
  })
  meta: MessagePageMetaDTO | CursorPaginationMetaDTO
}

export class UpdateSMSStatusDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'The ID of the SMS',
  })
  smsId: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'The ID of the SMS batch',
  })
  smsBatchId: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'The status of the SMS (sent, delivered, failed)',
    enum: ['sent', 'delivered', 'failed'],
  })
  status: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'The time the message was sent (in milliseconds)',
  })
  sentAtInMillis?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'The time the message was delivered (in milliseconds)',
  })
  deliveredAtInMillis?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'The time the message failed (in milliseconds)',
  })
  failedAtInMillis?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Error code if the message failed',
  })
  errorCode?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Error message if the message failed',
  })
  errorMessage?: string

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'When the device received the push for this message (in milliseconds)',
  })
  pushReceivedAtInMillis?: number

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'When the device handed this message to the radio (in milliseconds)',
  })
  sendAttemptedAtInMillis?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Which attempt of the device retry loop filed this report',
  })
  reportAttempt?: number
}

export class HeartbeatInputDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'FCM token for push notifications',
  })
  fcmToken?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Battery percentage (0-100)',
  })
  batteryPercentage?: number

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether device is currently charging',
  })
  isCharging?: boolean

  @ApiProperty({
    type: String,
    required: false,
    description: 'Network type',
    enum: ['wifi', 'cellular', 'none'],
  })
  networkType?: 'wifi' | 'cellular' | 'none'

  @ApiProperty({
    type: String,
    required: false,
    description: 'App version name',
  })
  appVersionName?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'App version code',
  })
  appVersionCode?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Android release version, e.g. "16"',
  })
  osVersion?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Android SDK / API level, e.g. 36',
  })
  osApiLevel?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Device uptime in milliseconds since boot',
  })
  deviceUptimeMillis?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Free memory in bytes',
  })
  memoryFreeBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Total memory in bytes',
  })
  memoryTotalBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Max memory in bytes',
  })
  memoryMaxBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Available storage in bytes',
  })
  storageAvailableBytes?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Total storage in bytes',
  })
  storageTotalBytes?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device timezone (e.g., "America/New_York")',
  })
  timezone?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device locale (e.g., "en_US")',
  })
  locale?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether receive SMS feature is enabled',
  })
  receiveSMSEnabled?: boolean

  @ApiProperty({
    type: Number,
    required: false,
    description: 'SMS send delay in seconds (0-3600), used by device queue',
  })
  smsSendDelaySeconds?: number

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Whether the app is exempt from battery optimization on the device.',
  })
  isIgnoringBatteryOptimizations?: boolean

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the device was in Doze when it reported.',
  })
  isDeviceIdleMode?: boolean

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether battery saver was on when the device reported.',
  })
  isPowerSaveMode?: boolean

  @ApiProperty({ type: Boolean, required: false, description: 'SEND_SMS granted' })
  hasSendSmsPermission?: boolean

  @ApiProperty({ type: Boolean, required: false, description: 'RECEIVE_SMS granted' })
  hasReceiveSmsPermission?: boolean

  @ApiProperty({ type: Boolean, required: false, description: 'READ_PHONE_STATE granted' })
  hasReadPhoneStatePermission?: boolean

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'POST_NOTIFICATIONS granted. Always true below Android 13.',
  })
  hasPostNotificationsPermission?: boolean

  @ApiProperty({ type: Boolean, required: false, description: 'Sticky notification switched on' })
  stickyNotificationEnabled?: boolean

  @ApiProperty({ type: Boolean, required: false, description: 'Running the legacy UI' })
  usingLegacyUi?: boolean

  @ApiProperty({
    type: SimInfoCollectionDTO,
    required: false,
    description: 'SIMs installed in the device at the time of the heartbeat.',
  })
  simInfo?: SimInfoCollectionDTO
}

export class DeviceConfigDTO {
  @ApiProperty({ type: Boolean, description: 'Use the per-message send scheduler' })
  sendSchedulerV2Enabled: boolean

  @ApiProperty({ type: Boolean, description: 'Ask the server for missed messages' })
  recoveryPollEnabled: boolean

  @ApiProperty({ type: Boolean, description: 'Show a notification when a newer app exists' })
  updateNotificationsEnabled: boolean

  @ApiProperty({ type: Number, description: 'versionCode of the latest release' })
  latestVersionCode: number

  @ApiProperty({ type: String, description: 'versionName of the latest release' })
  latestVersionName: string
}

export class HeartbeatResponseDTO {
  @ApiProperty({
    type: Boolean,
    required: true,
    description: 'Whether the heartbeat was successful',
  })
  success: boolean

  @ApiProperty({
    type: Boolean,
    required: true,
    description: 'Whether the FCM token was updated',
  })
  fcmTokenUpdated: boolean

  @ApiProperty({
    type: Date,
    required: true,
    description: 'Server timestamp of the heartbeat',
  })
  lastHeartbeat: Date

  @ApiProperty({
    type: String,
    required: false,
    description: 'Device name (if updated)',
  })
  name?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Messages waiting for this device that a push may have missed',
  })
  pendingCount?: number

  @ApiProperty({
    type: DeviceConfigDTO,
    required: false,
    description: 'Settings the app applies until the next heartbeat',
  })
  config?: DeviceConfigDTO
}

export class GatewayStatsDTO {
  @ApiProperty({
    type: Number,
    description: 'Messages sent across all your devices.',
  })
  totalSentSMSCount: number

  @ApiProperty({
    type: Number,
    description: 'Messages received across all your devices.',
  })
  totalReceivedSMSCount: number

  @ApiProperty({ type: Number, description: 'Devices on your account.' })
  totalDeviceCount: number

  @ApiProperty({ type: Number, description: 'API keys on your account.' })
  totalApiKeyCount: number
}

export class GatewayStatsResponseDTO {
  @ApiProperty({ type: GatewayStatsDTO, description: 'Account totals.' })
  data: GatewayStatsDTO
}

export class SmsPermissionStatusDTO {
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'True when your latest outgoing message failed because the textbee app on the phone lacks the SMS permission (error code PERMISSION_DENIED), and the phone has not reported the permission granted since. False when the latest outgoing message did not fail for that reason, or the phone has since reported the permission granted. Null when the account has never sent a message.',
  })
  needsSmsPermission: boolean | null

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Whole hours since that failure. Null unless needsSmsPermission is true.',
  })
  hoursSinceFailure: number | null

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Id of the device that reported the failure. Null unless needsSmsPermission is true.',
  })
  deviceId: string | null

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Name of that device, or its brand and model when it has no name. Null unless needsSmsPermission is true.',
  })
  deviceName: string | null

  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'When the server received the failure report from the phone. Null unless needsSmsPermission is true.',
  })
  failedAt: Date | null
}

export class SmsPermissionStatusResponseDTO {
  @ApiProperty({
    type: SmsPermissionStatusDTO,
    description: 'Whether a missing SMS permission is blocking your sends.',
  })
  data: SmsPermissionStatusDTO
}

export class DeviceListResponseDTO {
  @ApiProperty({ type: [DeviceDTO], description: 'Your devices.' })
  data: DeviceDTO[]
}

export class DeviceResponseDTO {
  @ApiProperty({ type: DeviceDTO, description: 'The device.' })
  data: DeviceDTO
}

export class SuccessResultDTO {
  @ApiProperty({ type: Boolean, description: 'Whether the action succeeded.' })
  success: boolean
}

export class SuccessResponseDTO {
  @ApiProperty({ type: SuccessResultDTO, description: 'Outcome of the action.' })
  data: SuccessResultDTO
}

export class SendSMSResultDTO {
  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the batch was accepted. Queued sends only.',
  })
  success?: boolean

  @ApiProperty({
    type: String,
    required: false,
    description: 'Human readable outcome. Queued sends only.',
    example: 'SMS added to queue for processing',
  })
  message?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Batch id. Pass it to GET /gateway/devices/{id}/sms-batch/{smsBatchId} to follow delivery. Queued sends only.',
  })
  smsBatchId?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Number of recipients in the batch. Queued sends only.',
  })
  recipientCount?: number

  @ApiProperty({
    type: String,
    required: false,
    format: 'date-time',
    description:
      'Projected time the device finishes sending, based on the recipient count and the device send delay setting. Present only when the batch is large enough to be released in waves. The device must stay online for the estimate to hold.',
    example: '2026-08-22T14:05:00.000Z',
  })
  estimatedCompletionAt?: string

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'Messages pushed to the device. Returned instead of the queue fields when the instance dispatches immediately.',
  })
  successCount?: number

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Messages that could not be pushed to the device.',
  })
  failureCount?: number
}

export class SendSMSResponseDTO {
  @ApiProperty({ type: SendSMSResultDTO, description: 'Outcome of the send.' })
  data: SendSMSResultDTO
}

export class SMSResponseDTO {
  @ApiProperty({ type: RetrieveSMSDTO, description: 'The message.' })
  data: RetrieveSMSDTO
}

export class SMSBatchDTO {
  @ApiProperty({ type: String, description: 'Batch id.' })
  _id: string

  @ApiProperty({ type: String, description: 'Owner account id.' })
  user: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Message text sent to every recipient in the batch.',
  })
  message?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'Whether the body is end to end encrypted.',
  })
  encrypted?: boolean

  @ApiProperty({ type: Number, description: 'Recipients in the batch.' })
  recipientCount: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'Short preview of the recipient list.',
    example: '+12025550123 and 3 others',
  })
  recipientPreview?: string

  @ApiProperty({ type: Number, description: 'Messages sent so far.' })
  successCount: number

  @ApiProperty({ type: Number, description: 'Messages that failed.' })
  failureCount: number

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    enum: [
      'pending',
      'processing',
      'completed',
      'partial_success',
      'failed',
      'unknown',
      'sent',
      'delivered',
    ],
    description:
      'Progress of the batch as a whole, lowercase. Absent on batches stored before status tracking. sent and delivered appear on older batches that mirrored the per-message state.',
  })
  status?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Failure reason when the batch failed.',
  })
  error?: string

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the batch finished.',
  })
  completedAt?: Date

  @ApiProperty({ type: Date, description: 'When the batch was created.' })
  createdAt: Date

  @ApiProperty({ type: Date, description: 'When the batch was last updated.' })
  updatedAt: Date
}

export class SMSBatchResultDTO {
  @ApiProperty({ type: SMSBatchDTO, description: 'The batch itself.' })
  batch: SMSBatchDTO

  @ApiProperty({
    type: [RetrieveSMSDTO],
    description: 'Every message in the batch, one per recipient.',
  })
  messages: RetrieveSMSDTO[]
}

export class SMSBatchResponseDTO {
  @ApiProperty({
    type: SMSBatchResultDTO,
    description: 'The batch and the messages in it.',
  })
  data: SMSBatchResultDTO
}
