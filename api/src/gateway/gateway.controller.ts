import {
  Body,
  Controller,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
  Request,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import {
  CursorPaginationMetaDTO,
  DeviceListResponseDTO,
  DeviceResponseDTO,
  GatewayStatsResponseDTO,
  MessageListResponseDTO,
  MessagePageMetaDTO,
  ReceivedSMSDTO,
  RegisterDeviceInputDTO,
  pickDeviceWritableFields,
  RetrieveSMSResponseDTO,
  SendBulkSMSInputDTO,
  SendBulkSMSRequestDTO,
  SendSMSInputDTO,
  SendSMSRequestDTO,
  SendSMSResponseDTO,
  SMSBatchResponseDTO,
  SMSResponseDTO,
  SmsPermissionStatusResponseDTO,
  SuccessResponseDTO,
  UpdateSMSStatusDTO,
  HeartbeatInputDTO,
  HeartbeatResponseDTO,
} from './gateway.dto'
import { GatewayService } from './gateway.service'
import { CanModifyDevice } from './guards/can-modify-device.guard'
import { parseMessageQuery } from './message-query'

const DEVICE_ID_PARAM = {
  name: 'id',
  description: 'Device id, from GET /gateway/devices.',
} as const

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing, invalid, or revoked API key.',
} as const

const DEVICE_NOT_FOUND_RESPONSE = {
  status: 404,
  description: 'No device with that id on your account.',
} as const

const INVALID_DEVICE_ID_RESPONSE = {
  status: 400,
  description: 'The device id is not a valid id.',
} as const

// Query params arrive as strings; non-integer or out-of-range values resolve
// to the defaults (page 1, limit 50) and limit is capped at 100.
function parsePagination(query: {
  page?: string
  limit?: string
}): { page: number; limit: number } {
  const page = parseInt(String(query?.page), 10)
  const limit = parseInt(String(query?.limit), 10)
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 50,
  }
}

@ApiTags('gateway')
@ApiBearerAuth()
@ApiSecurity('x-api-key')
@Controller('gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get account totals',
    description:
      'Messages sent, messages received, devices, and API keys across your whole account.',
  })
  @ApiResponse({
    status: 200,
    description: 'Account totals.',
    type: GatewayStatsResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get('/stats')
  async getStats(@Request() req) {
    const data = await this.gatewayService.getStatsForUser(req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Check whether a missing SMS permission blocks sending',
    description:
      'Reads your latest outgoing message. If it failed with error code PERMISSION_DENIED, the textbee app on that phone lacks the SMS permission (or the Phone permission, for a send from a chosen SIM) and every send from it fails until the permission is granted (source failure). Otherwise, if an enabled phone reported the SMS permission off in a heartbeat within the last 7 days, the result also says the permission is needed, before any send is attempted (source heartbeat). The result clears as soon as a later message is sent or the phone reports the permission granted.',
  })
  @ApiResponse({
    status: 200,
    description: 'Permission status.',
    type: SmsPermissionStatusResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get('/sms-permission-status')
  async getSmsPermissionStatus(@Request() req) {
    const data = await this.gatewayService.getSmsPermissionStatus(req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Register a device',
    description:
      'Pairs an Android phone with your account. The textbee app calls this on setup and again whenever the push token changes.',
  })
  @ApiResponse({
    status: 201,
    description: 'The registered device.',
    type: DeviceResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Post('/devices')
  async registerDevice(@Body() input: RegisterDeviceInputDTO, @Request() req) {
    const data = await this.gatewayService.registerDevice(
      pickDeviceWritableFields(input),
      req.user,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'List your devices',
    description:
      'Every phone paired with your account. The push token and hardware serial are never returned.',
  })
  @ApiResponse({
    status: 200,
    description: 'Your devices.',
    type: DeviceListResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @Get('/devices')
  async getDevices(@Request() req) {
    const data = await this.gatewayService.getDevicesForUser(req.user)
    return { data }
  }

  @ApiOperation({
    summary: 'Get a device',
    description:
      'Full state of one device, including its last heartbeat, battery, and SIM list.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The device.',
    type: DeviceResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id')
  async getDevice(@Param('id') deviceId: string) {
    const data = await this.gatewayService.getDeviceById(
      deviceId,
      undefined,
      '-fcmToken -serial',
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Update a device',
    description:
      'Changes device settings such as the name or whether it is enabled. Only writable device fields are applied.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The updated device.',
    type: DeviceResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @Patch('/devices/:id')
  async updateDevice(
    @Param('id') deviceId: string,
    @Body() input: RegisterDeviceInputDTO,
  ) {
    const data = await this.gatewayService.updateDevice(
      deviceId,
      pickDeviceWritableFields(input),
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Report a device heartbeat',
    description:
      'Called by the textbee app on a schedule to report that the phone is online, refresh its push token, and upload battery, storage, and SIM state.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'Heartbeat accepted.',
    type: HeartbeatResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post('/devices/:id/heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Param('id') deviceId: string,
    @Body() input: HeartbeatInputDTO,
  ): Promise<HeartbeatResponseDTO> {
    const data = await this.gatewayService.heartbeat(deviceId, input)
    return data
  }

  @ApiOperation({
    summary: 'Delete a device',
    description:
      'Unpairs the phone. Message history is kept, and the app has to pair again to send from this phone.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The device was deleted.',
    type: SuccessResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @Delete('/devices/:id')
  async deleteDevice(@Param('id') deviceId: string) {
    const data = await this.gatewayService.deleteDevice(deviceId)
    return { data }
  }

  @ApiOperation({
    summary: 'Set the default sending device',
    description:
      'Sends that omit deviceId go out from this device. Any other device loses the flag.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The device is now the default.',
    type: DeviceResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post('/devices/:id/set-default')
  @HttpCode(HttpStatus.OK)
  async setDefaultDevice(@Param('id') deviceId: string) {
    const data = await this.gatewayService.setDefaultDevice(deviceId)
    return { data }
  }

  @ApiOperation({
    summary: 'Send an SMS',
    description:
      'Sends one message to one or more recipients from a phone on your account. deviceId is optional: without it textbee uses your default device, otherwise the enabled device with the most recent heartbeat. Every recipient counts as one message against your plan.',
  })
  @ApiResponse({
    status: 200,
    description:
      'The send was accepted. Use smsBatchId to follow delivery. Acceptance is not delivery: the phone still has to be online.',
    type: SendSMSResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'No enabled device to send from, the device is disabled, your email is not verified, or the message could not be pushed to the phone.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 429,
    description:
      'Your daily, monthly, or per-batch plan limit is used up. The body says which one.',
  })
  @UseGuards(AuthGuard)
  @Post('/send-sms')
  @HttpCode(HttpStatus.OK)
  async sendSMSDeviceless(@Request() req, @Body() body: SendSMSRequestDTO) {
    const device = await this.gatewayService.resolveSenderDevice(
      req.user,
      body.deviceId,
    )
    const data = await this.gatewayService.sendSMS(device._id.toString(), body)
    return { data }
  }

  @ApiOperation({
    summary: 'Send several SMS in one call',
    description:
      'Sends a batch where every entry has its own text and recipients. deviceId is optional and resolves the same way as POST /gateway/send-sms.',
  })
  @ApiResponse({
    status: 200,
    description: 'The batch was accepted.',
    type: SendSMSResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'No enabled device to send from, the device is disabled, your email is not verified, or the batch could not be pushed to the phone.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 429,
    description:
      'Your daily, monthly, or per-batch plan limit is used up. The body says which one.',
  })
  @UseGuards(AuthGuard)
  @Post('/send-bulk-sms')
  @HttpCode(HttpStatus.OK)
  async sendBulkSMSDeviceless(
    @Request() req,
    @Body() body: SendBulkSMSRequestDTO,
  ) {
    const device = await this.gatewayService.resolveSenderDevice(
      req.user,
      body.deviceId,
    )
    const data = await this.gatewayService.sendBulkSMS(
      device._id.toString(),
      body,
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Send an SMS from a named device',
    description:
      'Use POST /gateway/send-sms with an optional deviceId in the body instead. Kept so existing integrations keep working.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 201,
    description: 'The send was accepted.',
    type: SendSMSResponseDTO,
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  // deprecate sendSMS route in favor of send-sms, but allow both to prevent breaking changes
  @Post(['/devices/:id/sendSMS', '/devices/:id/send-sms'])
  async sendSMS(
    @Param('id') deviceId: string,
    @Body() smsData: SendSMSInputDTO,
  ) {
    const data = await this.gatewayService.sendSMS(deviceId, smsData)
    return { data }
  }

  @ApiOperation({
    summary: 'Send several SMS from a named device',
    description:
      'Use POST /gateway/send-bulk-sms with an optional deviceId in the body instead. Kept so existing integrations keep working.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 201,
    description: 'The batch was accepted.',
    type: SendSMSResponseDTO,
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post(['/devices/:id/send-bulk-sms'])
  async sendBulkSMS(
    @Param('id') deviceId: string,
    @Body() body: SendBulkSMSInputDTO,
  ) {
    const data = await this.gatewayService.sendBulkSMS(deviceId, body)
    return { data }
  }


  @ApiOperation({
    summary: 'Report an incoming SMS',
    description:
      'Called by the textbee app when the phone receives a message. This is how received message history and MESSAGE_RECEIVED webhooks get their data. ' +
      'A message with no text or no sender returns 200 with data.ignored set to true and is not stored. A missing or non-string message returns 400. ' +
      'A message is stored even when the account is over its plan limit, with overLimit set to true. ' +
      'A message uploaded more than 24 hours after receivedAt is stored with createdAt set to receivedAt and the upload time in originalCreatedAt. ' +
      'MESSAGE_RECEIVED webhooks are not sent for a message uploaded more than 48 hours after receivedAt.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description:
      'The message was stored, or acknowledged and ignored when it has no text or no sender.',
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @HttpCode(HttpStatus.OK)
  @Post('/devices/:id/receive-sms')
  @UseGuards(AuthGuard, CanModifyDevice)
  async receiveSMS(
    @Param('id') deviceId: string,
    @Body() dto: ReceivedSMSDTO,
    @Headers('x-sdk-client') sdkClient?: string,
  ) {
    const data = await this.gatewayService.receiveSMS(deviceId, dto, sdkClient)
    return { data }
  }

  @ApiOperation({
    summary: 'Report an incoming SMS, legacy path',
    description:
      'Use POST /gateway/devices/{id}/receive-sms instead. Kept for older builds of the Android app.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description:
      'The message was stored, or acknowledged and ignored when it has no text or no sender.',
  })
  @HttpCode(HttpStatus.OK)
  // legacy alias kept for older app versions and integrations
  @Post('/devices/:id/receiveSMS')
  @UseGuards(AuthGuard, CanModifyDevice)
  async receiveSMSLegacy(
    @Param('id') deviceId: string,
    @Body() dto: ReceivedSMSDTO,
    @Headers('x-sdk-client') sdkClient?: string,
  ) {
    return await this.receiveSMS(deviceId, dto, sdkClient)
  }

  @ApiOperation({
    summary: 'List messages',
    description:
      'Sent and received messages across your whole account, newest first, with delivery status on each. ' +
      'Filter by device, direction, status, text, and time range. ' +
      'Two pagination modes: page numbers for browsing, or cursor for polling. ' +
      'To poll for new messages: request order=asc with a from timestamp, follow nextCursor until hasMore is false, then resume from the last nextCursor on the next poll. ' +
      'Time filters apply to createdAt (when the platform stored the message). For received messages this is upload time, which can lag receivedAt if the device was offline. ' +
      'A received message uploaded more than 24 hours after receivedAt is stored with createdAt set to receivedAt and the upload time in originalCreatedAt, so a poll that has already moved past receivedAt does not return it.',
  })
  @ApiExtraModels(MessagePageMetaDTO, CursorPaginationMetaDTO)
  @ApiResponse({
    status: 200,
    description: 'A page of messages.',
    type: MessageListResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid deviceIds, smsBatchId, direction, status, from, to, order, or cursor value. Unknown filter values fail rather than silently applying no filter.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 404,
    description: 'A deviceIds entry or the smsBatchId is not on your account.',
  })
  @ApiQuery({
    name: 'deviceIds',
    required: false,
    type: String,
    description:
      'Comma-separated device ids to include, from GET /gateway/devices. Default: all devices on the account. Messages from deleted devices are never included.',
  })
  @ApiQuery({
    name: 'direction',
    required: false,
    type: String,
    enum: ['all', 'sent', 'received'],
    description:
      'Direction to return. Default all. Matches the lowercase direction field on each message. Not the same as status: direction=sent means outbound, status=sent means the device dispatched it.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    deprecated: true,
    type: String,
    enum: ['all', 'sent', 'received'],
    description: 'Deprecated alias of direction. Still works; prefer direction.',
  })
  @ApiQuery({
    name: 'smsBatchId',
    required: false,
    type: String,
    description:
      'Only messages from this batch, using the smsBatchId returned by a send. Combine with status=failed to list the recipients of a batch that failed.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    enum: ['pending', 'dispatched', 'sent', 'delivered', 'failed', 'unknown', 'received'],
    description:
      'Delivery state to return. Combine with direction: direction=sent&status=failed lists sends that failed.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description:
      'Match against the message text and the other party number. Encrypted messages cannot be searched.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    description:
      'Inclusive lower bound on createdAt, which for a received message uploaded more than 24 hours late equals receivedAt. ISO-8601 with an explicit timezone (2026-08-01T00:00:00Z or +03:00 form), or a date (2026-08-01, read as UTC midnight). A datetime without a timezone is rejected.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    type: String,
    description:
      'Exclusive upper bound on createdAt, same formats as from. Exclusive so consecutive windows never double-count a boundary message.',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    type: String,
    enum: ['desc', 'asc'],
    description: 'desc (default) for newest first; asc to walk forward in time when polling.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Page to return. Default 1. Mutually exclusive with cursor.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Messages per page. Default 50, maximum 100.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    description:
      'Opaque position from a previous response nextCursor. Returns the page after that position and switches meta to nextCursor/hasMore without a total count.',
  })
  @UseGuards(AuthGuard)
  @Get('/messages')
  async getAccountMessages(@Request() req): Promise<MessageListResponseDTO> {
    const filters = parseMessageQuery(req.query)
    const { page, limit } = parsePagination(req.query)
    return await this.gatewayService.getMessagesForUser(req.user, filters, page, limit)
  }

  @ApiOperation({
    summary: 'List received messages for one device',
    description:
      'Messages this device received, newest first. Prefer GET /gateway/messages, which covers the whole account and both directions.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'A page of received messages.',
    type: RetrieveSMSResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Page to return. Default 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Messages per page. Default 50, maximum 100.',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/get-received-sms')
  async getReceivedSMS(
    @Param('id') deviceId: string,
    @Request() req,
  ): Promise<RetrieveSMSResponseDTO> {
    // Malformed or out-of-range values fall back to defaults instead of
    // erroring, so existing callers keep working.
    const { page, limit } = parsePagination(req.query)

    const result = await this.gatewayService.getReceivedSMS(deviceId, page, limit)
    return result;
  }

  @ApiOperation({
    summary: 'List received messages, legacy path',
    description:
      'Use GET /gateway/messages with direction=received instead. Kept so existing integrations keep working.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'A page of received messages.',
    type: RetrieveSMSResponseDTO,
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Page to return. Default 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Messages per page. Default 50, maximum 100.',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  // legacy alias kept for older app versions and integrations
  @Get('/devices/:id/getReceivedSMS')
  async getReceivedSMSLegacy(
    @Param('id') deviceId: string,
    @Request() req,
  ): Promise<RetrieveSMSResponseDTO> {
    return await this.getReceivedSMS(deviceId, req)
  }

  @ApiOperation({
    summary: 'List message history for one device',
    description:
      'Use GET /gateway/messages with deviceIds instead: it covers the whole account, adds time-range and status filters, and supports cursor polling. Kept so existing integrations keep working.',
    deprecated: true,
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'A page of messages.',
    type: RetrieveSMSResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @ApiQuery({
    name: 'page',
    required: false,
    schema: { type: 'integer', minimum: 1, default: 1 },
    description: 'Page to return. Default 1.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
    description: 'Messages per page. Default 50, maximum 100.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    enum: ['all', 'sent', 'received'],
    description:
      'Direction to return, lowercase. Default all. Note the asymmetry: this filter is lowercase while the type field on each message comes back uppercase, and an unrecognised value such as SENT applies no filter at all rather than failing.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description:
      'Match against the message text and the other party number. Encrypted messages cannot be searched.',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/messages')
  async getMessages(
    @Param('id') deviceId: string,
    @Request() req,
  ): Promise<RetrieveSMSResponseDTO> {
    const { page, limit } = parsePagination(req.query)
    const type = req.query.type || '';
    const search = req.query.search || '';

    const result = await this.gatewayService.getMessages(deviceId, type, page, limit, search);
    return result;
  }

  @ApiOperation({
    summary: 'Claim messages a push may have missed',
    description:
      'Called by the textbee app when a heartbeat reports pending messages. Returns outbound messages still waiting after 30 minutes, at most 25, and marks each as dispatched again. Not more than once per 5 minutes per device.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({ status: 200, description: 'Messages for the app to send.' })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @ApiResponse({ status: 403, description: 'The app version is too old to recover messages, or message recovery is switched off.' })
  @ApiResponse({ status: 429, description: 'Polled again within the cooldown.' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/messages/pending')
  async claimPendingMessages(@Param('id') deviceId: string) {
    const data = await this.gatewayService.claimPendingMessages(deviceId)
    return { data }
  }

  @ApiOperation({
    summary: 'Update the delivery status of an SMS',
    description:
      'Called by the textbee app once the carrier reports the outcome. This is what moves a message from sent to delivered or failed.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiResponse({ status: 200, description: 'The status was recorded.' })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse(DEVICE_NOT_FOUND_RESPONSE)
  @UseGuards(AuthGuard, CanModifyDevice)
  @HttpCode(HttpStatus.OK)
  @Patch('/devices/:id/sms-status')
  async updateSMSStatus(
    @Param('id') deviceId: string,
    @Body() dto: UpdateSMSStatusDTO,
    @Headers('x-sdk-client') sdkClient?: string,
  ) {
    const data = await this.gatewayService.updateSMSStatus(
      deviceId,
      dto,
      sdkClient,
    );
    return { data };
  }

  @ApiOperation({
    summary: 'Get one message',
    description:
      'A single sent or received message with its delivery timestamps. Use it to check the outcome of one recipient.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiParam({
    name: 'smsId',
    description: 'Message id, from the message history response.',
  })
  @ApiResponse({
    status: 200,
    description: 'The message.',
    type: SMSResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 404,
    description: 'No such message on this device.',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/sms/:smsId')
  async getSMSById(
    @Param('id') deviceId: string,
    @Param('smsId') smsId: string,
  ) {
    const data = await this.gatewayService.getSMSById(deviceId, smsId);
    return { data };
  }

  @ApiOperation({
    summary: 'Get a send batch',
    description:
      'The batch returned by a send, plus one message per recipient. The batch status and counts are calculated from the messages, so they follow each status report from the phone. Poll this to see how a send is progressing.',
  })
  @ApiParam(DEVICE_ID_PARAM)
  @ApiParam({
    name: 'smsBatchId',
    description: 'Batch id, returned as smsBatchId by the send endpoints.',
  })
  @ApiResponse({
    status: 200,
    description: 'The batch and its messages.',
    type: SMSBatchResponseDTO,
  })
  @ApiResponse(INVALID_DEVICE_ID_RESPONSE)
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 404,
    description: 'No such batch on this device.',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/sms-batch/:smsBatchId')
  async getSmsBatchById(
    @Param('id') deviceId: string,
    @Param('smsBatchId') smsBatchId: string,
  ) {
    const data = await this.gatewayService.getSmsBatchById(
      deviceId,
      smsBatchId,
    );
    return { data };
  }
}
