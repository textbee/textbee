import { ApiProperty } from '@nestjs/swagger'
import { PaginationMetaDTO } from '../gateway/gateway.dto'
import { WebhookEvent } from './webhook-event.enum'

export class CreateWebhookDto {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Label shown in the dashboard. Up to 64 characters.',
    example: 'Order notifications',
  })
  name?: string

  @ApiProperty({
    type: String,
    required: true,
    description:
      'URL textbee POSTs events to. Must be http or https and publicly reachable. Private and loopback hosts are rejected.',
    example: 'https://example.com/textbee/webhook',
  })
  deliveryUrl: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Shared secret, at least 20 characters. If omitted, textbee automatically generates a cryptographically secure 32-byte secret. textbee signs every delivery with it using HMAC-SHA256 and sends the signature in the X-TextBee-Signature header (t=<timestamp>,v1=<signature>) and X-Signature header.',
  })
  signingSecret?: string

  @ApiProperty({
    required: true,
    isArray: true,
    enum: WebhookEvent,
    description: 'Events to deliver. At least one is required.',
    example: [WebhookEvent.MESSAGE_RECEIVED],
  })
  events: WebhookEvent[]
}

export class UpdateWebhookDto {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Label shown in the dashboard. Up to 64 characters.',
    example: 'Order notifications',
  })
  name?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Whether deliveries are attempted. Set it to true to re-enable a subscription textbee paused after repeated failures.',
  })
  isActive: boolean

  @ApiProperty({
    type: String,
    required: false,
    description:
      'New delivery URL. Same rules as on create: http or https, no private or loopback hosts.',
    example: 'https://example.com/textbee/webhook',
  })
  deliveryUrl: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'New signing secret, at least 20 characters.',
  })
  signingSecret: string

  @ApiProperty({
    required: false,
    isArray: true,
    enum: WebhookEvent,
    description: 'Replacement event list. Cannot be empty.',
    example: [WebhookEvent.MESSAGE_RECEIVED, WebhookEvent.MESSAGE_DELIVERED],
  })
  events: WebhookEvent[]
}

export class WebhookNoteDTO {
  @ApiProperty({ type: Date, description: 'When the note was added.' })
  at: Date

  @ApiProperty({
    type: String,
    description:
      'What textbee recorded, for example why the subscription was paused.',
  })
  text: string
}

export class WebhookSubscriptionDTO {
  @ApiProperty({ type: String, description: 'Subscription id.' })
  _id: string

  @ApiProperty({ type: String, description: 'Owner account id.' })
  user: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Label shown in the dashboard.',
  })
  name?: string

  @ApiProperty({
    type: Boolean,
    description:
      'Whether deliveries are attempted. textbee pauses subscriptions that keep failing.',
  })
  isActive: boolean

  @ApiProperty({
    isArray: true,
    enum: WebhookEvent,
    description: 'Events this subscription receives.',
  })
  events: string[]

  @ApiProperty({ type: String, description: 'URL events are POSTed to.' })
  deliveryUrl: string

  @ApiProperty({
    type: String,
    description: 'Secret used to sign deliveries.',
  })
  signingSecret: string

  @ApiProperty({ type: Number, description: 'Deliveries that succeeded.' })
  successfulDeliveryCount: number

  @ApiProperty({ type: Number, description: 'Deliveries that failed.' })
  deliveryFailureCount: number

  @ApiProperty({
    type: Number,
    description: 'Delivery attempts made, retries included.',
  })
  deliveryAttemptCount: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Last time a delivery was attempted.',
  })
  lastDeliveryAttemptAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Last time a delivery succeeded.',
  })
  lastDeliverySuccessAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Last time a delivery failed.',
  })
  lastDeliveryFailureAt?: Date

  @ApiProperty({
    type: [WebhookNoteDTO],
    required: false,
    description: 'Notes textbee added, such as an auto-pause reason.',
  })
  notes?: WebhookNoteDTO[]

  @ApiProperty({
    type: Date,
    description: 'When the subscription was created.',
  })
  createdAt: Date

  @ApiProperty({ type: Date, description: 'When it was last updated.' })
  updatedAt: Date
}

export class WebhookListResponseDTO {
  @ApiProperty({
    type: [WebhookSubscriptionDTO],
    description: 'Your webhook subscriptions. Deleted ones are not returned.',
  })
  data: WebhookSubscriptionDTO[]
}

export class WebhookResponseDTO {
  @ApiProperty({
    type: WebhookSubscriptionDTO,
    description: 'The subscription.',
  })
  data: WebhookSubscriptionDTO
}

export class WebhookDeletedResultDTO {
  @ApiProperty({ type: Boolean, description: 'Whether the delete succeeded.' })
  success: boolean
}

export class WebhookDeletedResponseDTO {
  @ApiProperty({
    type: WebhookDeletedResultDTO,
    description: 'Outcome of the delete.',
  })
  data: WebhookDeletedResultDTO
}

export class WebhookNotificationDTO {
  @ApiProperty({ type: String, description: 'Delivery record id.' })
  _id: string

  @ApiProperty({ type: String, description: 'Subscription this belongs to.' })
  webhookSubscription: string

  @ApiProperty({ enum: WebhookEvent, description: 'Event that was delivered.' })
  event: string

  @ApiProperty({
    type: Object,
    description: 'Exact JSON body textbee POSTed to your endpoint.',
  })
  payload: object

  @ApiProperty({
    type: String,
    enum: ['pending', 'retrying', 'delivered', 'failed'],
    description:
      'Delivery state. Retrying means textbee will try again, failed means it gave up after 10 attempts.',
  })
  computedStatus: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'URL the delivery was sent to when it was attempted.',
  })
  deliveryUrl?: string

  @ApiProperty({
    type: Number,
    description: 'Attempts made for this event.',
  })
  deliveryAttemptCount: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When your endpoint accepted the delivery.',
  })
  deliveredAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the last attempt was made.',
  })
  lastDeliveryAttemptAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the next retry is due.',
  })
  nextDeliveryAttemptAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When textbee stopped retrying.',
  })
  deliveryAttemptAbortedAt?: Date

  @ApiProperty({
    type: String,
    required: false,
    enum: ['retryable', 'non-retryable'],
    description: 'Whether the failure is worth retrying.',
  })
  errorType?: string

  @ApiProperty({
    type: Number,
    required: false,
    description: 'Status code your endpoint returned on the last attempt.',
  })
  httpStatusCode?: number

  @ApiProperty({
    type: String,
    required: false,
    description: 'First 1000 characters of your endpoint response.',
  })
  responseBody?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Idempotency key sent with the delivery.',
  })
  idempotencyKey?: string

  @ApiProperty({ type: Date, description: 'When the event was recorded.' })
  createdAt: Date
}

export class WebhookNotificationPageDTO {
  @ApiProperty({
    type: [WebhookNotificationDTO],
    description: 'Delivery records, newest first.',
  })
  data: WebhookNotificationDTO[]

  @ApiProperty({ type: PaginationMetaDTO, description: 'Pagination info.' })
  meta: PaginationMetaDTO
}

export class WebhookNotificationListResponseDTO {
  @ApiProperty({
    type: WebhookNotificationPageDTO,
    description: 'Delivery records with pagination.',
  })
  data: WebhookNotificationPageDTO
}
