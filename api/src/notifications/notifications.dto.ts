import { ApiProperty } from '@nestjs/swagger'

// Response and input shapes for the dashboard feed. Note this app has no global
// ValidationPipe, so the class-validator style used elsewhere would be
// decorative here: the controller checks these bodies by hand.

export class NotificationActionDTO {
  @ApiProperty({ example: 'Upgrade to Pro' })
  label: string

  @ApiProperty({ example: '/checkout/pro' })
  href: string

  @ApiProperty({ example: 'primary', required: false })
  style?: string

  @ApiProperty({ example: 'self', required: false })
  target?: string
}

export class ServedNotificationDTO {
  @ApiProperty({ description: 'Identifier to send back with events.' })
  id: string

  @ApiProperty({
    description: 'Stable slug. Selects a bespoke renderer where one exists.',
    example: 'upgrade-to-pro',
  })
  key: string

  @ApiProperty({ enum: ['system', 'campaign'] })
  kind: string

  @ApiProperty({ enum: ['tile', 'modal'] })
  placement: string

  @ApiProperty({ enum: ['info', 'success', 'warning', 'critical', 'promo'] })
  tone: string

  @ApiProperty({ example: 'standard' })
  renderer: string

  @ApiProperty({ description: 'Position in the stack, starting at one.' })
  rank: number

  @ApiProperty({ description: 'Which copy was chosen, for reporting.' })
  variantId: string

  @ApiProperty()
  title: string

  @ApiProperty({ required: false })
  body?: string

  @ApiProperty({ type: [NotificationActionDTO] })
  actions: NotificationActionDTO[]

  @ApiProperty()
  dismissible: boolean

  @ApiProperty({
    required: false,
    description: 'Leave the close control inert for this many seconds.',
  })
  dismissAfterSeconds?: number
}

export class NotificationFeedSettingsDTO {
  @ApiProperty()
  maxTilesAtOnce: number

  @ApiProperty()
  maxModalsPerLoad: number
}

export class NotificationFeedResponseDTO {
  @ApiProperty({
    description:
      'False means this account should render the dashboard’s original built-in messages instead. The list is then empty.',
  })
  engineEnabled: boolean

  @ApiProperty({ type: NotificationFeedSettingsDTO, nullable: true })
  settings: NotificationFeedSettingsDTO | null

  @ApiProperty({ type: [ServedNotificationDTO] })
  notifications: ServedNotificationDTO[]
}

export class NotificationEventDTO {
  @ApiProperty({ description: 'The id from the feed.' })
  notificationId: string

  @ApiProperty({ enum: ['impression', 'click', 'dismiss'] })
  type: 'impression' | 'click' | 'dismiss'

  @ApiProperty({ required: false, description: 'The variantId from the feed.' })
  variantId?: string
}

export class NotificationEventsInputDTO {
  @ApiProperty({ type: [NotificationEventDTO] })
  events: NotificationEventDTO[]
}

export class NotificationEventsResponseDTO {
  @ApiProperty({ description: 'How many events were accepted.' })
  recorded: number
}

export class DismissNotificationInputDTO {
  @ApiProperty({
    required: false,
    description:
      'Hide it for this many hours instead of permanently, when the notification allows snoozing.',
  })
  snoozeHours?: number
}

export class DismissNotificationResponseDTO {
  @ApiProperty()
  success: boolean
}
