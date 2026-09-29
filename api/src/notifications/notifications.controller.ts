import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Request as ExpressRequest } from 'express'
import { AuthGuard } from '../auth/guards/auth.guard'
import {
  DismissNotificationInputDTO,
  DismissNotificationResponseDTO,
  NotificationEventsInputDTO,
  NotificationEventsResponseDTO,
  NotificationFeedResponseDTO,
} from './notifications.dto'
import {
  NotificationEventInput,
  NotificationsService,
} from './notifications.service'

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing, invalid, or revoked API key.',
} as const

const EVENT_TYPES = ['impression', 'click', 'dismiss']

// Dashboard-only, and documented in the internal Swagger the way the other
// dashboard endpoints are. They stay out of the published spec by being absent
// from the public-operations allowlist, not by being hidden here: they describe
// the dashboard's own messaging, not the SMS API.
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: 'The messages to show this account on the dashboard',
    description:
      'Returns finished content, already targeted, ordered and capped. The caller renders it as given and applies no rules of its own. When engineEnabled is false the dashboard shows its original built-in messages instead.',
  })
  @ApiResponse({
    status: 200,
    description: 'The messages to render, in order.',
    type: NotificationFeedResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('feed')
  async getFeed(@Request() req: ExpressRequest & { user: any }) {
    return this.notificationsService.getFeed(req.user)
  }

  @ApiOperation({
    summary: 'Record that messages were seen, clicked or dismissed',
    description:
      'Sent as a batch. The feed itself records nothing, because a refetch would otherwise count as another view.',
  })
  @ApiResponse({
    status: 201,
    description: 'How many events were accepted.',
    type: NotificationEventsResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Malformed events.' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('events')
  async recordEvents(
    @Request() req: ExpressRequest & { user: any },
    @Body() body: NotificationEventsInputDTO,
  ) {
    // Checked here rather than by a pipe: this app installs no global
    // ValidationPipe, so a DTO alone would let anything through.
    const events = body?.events
    if (!Array.isArray(events)) {
      throw new BadRequestException('events must be a list.')
    }

    const cleaned: NotificationEventInput[] = events.map((event, index) => {
      if (!event || typeof event !== 'object') {
        throw new BadRequestException(`events[${index}] must be an object.`)
      }
      if (typeof event.notificationId !== 'string') {
        throw new BadRequestException(
          `events[${index}].notificationId must be a string.`,
        )
      }
      if (!EVENT_TYPES.includes(event.type)) {
        throw new BadRequestException(
          `events[${index}].type must be one of ${EVENT_TYPES.join(', ')}.`,
        )
      }
      if (
        event.variantId !== undefined &&
        typeof event.variantId !== 'string'
      ) {
        throw new BadRequestException(
          `events[${index}].variantId must be a string.`,
        )
      }
      return {
        notificationId: event.notificationId,
        type: event.type,
        variantId: event.variantId,
      }
    })

    return this.notificationsService.recordEvents(req.user, cleaned)
  }

  @ApiOperation({
    summary: 'Dismiss one message for this account',
    description:
      'Stored against the account rather than the browser, so it holds on a new device. The caller should refetch the feed afterwards: clearing one message lets the next one take its place.',
  })
  @ApiResponse({
    status: 201,
    description: 'The message was dismissed.',
    type: DismissNotificationResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown message, or one that cannot be dismissed.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post(':id/dismiss')
  async dismiss(
    @Request() req: ExpressRequest & { user: any },
    @Param('id') id: string,
    @Body() body: DismissNotificationInputDTO,
  ) {
    const snoozeHours = body?.snoozeHours
    if (snoozeHours !== undefined && typeof snoozeHours !== 'number') {
      throw new BadRequestException('snoozeHours must be a number.')
    }
    return this.notificationsService.dismiss(req.user, id, snoozeHours)
  }
}
