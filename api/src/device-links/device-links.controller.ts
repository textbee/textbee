import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseFilters,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import { LoginSessionGuard } from '../auth/guards/login-session.guard'
import { DeviceLinksService } from './device-links.service'
import { DeviceLinkErrorFilter } from './device-link-error.filter'

const CODE_PARAM = {
  name: 'code',
  description: 'The code the app shows, with or without the hyphen, in any letter case.',
} as const

// Connect a phone by sign-in: the app asks for a code, a logged-in user
// approves it in the browser, and the app collects a key for that phone.
@ApiTags('auth')
@UseFilters(DeviceLinkErrorFilter)
@Controller('auth')
export class DeviceLinksController {
  constructor(private readonly deviceLinks: DeviceLinksService) {}

  @ApiOperation({
    summary: 'Start a phone sign-in',
    description:
      'Called by the textbee app. Returns a code to approve in the browser and a poll token that only the phone holds.',
  })
  @ApiResponse({ status: 201, description: 'The code, the addresses and the poll token.' })
  @ApiResponse({ status: 400, description: 'A required phone detail is missing or invalid.' })
  @ApiResponse({ status: 429, description: 'Too many sign-in requests from this network.' })
  @ApiResponse({ status: 503, description: 'Sign-in is off or busy.' })
  @Post('/device-links')
  async create(@Body() body: unknown, @Request() req) {
    const data = await this.deviceLinks.create(body, req)
    return { data }
  }

  @ApiOperation({
    summary: 'Ask whether a phone sign-in was approved',
    description:
      'Called by the textbee app with its poll token. Answers pending, denied, expired, or approved with the key for the phone.',
  })
  @ApiResponse({ status: 200, description: 'The state of the sign-in request.' })
  @ApiResponse({ status: 404, description: 'No sign-in request for this token.' })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Post('/device-links/poll')
  async poll(@Body() body: unknown) {
    const data = await this.deviceLinks.poll(body)
    return { data }
  }

  @ApiOperation({
    summary: 'Get the dashboard settings of phone sign-in',
    description: 'Whether the dashboard offers the code field, and which tab it opens first.',
  })
  @ApiResponse({ status: 200, description: 'enabled and defaultTab.' })
  @ApiResponse({ status: 401, description: 'No dashboard login, or an API key was sent.' })
  @ApiBearerAuth()
  @UseGuards(LoginSessionGuard, AuthGuard)
  @Get('/device-link-settings')
  async settings(@Request() req) {
    const data = await this.deviceLinks.settings(req.user)
    return { data }
  }

  @ApiOperation({
    summary: 'Look up a phone sign-in by its code',
    description: 'The phone details and the choices for the link page.',
  })
  @ApiParam(CODE_PARAM)
  @ApiResponse({ status: 200, description: 'The request and its choices.' })
  @ApiResponse({ status: 401, description: 'No dashboard login, or an API key was sent.' })
  @ApiResponse({ status: 404, description: 'The code is not valid or has expired.' })
  @ApiResponse({ status: 429, description: 'Too many wrong codes.' })
  @ApiResponse({ status: 503, description: 'Sign-in is off for this account.' })
  @ApiBearerAuth()
  @UseGuards(LoginSessionGuard, AuthGuard)
  @Get('/device-links/:code')
  async lookup(@Param('code') code: string, @Request() req) {
    const data = await this.deviceLinks.lookup(req.user, code, req)
    return { data }
  }

  @ApiOperation({
    summary: 'Approve a phone sign-in',
    description: 'Connects the phone as a new device or in place of a device of the account.',
  })
  @ApiParam(CODE_PARAM)
  @ApiResponse({ status: 200, description: 'The request is approved.' })
  @ApiResponse({ status: 400, description: 'The choice is not available, or the typed code does not match.' })
  @ApiResponse({ status: 401, description: 'No dashboard login, or an API key was sent.' })
  @ApiResponse({ status: 403, description: 'This account cannot connect a device.' })
  @ApiResponse({ status: 404, description: 'The code is not valid or has expired.' })
  @ApiResponse({ status: 409, description: 'The device limit of the plan is reached.' })
  @ApiResponse({ status: 503, description: 'Sign-in is off for this account.' })
  @ApiBearerAuth()
  @UseGuards(LoginSessionGuard, AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('/device-links/:code/approve')
  async approve(@Param('code') code: string, @Body() body: unknown, @Request() req) {
    const data = await this.deviceLinks.approve(req.user, code, body, req)
    return { data }
  }

  @ApiOperation({
    summary: 'Cancel a phone sign-in',
    description: 'The phone is told that the request was cancelled. Nothing is changed.',
  })
  @ApiParam(CODE_PARAM)
  @ApiResponse({ status: 200, description: 'The request is cancelled.' })
  @ApiResponse({ status: 401, description: 'No dashboard login, or an API key was sent.' })
  @ApiResponse({ status: 404, description: 'The code is not valid or has expired.' })
  @ApiBearerAuth()
  @UseGuards(LoginSessionGuard, AuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('/device-links/:code/deny')
  async deny(@Param('code') code: string, @Request() req) {
    const data = await this.deviceLinks.deny(req.user, code)
    return { data }
  }
}
