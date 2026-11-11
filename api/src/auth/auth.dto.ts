import { ApiProperty } from '@nestjs/swagger'

export class AttributionTouchDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'utm_source from the link that was followed.',
    example: 'meta',
  })
  source?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'utm_medium from the link that was followed.',
    example: 'paid_social',
  })
  medium?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'utm_campaign from the link that was followed.',
  })
  campaign?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'utm_content from the link that was followed.',
  })
  content?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'utm_term from the link that was followed.',
  })
  term?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Value of a plain ref query parameter, used by short links.',
  })
  ref?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'Hostname of the referring site. Same-site referrers are not recorded.',
    example: 'news.ycombinator.com',
  })
  referrer?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Path the visitor landed on.',
    example: '/pricing',
  })
  landingPath?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Meta advertising click identifier from the address.',
  })
  fbclid?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Google advertising click identifier from the address.',
  })
  gclid?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'When the visit happened, as an ISO timestamp.',
  })
  at?: string
}

export class AttributionEntryDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Path of the very first page this person opened.',
    example: '/',
  })
  landingPath?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'When that first visit happened, as an ISO timestamp.',
  })
  at?: string
}

export class AttributionDTO {
  @ApiProperty({
    type: AttributionEntryDTO,
    required: false,
    description:
      'The first visit ever, recorded even when it carried no source. Never used for credit.',
  })
  entry?: AttributionEntryDTO

  @ApiProperty({
    type: AttributionTouchDTO,
    required: false,
    description: 'The visit that first brought this person to the site.',
  })
  first?: AttributionTouchDTO

  @ApiProperty({
    type: AttributionTouchDTO,
    required: false,
    description: 'The most recent visit that carried a source.',
  })
  last?: AttributionTouchDTO

  @ApiProperty({
    type: String,
    required: false,
    description: "Meta's browser cookie value, used to match ad clicks.",
  })
  fbp?: string
}

export class ClientContextDTO {
  @ApiProperty({
    type: String,
    required: false,
    description:
      "The visitor's browser user agent. Sent by the dashboard because it proxies this call, so the request itself carries the dashboard server's user agent rather than the visitor's.",
  })
  userAgent?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      "The visitor's IP address, forwarded for the same reason. Used only to label analytics, never for access control.",
  })
  ip?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      "The two-letter region code the edge network reported for the visitor, forwarded for the same reason. Used only to label analytics, never for access control.",
  })
  country?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'The region name the edge network reported for the visitor, forwarded for the same reason.',
    example: 'California',
  })
  region?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'The subdivision code of that region, forwarded for the same reason.',
    example: 'CA',
  })
  regionCode?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'The city the edge network reported for the visitor, forwarded for the same reason.',
    example: 'San Jose',
  })
  city?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      'The two-letter continent code the edge network reported for the visitor, forwarded for the same reason.',
    example: 'NA',
  })
  continent?: string

  @ApiProperty({
    type: String,
    required: false,
    description:
      "The visitor's IANA time zone as the edge network reported it, forwarded for the same reason.",
    example: 'America/Los_Angeles',
  })
  timezone?: string

  @ApiProperty({
    type: Number,
    required: false,
    description:
      "The autonomous system number of the visitor's network, forwarded for the same reason.",
    example: 7922,
  })
  asn?: number
}

export class RegisterInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Full name shown in the dashboard.',
    example: 'Ada Lovelace',
  })
  name: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Email address. Must not already have an account.',
    example: 'ada@example.com',
  })
  email: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Phone number, for account recovery.',
  })
  phone?: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Password for the new account.',
  })
  password: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'Whether the person agreed to receive product and promotional email.',
  })
  marketingOptIn?: boolean

  @ApiProperty({
    type: AttributionDTO,
    required: false,
    description:
      'Where this signup came from, as captured by the site. Unknown fields are discarded.',
  })
  attribution?: AttributionDTO

  @ApiProperty({
    type: ClientContextDTO,
    required: false,
    description: "The visitor's browser details, when the caller is a proxy.",
  })
  client?: ClientContextDTO

  @ApiProperty({
    type: String,
    required: true,
    description: 'Cloudflare Turnstile token from the signup form.',
  })
  turnstileToken: string
}

export class LoginInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Email address on the account.',
    example: 'ada@example.com',
  })
  email: string

  @ApiProperty({ type: String, required: true, description: 'Password.' })
  password: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Cloudflare Turnstile token from the login form.',
  })
  turnstileToken: string

  @ApiProperty({
    type: ClientContextDTO,
    required: false,
    description: "The visitor's browser details, when the caller is a proxy.",
  })
  client?: ClientContextDTO
}

export class GoogleLoginInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description:
      'Google ID token from the browser sign-in flow. It must be issued for the textbee client and carry a verified email.',
  })
  idToken: string

  @ApiProperty({
    type: AttributionDTO,
    required: false,
    description:
      'Where this signup came from. Recorded only when this call creates the account.',
  })
  attribution?: AttributionDTO

  @ApiProperty({
    type: ClientContextDTO,
    required: false,
    description: "The visitor's browser details, when the caller is a proxy.",
  })
  client?: ClientContextDTO
}

export class RequestResetPasswordInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Email address to send the reset code to.',
  })
  email: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Cloudflare Turnstile token from the form.',
  })
  turnstileToken: string
}

export class ResetPasswordInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Email address on the account.',
  })
  email: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'One time code from the reset email.',
  })
  otp: string

  @ApiProperty({ type: String, required: true, description: 'New password.' })
  newPassword: string
}

export class UpdateProfileInputDTO {
  @ApiProperty({ type: String, required: false, description: 'New full name.' })
  name: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'New phone number.',
  })
  phone: string
}

export class ChangePasswordInputDTO {
  @ApiProperty({ type: String, required: true, description: 'Current password.' })
  oldPassword: string

  @ApiProperty({ type: String, required: true, description: 'New password.' })
  newPassword: string
}

export class RenameApiKeyInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'New label for the key.',
    example: 'n8n production',
  })
  name: string
}

export class VerifyEmailInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description: 'Id of the account to verify.',
  })
  userId: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Code from the verification email.',
  })
  verificationCode: string
}

export class UpdateOnboardingDTO {
  @ApiProperty({
    type: String,
    required: false,
    description: 'Step the user is on now.',
  })
  currentStepId?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Step to skip. Only allowed for optional steps.',
  })
  skipStepId?: string

  @ApiProperty({
    type: Boolean,
    required: false,
    description: 'When true, marks onboarding finished.',
  })
  complete?: boolean
}

export class UserDTO {
  @ApiProperty({ type: String, description: 'Account id.' })
  _id: string

  @ApiProperty({ type: String, required: false, description: 'Full name.' })
  name?: string

  @ApiProperty({ type: String, description: 'Email address.' })
  email: string

  @ApiProperty({ type: String, required: false, description: 'Phone number.' })
  phone?: string

  @ApiProperty({
    type: String,
    required: false,
    description: 'Avatar URL, set when the account signed up with Google.',
  })
  avatar?: string

  @ApiProperty({ type: String, description: 'Account role.' })
  role: string

  @ApiProperty({
    type: Date,
    required: false,
    description:
      'When the email was verified. Sending is blocked until this is set.',
  })
  emailVerifiedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Last successful login.',
  })
  lastLoginAt?: Date

  @ApiProperty({ type: Date, description: 'When the account was created.' })
  createdAt: Date
}

export class AuthSessionDTO {
  @ApiProperty({
    type: String,
    description:
      'JWT for the dashboard, sent as an Authorization bearer token. API requests use an API key instead.',
  })
  accessToken: string

  @ApiProperty({ type: UserDTO, description: 'The signed in account.' })
  user: UserDTO

  @ApiProperty({
    type: Boolean,
    required: false,
    description:
      'True when this request created the account, as opposed to signing in to an existing one. Only returned by the Google endpoint.',
  })
  isNewUser?: boolean
}

export class AuthSessionResponseDTO {
  @ApiProperty({ type: AuthSessionDTO, description: 'Token and account.' })
  data: AuthSessionDTO
}

export class UserResponseDTO {
  @ApiProperty({ type: UserDTO, description: 'The account.' })
  data: UserDTO
}

export class MessageResponseDTO {
  @ApiProperty({
    type: String,
    description: 'What happened, in plain words.',
    example: 'Password reset successfully',
  })
  message: string
}

export class ApiKeyDTO {
  @ApiProperty({ type: String, description: 'Key id.' })
  _id: string

  @ApiProperty({
    type: String,
    description: 'Masked key. Only the first characters are stored.',
    example: '2a1b3c4d5e6f7g8h9******************',
  })
  apiKey: string

  @ApiProperty({ type: String, description: 'Label for the key.' })
  name: string

  @ApiProperty({ type: Number, description: 'Requests made with this key.' })
  usageCount: number

  @ApiProperty({
    type: Date,
    required: false,
    description: 'Last time the key was used.',
  })
  lastUsedAt?: Date

  @ApiProperty({
    type: Date,
    required: false,
    description: 'When the key was revoked. Absent while the key is active.',
  })
  revokedAt?: Date

  @ApiProperty({ type: Date, description: 'When the key was created.' })
  createdAt: Date
}

export class ApiKeyListResponseDTO {
  @ApiProperty({ type: [ApiKeyDTO], description: 'Your keys, masked.' })
  data: ApiKeyDTO[]
}

export class ApiKeyCreatedResponseDTO {
  @ApiProperty({
    type: String,
    description:
      'The full API key. This is the only time it is returned, so store it now.',
  })
  data: string

  @ApiProperty({
    type: String,
    description: 'Reminder that the key will not be shown again.',
  })
  message: string
}

export class CorrectEmailInputDTO {
  @ApiProperty({
    type: String,
    required: true,
    description:
      'The corrected email address. Spaces around it are removed and it is lowercased.',
    example: 'bob@gmail.com',
  })
  newEmail: string

  @ApiProperty({
    type: String,
    required: true,
    description: 'Current password of the account.',
  })
  currentPassword: string
}

export class CorrectEmailEligibilityDTO {
  @ApiProperty({
    type: Boolean,
    description: 'True when the account can change its email on this page.',
    example: false,
  })
  eligible: boolean

  @ApiProperty({
    type: String,
    required: false,
    enum: ['verified', 'has_activity', 'not_available'],
    description:
      'Why the account cannot change its email. Only set when eligible is false. verified: the email is already verified or the check is waived. has_activity: the account has devices, API keys, messages, webhooks or billing records, so support must make the change. not_available: any other reason.',
    example: 'has_activity',
  })
  reason?: 'verified' | 'has_activity' | 'not_available'
}

export class CorrectEmailResponseDTO {
  @ApiProperty({
    type: String,
    description: 'What happened, in plain words.',
    example: 'We sent a verification link to bob@gmail.com.',
  })
  message: string

  @ApiProperty({
    type: String,
    description: 'The email address now on the account.',
    example: 'bob@gmail.com',
  })
  email: string

  @ApiProperty({
    type: Boolean,
    description:
      'True when the verification link was sent to the new address. When false, the message says what to do next.',
    example: true,
  })
  sent: boolean
}
