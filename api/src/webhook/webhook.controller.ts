import {
  Body,
  Request,
  Param,
  Post,
  Patch,
  Delete,
  Controller,
  Get,
  UseGuards,
  Query,
} from '@nestjs/common'
import { WebhookService } from './webhook.service'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookCreatedResponseDTO,
  WebhookDeletedResponseDTO,
  WebhookListResponseDTO,
  WebhookNotificationListResponseDTO,
  WebhookResponseDTO,
} from './webhook.dto'
import { WebhookEvent } from './webhook-event.enum'
import { AuthGuard } from 'src/auth/guards/auth.guard'

const WEBHOOK_ID_PARAM = {
  name: 'webhookId',
  description: 'Subscription id, from GET /webhooks.',
} as const

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing, invalid, or revoked API key.',
} as const

const WEBHOOK_NOT_FOUND_RESPONSE = {
  status: 404,
  description: 'No webhook subscription with that id on your account.',
} as const

@ApiTags('webhooks')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @ApiOperation({
    summary: 'List your webhook subscriptions',
    description:
      'Every subscription on your account, deleted ones excluded. Each one says which events it receives and where they are delivered.',
  })
  @ApiResponse({
    status: 200,
    description: 'Your subscriptions.',
    type: WebhookListResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get()
  @UseGuards(AuthGuard)
  async getWebhooks(@Request() req) {
    const data = await this.webhookService.findWebhooksForUser({
      user: req.user,
    })
    return { data }
  }

  @ApiOperation({
    summary: 'List webhook delivery attempts',
    description:
      'Delivery history across your subscriptions, newest first. Use it to see what textbee sent, what your endpoint answered, and whether a retry is pending. History is kept for subscriptions you have since deleted.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page to return. Default 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Records per page. Default 10.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'retrying', 'delivered', 'failed'],
    description: 'Only return deliveries in this state.',
  })
  @ApiQuery({
    name: 'eventType',
    required: false,
    enum: WebhookEvent,
    description: 'Only return deliveries for this event.',
  })
  @ApiQuery({
    name: 'deviceId',
    required: false,
    type: String,
    description: 'Only return deliveries for messages from this device.',
  })
  @ApiQuery({
    name: 'start',
    required: false,
    type: String,
    description:
      'Start of the time range, ISO 8601. Applied only together with end.',
    example: '2026-08-01T00:00:00Z',
  })
  @ApiQuery({
    name: 'end',
    required: false,
    type: String,
    description: 'End of the time range, ISO 8601.',
    example: '2026-08-31T23:59:59Z',
  })
  @ApiQuery({
    name: 'webhookSubscriptionId',
    required: false,
    type: String,
    description: 'Only return deliveries for one subscription.',
  })
  @ApiResponse({
    status: 200,
    description: 'A page of delivery records.',
    type: WebhookNotificationListResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'deviceId or webhookSubscriptionId is not a valid id.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(WEBHOOK_NOT_FOUND_RESPONSE)
  @Get('notifications')
  @UseGuards(AuthGuard)
  async getWebhookNotifications(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('deviceId') deviceId?: string,
    @Query('start') start?: Date,
    @Query('end') end?: Date,
    @Query('webhookSubscriptionId') webhookSubscriptionId?: string,
  ) {
    const data = await this.webhookService.findWebhookNotificationsForUser({
      user: req.user,
      page,
      limit,
      eventType,
      status,
      start,
      end,
      deviceId,
      webhookSubscriptionId,
    })
    return { data }
  }

  @ApiOperation({
    summary: 'Get a webhook subscription',
    description: 'One subscription with its delivery counters.',
  })
  @ApiParam(WEBHOOK_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The subscription.',
    type: WebhookResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(WEBHOOK_NOT_FOUND_RESPONSE)
  @Get(':webhookId')
  @UseGuards(AuthGuard)
  async getWebhook(@Request() req, @Param('webhookId') webhookId: string) {
    const data = await this.webhookService.findOne({
      user: req.user,
      webhookId,
    })
    return { data }
  }

  @ApiOperation({
    summary: 'Create a webhook subscription',
    description:
      'textbee POSTs the events you pick to your delivery URL and signs each request with your signing secret, sent as the X-Signature header. Failed deliveries are retried up to 10 times, and a subscription that keeps failing is paused.',
  })
  @ApiResponse({
    status: 201,
    description: 'The subscription was created.',
    type: WebhookCreatedResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'The delivery URL is unusable, the signing secret is shorter than 20 characters, the event list is empty or unknown, or you already have the maximum number of subscriptions.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Post()
  @UseGuards(AuthGuard)
  async createWebhook(
    @Request() req,
    @Body() createWebhookDto: CreateWebhookDto,
  ) {
    const data = await this.webhookService.create({
      user: req.user,
      createWebhookDto,
    })
    return { data }
  }

  @ApiOperation({
    summary: 'Update a webhook subscription',
    description:
      'Changes only the fields you send. Use isActive to re-enable a subscription textbee paused after repeated failures.',
  })
  @ApiParam(WEBHOOK_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The updated subscription.',
    type: WebhookResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'The delivery URL is unusable, the signing secret is shorter than 20 characters, or the event list is empty or unknown.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(WEBHOOK_NOT_FOUND_RESPONSE)
  @Patch(':webhookId')
  @UseGuards(AuthGuard)
  async updateWebhook(
    @Request() req,
    @Param('webhookId') webhookId: string,
    @Body() updateWebhookDto: UpdateWebhookDto,
  ) {
    const data = await this.webhookService.update({
      user: req.user,
      webhookId,
      updateWebhookDto,
    })
    return { data }
  }

  @ApiOperation({
    summary: 'Delete a webhook subscription',
    description:
      'Stops all deliveries for this subscription. Its delivery history stays readable through GET /webhooks/notifications.',
  })
  @ApiParam(WEBHOOK_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The subscription was deleted.',
    type: WebhookDeletedResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(WEBHOOK_NOT_FOUND_RESPONSE)
  @Delete(':webhookId')
  @UseGuards(AuthGuard)
  async deleteWebhook(
    @Request() req,
    @Param('webhookId') webhookId: string,
  ) {
    const data = await this.webhookService.remove({
      user: req.user,
      webhookId,
    })
    return { data }
  }
}
