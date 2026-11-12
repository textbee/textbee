import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import {
  ApiKeyCreatedResponseDTO,
  ApiKeyListResponseDTO,
  AuthSessionResponseDTO,
  ChangePasswordInputDTO,
  CorrectEmailEligibilityDTO,
  CorrectEmailInputDTO,
  CorrectEmailResponseDTO,
  GoogleLoginInputDTO,
  LoginInputDTO,
  MessageResponseDTO,
  RegisterInputDTO,
  RenameApiKeyInputDTO,
  RequestResetPasswordInputDTO,
  ResetPasswordInputDTO,
  UpdateOnboardingDTO,
  UpdateProfileInputDTO,
  UserResponseDTO,
  VerifyEmailInputDTO,
} from './auth.dto'
import { AuthGuard } from './guards/auth.guard'
import { AuthService } from './auth.service'
import { resolveRequestContext } from '../common/request-context'
import { UsersService } from '../users/users.service'
import { CanModifyApiKey } from './guards/can-modify-api-key.guard'
import { EmailCorrectionService } from './email-correction.service'

const API_KEY_ID_PARAM = {
  name: 'id',
  description: 'API key id, from GET /auth/api-keys.',
} as const

const UNAUTHORIZED_RESPONSE = {
  status: 401,
  description: 'Missing or invalid credentials.',
} as const

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
    private emailCorrectionService: EmailCorrectionService,
  ) {}

  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Returns a JWT for the dashboard. Programmatic callers use an API key instead and never need this endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'Signed in.',
    type: AuthSessionResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'The Turnstile check failed.',
  })
  @ApiResponse({
    status: 401,
    description: 'Wrong email or password.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('/login')
  async login(@Body() input: LoginInputDTO, @Request() req) {
    const data = await this.authService.login(
      input,
      resolveRequestContext(input.client, req),
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      'Exchanges a Google ID token for a textbee session. Creates the account on first sign in.',
  })
  @ApiResponse({
    status: 200,
    description: 'Signed in.',
    type: AuthSessionResponseDTO,
  })
  @ApiResponse({
    status: 401,
    description:
      'The Google token is invalid, was issued for another app, or its email is unverified.',
  })
  @ApiResponse({
    status: 409,
    description: 'The email belongs to an account linked to another Google account.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('/google-login')
  async googleLogin(@Body() input: GoogleLoginInputDTO, @Request() req) {
    const data = await this.authService.loginWithGoogle(input.idToken, {
      attribution: input.attribution,
      ...resolveRequestContext(input.client, req),
    })
    return { data }
  }

  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates the account and signs it in. Verify the email before sending, since unverified accounts cannot send messages.',
  })
  @ApiResponse({
    status: 201,
    description: 'The account was created.',
    type: AuthSessionResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'The email is already in use, or the Turnstile check failed.',
  })
  @Post('/register')
  async register(@Body() input: RegisterInputDTO, @Request() req) {
    const data = await this.authService.register(
      input,
      resolveRequestContext(input.client, req),
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Get the current account',
    description:
      'The account behind the credentials on the request. Useful to check which account an API key belongs to.',
  })
  @ApiResponse({
    status: 200,
    description: 'The current account.',
    type: UserResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @UseGuards(AuthGuard)
  @Get('/who-am-i')
  async whoAmI(@Request() req) {
    return { data: req.user }
  }

  @ApiOperation({
    summary: 'Update your profile',
    description: 'Changes the name and phone number on the account.',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated account.',
    type: UserResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @UseGuards(AuthGuard)
  @Patch('/update-profile')
  async updateProfile(
    @Body() input: UpdateProfileInputDTO,
    @Request() req,
  ) {
    return await this.authService.updateProfile(input, req.user)
  }

  @ApiOperation({
    summary: 'Change your password',
    description: 'Requires the current password.',
  })
  @ApiResponse({
    status: 200,
    description: 'The password was changed.',
    type: MessageResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'The current password is wrong.' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @UseGuards(AuthGuard)
  @Post('/change-password')
  async changePassword(
    @Body() input: ChangePasswordInputDTO,
    @Request() req,
  ) {
    return await this.authService.changePassword(input, req.user)
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Create an API key',
    description:
      'Creates a key with full access to the account. The full key is returned once and only stored hashed, so copy it now.',
  })
  @ApiResponse({
    status: 201,
    description: 'The new key, in full.',
    type: ApiKeyCreatedResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @Post('/api-keys')
  async generateApiKey(@Request() req) {
    const { apiKey, message } = await this.authService.generateApiKey(req.user)
    return { data: apiKey, message }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'List your API keys',
    description:
      'Keys are returned masked, newest first. The full key is only ever shown when it is created.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'revoked', 'all'],
    description: 'Which keys to return. Default active.',
  })
  @ApiResponse({
    status: 200,
    description: 'Your keys, masked.',
    type: ApiKeyListResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'Unknown status value.' })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @Get('/api-keys')
  async getApiKey(
    @Request() req,
    @Query('status') status?: string,
  ) {
    const data = await this.authService.getUserApiKeysWithDevices(
      req.user,
      status,
    )
    return { data }
  }

  @UseGuards(AuthGuard, CanModifyApiKey)
  @ApiOperation({
    summary: 'Delete an API key',
    description:
      'Removes the key and its usage record. Revoke instead if you want to keep the record.',
  })
  @ApiParam(API_KEY_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The key was deleted.',
    type: MessageResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({ status: 404, description: 'No such key on your account.' })
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @HttpCode(HttpStatus.OK)
  @Delete('/api-keys/:id')
  async deleteApiKey(@Param() params) {
    await this.authService.deleteApiKey(params.id)
    return { message: 'API Key Deleted' }
  }

  @UseGuards(AuthGuard, CanModifyApiKey)
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Stops the key working immediately while keeping it in the list. Use this when a key may have leaked.',
  })
  @ApiParam(API_KEY_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The key was revoked.',
    type: MessageResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({ status: 404, description: 'No such key on your account.' })
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @HttpCode(HttpStatus.OK)
  @Post('/api-keys/:id/revoke')
  async revokeApiKey(@Param() params) {
    await this.authService.revokeApiKey(params.id)
    return { message: 'API Key Revoked' }
  }

  @UseGuards(AuthGuard, CanModifyApiKey)
  @ApiOperation({
    summary: 'Rename an API key',
    description: 'Changes the label only. The key itself is unchanged.',
  })
  @ApiParam(API_KEY_ID_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The key was renamed.',
    type: MessageResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({ status: 404, description: 'No such key on your account.' })
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @HttpCode(HttpStatus.OK)
  @Patch('/api-keys/:id/rename')
  async renameApiKey(@Param() params, @Body() input: RenameApiKeyInputDTO) {
    await this.authService.renameApiKey(params.id, input.name)
    return { message: 'API Key Renamed' }
  }

  @ApiOperation({
    summary: 'Update dashboard onboarding progress',
    description: 'Tracks which onboarding step the dashboard should show next.',
  })
  @ApiResponse({
    status: 200,
    description: 'The updated account.',
    type: UserResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @UseGuards(AuthGuard)
  @Patch('/onboarding')
  async updateOnboarding(
    @Body() input: UpdateOnboardingDTO,
    @Request() req,
  ) {
    const user = await this.usersService.updateOnboarding(input, req.user)
    return { data: user }
  }

  @ApiOperation({
    summary: 'Request a password reset code',
    description:
      'Emails a one time code. The response is the same whether or not the address has an account.',
  })
  @ApiResponse({
    status: 200,
    description: 'The request was accepted.',
    type: MessageResponseDTO,
  })
  @ApiResponse({ status: 400, description: 'The Turnstile check failed.' })
  @HttpCode(HttpStatus.OK)
  @Post('/request-password-reset')
  async requestPasswordReset(@Body() input: RequestResetPasswordInputDTO) {
    return await this.authService.requestResetPassword(input)
  }

  @ApiOperation({
    summary: 'Set a new password with a reset code',
    description: 'Completes the reset started by the request endpoint.',
  })
  @ApiResponse({
    status: 200,
    description: 'The password was reset.',
    type: MessageResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'The code is wrong or has expired.',
  })
  @HttpCode(HttpStatus.OK)
  @Post('/reset-password')
  async resetPassword(@Body() input: ResetPasswordInputDTO) {
    return await this.authService.resetPassword(input)
  }

  // send email verification code
  @ApiOperation({
    summary: 'Send an email verification code',
    description:
      'Emails a code to the current account. Sending messages is blocked until the email is verified.',
  })
  @ApiResponse({
    status: 200,
    description: 'The email was sent.',
    type: MessageResponseDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiSecurity('x-api-key')
  @UseGuards(AuthGuard)
  @Post('/send-email-verification-email')
  async sendEmailVerificationEmail(@Request() req) {
    return await this.authService.sendEmailVerificationEmail(req.user)
  }

  @ApiOperation({
    summary: 'Verify an email address',
    description: 'Confirms the code from the verification email.',
  })
  @ApiResponse({
    status: 200,
    description: 'The email is verified.',
    type: MessageResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description: 'The code is wrong or has expired.',
  })
  @ApiResponse({ status: 404, description: 'No such account.' })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Post('/verify-email')
  async verifyEmail(@Body() input: VerifyEmailInputDTO) {
    return await this.authService.verifyEmail(input)
  }

  @ApiOperation({
    summary: 'Check if you can correct your email',
    description:
      'Tells the verify page whether to offer the email correction form. Only unverified password accounts with no devices, API keys, messages, webhooks or billing records can correct their own email. Always answers 200.',
  })
  @ApiResponse({
    status: 200,
    description: 'Whether the account can correct its email, and why not.',
    type: CorrectEmailEligibilityDTO,
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('/correct-email')
  async correctEmailEligibility(@Request() req) {
    return await this.emailCorrectionService.eligibility(req)
  }

  @ApiOperation({
    summary: 'Correct the email of an unverified account',
    description:
      'Changes the email of an unverified account with no activity and sends a verification link to the new address. Requires a dashboard session and the current password. Old verification links and password reset codes stop working. Limited to 3 changes and 10 attempts per account per day, and 10 requests per hour per IP address.',
  })
  @ApiResponse({
    status: 200,
    description:
      'The email was changed. sent says whether the verification link went out, and the message says what to do next.',
    type: CorrectEmailResponseDTO,
  })
  @ApiResponse({
    status: 400,
    description:
      'The email is invalid, is the current email or cannot receive mail, or the password is wrong.',
  })
  @ApiResponse(UNAUTHORIZED_RESPONSE)
  @ApiResponse({
    status: 403,
    description:
      'The request used an API key, the email is already verified, or the account must contact support.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Another account uses the email, or another request changed the email at the same time.',
  })
  @ApiResponse({ status: 429, description: 'Too many changes or attempts.' })
  @Throttle({ default: { limit: 10, ttl: 60 * 60 * 1000 } })
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('/correct-email')
  async correctEmail(@Body() input: CorrectEmailInputDTO, @Request() req) {
    return await this.emailCorrectionService.correctEmail(req, input)
  }
}
