import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { UsersService } from '../users/users.service'
import { UserRollupService } from '../users/user-rollup.service'
import { sanitizeAttribution } from '../users/attribution'
import { AnalyticsService } from '../analytics/analytics.service'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { createHash, randomInt } from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { InjectModel } from '@nestjs/mongoose'
import { ApiKey, ApiKeyDocument } from './schemas/api-key.schema'
import {
  ApiKeyTombstone,
  ApiKeyTombstoneDocument,
} from './schemas/api-key-tombstone.schema'
import { Model, Types } from 'mongoose'
import { User, UserDocument } from '../users/schemas/user.schema'
import axios from 'axios'
import {
  PasswordReset,
  PasswordResetDocument,
} from './schemas/password-reset.schema'
import { MailService } from '../mail/mail.service'
import { TurnstileService } from '../common/turnstile.service'
import { escapeRegExp } from '../common/escape-regexp'
import { RequestResetPasswordInputDTO, ResetPasswordInputDTO } from './auth.dto'
import { AccessFootprintService } from './access-footprint.service'
import {
  EmailVerification,
  EmailVerificationDocument,
} from './schemas/email-verification.schema'

// Failed OTP submissions allowed against a single password reset record.
const MAX_PASSWORD_RESET_ATTEMPTS = 5

export const API_KEY_PREFIX = 'txb_'
const API_KEY_BODY_LENGTH = 32
const API_KEY_BODY_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

// For register and login, which hold the hash in memory before responding.
export const withoutPassword = (user: UserDocument) => {
  const { password, ...safe } = user.toObject()
  return safe
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private readonly userRollup: UserRollupService,
    private jwtService: JwtService,
    @InjectModel(ApiKey.name) private apiKeyModel: Model<ApiKeyDocument>,
    @InjectModel(ApiKeyTombstone.name)
    private apiKeyTombstoneModel: Model<ApiKeyTombstoneDocument>,
    @InjectModel(PasswordReset.name)
    private passwordResetModel: Model<PasswordResetDocument>,
    private accessFootprintService: AccessFootprintService,
    @InjectModel(EmailVerification.name)
    private emailVerificationModel: Model<EmailVerificationDocument>,
    private readonly mailService: MailService,
    private readonly turnstileService: TurnstileService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async login(
    userData: any,
    requestContext?: { ip?: string; userAgent?: string; country?: string },
  ) {
    await this.turnstileService.verify(userData.turnstileToken)

    const user = await this.usersService.findOneWithPassword({
      email: userData.email,
    })
    if (!user) {
      throw new HttpException(
        { error: 'Invalid credentials' },
        HttpStatus.UNAUTHORIZED,
      )
    }

    if (!(await bcrypt.compare(userData.password, user.password))) {
      throw new HttpException(
        { error: 'Invalid credentials' },
        HttpStatus.UNAUTHORIZED,
      )
    }

    user.lastLoginAt = new Date()
    this.usersService.touchClient(user, requestContext?.userAgent)
    await user.save()

    const payload = { email: user.email, sub: user._id }
    return {
      accessToken: this.jwtService.sign(payload),
      user: withoutPassword(user),
    }
  }

  // tokeninfo only proves Google signed the token, not that it was issued for
  // this app, so the audience and the verified-email flag are checked here.
  private assertGoogleTokenIsForThisApp(tokenInfo: {
    aud?: string
    email_verified?: boolean | string
  }) {
    const allowedAudiences = (process.env.GOOGLE_CLIENT_ID ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    if (!allowedAudiences.length) {
      // Unset in this environment: log rather than reject, so a missing config
      // value cannot take Google sign-in down. Set GOOGLE_CLIENT_ID to enable.
      console.error(
        'loginWithGoogle: GOOGLE_CLIENT_ID is not set, skipping audience check',
      )
    } else if (!allowedAudiences.includes(tokenInfo.aud)) {
      throw new HttpException(
        { error: 'Unauthorized' },
        HttpStatus.UNAUTHORIZED,
      )
    }

    if (
      tokenInfo.email_verified !== true &&
      tokenInfo.email_verified !== 'true'
    ) {
      throw new HttpException(
        { error: 'Google account email is not verified' },
        HttpStatus.UNAUTHORIZED,
      )
    }
  }

  async loginWithGoogle(
    idToken: string,
    signupContext?: {
      attribution?: unknown
      ip?: string
      userAgent?: string
      country?: string
    },
  ) {
    const response = await axios.get(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(
        idToken,
      )}`,
    )

    this.assertGoogleTokenIsForThisApp(response.data)

    const { sub: googleId, name, email, picture } = response.data
    let user = await this.usersService.findOne({ email })

    // The same button serves sign-in and sign-up, so attribution is sent every
    // time and applied only when this call is what creates the account.
    const isNewUser = !user

    if (!user) {
      user = await this.usersService.create({
        name,
        email,
        attribution: sanitizeAttribution(signupContext?.attribution),
        userAgent: signupContext?.userAgent,
        country: signupContext?.country,
      })
    }

    if (user.googleId !== googleId) {
      user.googleId = googleId
    }

    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date()
    }

    if (user.name !== name) {
      user.name = name
    }

    if (user.avatar !== picture) {
      user.avatar = picture
    }

    user.lastLoginAt = new Date()
    if (!isNewUser) {
      this.usersService.touchClient(user, signupContext?.userAgent)
    }
    await user.save()

    if (isNewUser) {
      this.analyticsService.userRegistered(user as any, {
        ip: signupContext?.ip,
        userAgent: signupContext?.userAgent,
      })
    }

    const payload = { email: user.email, sub: user._id }
    return {
      accessToken: this.jwtService.sign(payload),
      user: withoutPassword(user),
      isNewUser,
    }
  }

  async register(
    userData: any,
    requestContext?: { ip?: string; userAgent?: string; country?: string },
  ) {
    await this.turnstileService.verify(userData.turnstileToken)

    const existingUser = await this.usersService.findOne({
      email: userData.email,
    })
    if (existingUser) {
      throw new HttpException(
        { error: 'User already exists, please login instead' },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.validateEmail(userData.email)
    await this.validatePassword(userData.password)

    const hashedPassword = await bcrypt.hash(userData.password, 10)
    // Named explicitly rather than spread: the request body is attacker
    // controlled and there is no global ValidationPipe, so spreading it would
    // let any field reach the document.
    const user = await this.usersService.create({
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      password: hashedPassword,
      marketingOptIn: userData.marketingOptIn === true,
      attribution: sanitizeAttribution(userData.attribution),
      userAgent: requestContext?.userAgent,
      country: requestContext?.country,
    })

    user.lastLoginAt = new Date()
    await user.save()

    this.analyticsService.userRegistered(user as any, requestContext)

    this.sendEmailVerificationEmail(user).catch((e) => {
      console.log('Failed to send email verification email')
      console.log(e)
    })

    const payload = { email: user.email, sub: user._id }

    return {
      accessToken: this.jwtService.sign(payload),
      user: withoutPassword(user),
    }
  }

  async requestResetPassword({
    email,
    turnstileToken,
  }: RequestResetPasswordInputDTO) {
    await this.turnstileService.verify(turnstileToken)

    // Both branches below return this, so the response says nothing about
    // whether the address is registered.
    const acceptedResponse = {
      message: 'If email is found you will receive a password reset email',
    }

    // Guards against a non-string reaching the query as a Mongo operator.
    if (typeof email !== 'string') {
      return acceptedResponse
    }

    const user = await this.usersService.findOne({ email })
    if (!user) {
      return acceptedResponse
    }

    // Check if user has requested password reset more than 5 times in the last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const resetCount = await this.passwordResetModel.countDocuments({
      user: user._id,
      createdAt: { $gte: twentyFourHoursAgo },
    })

    if (resetCount >= 5) {
      throw new HttpException(
        { error: 'Too many password reset requests. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const otp = randomInt(100000, 1000000).toString()
    const expiresAt = new Date(Date.now() + 20 * 60 * 1000)

    const hashedOtp = await bcrypt.hash(otp, 10)
    const passwordReset = new this.passwordResetModel({
      user: user._id,
      otp: hashedOtp,
      expiresAt,
    })
    await passwordReset.save()

    const resetUrl = `${process.env.FRONTEND_URL || 'https://textbee.dev'}/reset-password?email=${encodeURIComponent(user.email)}&otp=${otp}`

    await this.mailService.sendTemplated({
      key: 'T2',
      userId: user._id,
      to: user.email,
      vars: { resetUrl, otp, linkTtl: '20 minutes' },
      redactVars: ['resetUrl', 'otp'],
    })

    return acceptedResponse
  }

  async resetPassword({ email, otp, newPassword }: ResetPasswordInputDTO) {
    // Matches the other failure paths below so an unknown address is not
    // distinguishable from a bad code.
    const invalidOtp = new HttpException(
      { error: 'Invalid OTP' },
      HttpStatus.BAD_REQUEST,
    )

    if (typeof email !== 'string') {
      throw invalidOtp
    }

    const user = await this.usersService.findOne({ email })
    if (!user) {
      throw invalidOtp
    }
    const latestReset = await this.passwordResetModel.findOne(
      {
        user: user._id,
        expiresAt: { $gt: new Date() },
      },
      null,
      { sort: { createdAt: -1 } },
    )

    if (!latestReset) {
      throw new HttpException({ error: 'Invalid OTP' }, HttpStatus.BAD_REQUEST)
    }

    // Claim an attempt atomically so concurrent guesses cannot all read the
    // same count and slip past the cap. A null result means the record is
    // already locked out and a fresh reset request is required.
    const passwordReset = await this.passwordResetModel.findOneAndUpdate(
      {
        _id: latestReset._id,
        // Records predating this counter have no attempts field at all.
        $or: [
          { attempts: { $lt: MAX_PASSWORD_RESET_ATTEMPTS } },
          { attempts: { $exists: false } },
        ],
      },
      { $inc: { attempts: 1 } },
      { new: true },
    )

    if (!passwordReset || !(await bcrypt.compare(otp, passwordReset.otp))) {
      throw new HttpException({ error: 'Invalid OTP' }, HttpStatus.BAD_REQUEST)
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    user.password = hashedPassword
    await user.save()

    passwordReset.expiresAt = new Date(Date.now())
    await passwordReset.save()

    this.mailService
      .sendTemplated({ key: 'T3', userId: user._id, to: user.email })
      .catch((e) => {
        console.log('Failed to send password changed email', e?.message)
      })

    return { message: 'Password reset successfully' }
  }

  async updateProfile(
    input: { name: string; phone: string },
    user: UserDocument,
  ) {
    return this.usersService.updateProfile(input, user)
  }

  async changePassword(
    input: { oldPassword: string; newPassword: string },
    user: UserDocument,
  ) {
    const userToUpdate = await this.usersService.findOneWithPassword({
      _id: user._id,
    })
    if (!userToUpdate) {
      throw new HttpException({ error: 'User not found' }, HttpStatus.NOT_FOUND)
    }
    if (!(await bcrypt.compare(input.oldPassword, userToUpdate.password))) {
      throw new HttpException(
        { error: 'Invalid old password' },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.validatePassword(input.newPassword)

    const hashedPassword = await bcrypt.hash(input.newPassword, 10)
    userToUpdate.password = hashedPassword
    await userToUpdate.save()
  }

  async sendEmailVerificationEmail(user: UserDocument) {
    // Reminder links do not count toward the resend cap.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const verificationCount = await this.emailVerificationModel.countDocuments({
      user: user._id,
      createdAt: { $gte: twentyFourHoursAgo },
      source: { $ne: 'reminder' },
    })

    if (verificationCount >= 5) {
      throw new HttpException(
        {
          error:
            'Too many email verification requests. Please try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const verificationUrl = await this.mintEmailVerificationLink(user)

    await this.mailService.sendTemplated({
      key: 'T1',
      userId: user._id,
      to: user.email,
      vars: { verificationUrl, linkTtl: '20 minutes' },
      redactVars: ['verificationUrl'],
    })

    return { message: 'Email verification email sent' }
  }

  /** Stores a new hashed verification code and returns its link. */
  async mintEmailVerificationLink(
    user: Pick<UserDocument, '_id'>,
    {
      lifetimeMs = 20 * 60 * 1000,
      source,
    }: { lifetimeMs?: number; source?: 'reminder' } = {},
  ): Promise<string> {
    const verificationCode = uuidv4()
    const hashedVerificationCode = await bcrypt.hash(verificationCode, 10)

    await new this.emailVerificationModel({
      user: user._id,
      verificationCode: hashedVerificationCode,
      expiresAt: new Date(Date.now() + lifetimeMs),
      ...(source && { source }),
    }).save()

    return `${process.env.FRONTEND_URL || 'https://textbee.dev'}/verify-email?userId=${user._id}&verificationCode=${verificationCode}`
  }

  async verifyEmail({ userId, verificationCode }) {
    const user: UserDocument = await this.usersService.findOne({ _id: userId })
    if (!user) {
      throw new HttpException({ error: 'User not found' }, HttpStatus.NOT_FOUND)
    }
    const emailVerification = await this.emailVerificationModel.findOne(
      {
        user: user._id,
        expiresAt: { $gt: new Date() },
      },
      null,
      { sort: { createdAt: -1 } },
    )
    if (
      !emailVerification ||
      !bcrypt.compareSync(verificationCode, emailVerification.verificationCode)
    ) {
      throw new HttpException(
        { error: 'Invalid verification code' },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (user.emailVerifiedAt) {
      return { message: 'Email already verified' }
    }

    user.emailVerifiedAt = new Date()
    await user.save()

    return { message: 'Email verified successfully' }
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex')
  }

  private generateApiKeyString(): string {
    let body = ''
    for (let i = 0; i < API_KEY_BODY_LENGTH; i++) {
      body += API_KEY_BODY_ALPHABET[randomInt(API_KEY_BODY_ALPHABET.length)]
    }
    return `${API_KEY_PREFIX}${body}`
  }

  async generateApiKey(currentUser: User) {
    const apiKey = this.generateApiKeyString()
    const hashedApiKey = await bcrypt.hash(apiKey, 10)

    const newApiKey = new this.apiKeyModel({
      apiKey: apiKey.substr(0, 17) + '*'.repeat(18),
      hashedApiKey,
      hashedApiKeySha256: this.sha256(apiKey),
      user: currentUser._id,
    })

    await newApiKey.save()

    // Activation milestone. Fire and forget: a reporting write must not fail
    // the call that just handed the caller a key they cannot see again.
    this.usersService
      .markMilestone(currentUser._id, 'firstApiKeyAt')
      .catch(() => undefined)

    this.userRollup.refreshQuietly(currentUser._id)

    return { apiKey, message: 'Save this key, it wont be shown again ;)' }
  }

  /**
   * Resolves a presented key to its active ApiKey document, or null.
   * Fast path is a single indexed sha256 lookup. Keys issued before the
   * migration fall back to bcrypt once, then backfill themselves.
   */
  async verifyApiKey(apiKeyString: string): Promise<ApiKeyDocument | null> {
    if (!apiKeyString || typeof apiKeyString !== 'string') {
      return null
    }

    const hashedApiKeySha256 = this.sha256(apiKeyString)
    const byHash = await this.apiKeyModel.findOne({ hashedApiKeySha256 })
    if (byHash) {
      // A hash match identifies the key outright, so a revoked hit is final.
      return byHash.revokedAt ? null : byHash
    }

    const legacyApiKey = await this.findActiveApiKeyByClientKey(apiKeyString)
    if (
      !legacyApiKey?.hashedApiKey ||
      legacyApiKey.revokedAt ||
      !(await bcrypt.compare(apiKeyString, legacyApiKey.hashedApiKey))
    ) {
      return null
    }

    this.apiKeyModel
      .updateOne({ _id: legacyApiKey._id }, { $set: { hashedApiKeySha256 } })
      .exec()
      .catch((e) => {
        console.log('Failed to backfill api key sha256 hash')
        console.log(e)
      })

    return legacyApiKey
  }

  async getUserApiKeys(currentUser: User, statusParam?: string) {
    const normalized =
      statusParam === undefined || statusParam === '' ? 'active' : statusParam
    if (!['active', 'revoked', 'all'].includes(normalized)) {
      throw new HttpException(
        { error: 'Invalid status. Use active, revoked, or all.' },
        HttpStatus.BAD_REQUEST,
      )
    }
    const status = normalized as 'active' | 'revoked' | 'all'

    const base = { user: currentUser._id }
    let filter: Record<string, unknown> = { ...base }

    if (status === 'active') {
      filter = {
        ...base,
        $or: [{ revokedAt: { $exists: false } }, { revokedAt: null }],
      }
    } else if (status === 'revoked') {
      filter = {
        ...base,
        revokedAt: { $exists: true, $ne: null },
      }
    }

    // Never ship credential digests to the client.
    return this.apiKeyModel.find(filter, '-hashedApiKey -hashedApiKeySha256', {
      sort: { createdAt: -1 },
    })
  }

  async findApiKey(params) {
    return this.apiKeyModel.findOne(params)
  }

  /** Prefer exact masked match (see generateApiKey); fall back to legacy prefix regex. */
  async findActiveApiKeyByClientKey(apiKeyString: string) {
    const revokedClause = {
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
    }
    const prefix = apiKeyString.substring(0, 17)
    const masked = `${prefix}${'*'.repeat(18)}`
    const byMasked = await this.apiKeyModel.findOne({
      apiKey: masked,
      ...revokedClause,
    })
    if (byMasked) {
      return byMasked
    }
    const regex = new RegExp(`^${escapeRegExp(prefix)}`, 'g')
    return this.apiKeyModel.findOne({
      apiKey: { $regex: regex },
      ...revokedClause,
    })
  }

  async findApiKeyById(apiKeyId: string) {
    return this.apiKeyModel.findById(apiKeyId)
  }

  async deleteApiKey(apiKeyId: string) {
    // Cast first: the id comes from the route, so it reaches the query as an
    // ObjectId or not at all.
    const id = Types.ObjectId.isValid(apiKeyId)
      ? new Types.ObjectId(apiKeyId)
      : null
    const apiKey = id ? await this.apiKeyModel.findOne({ _id: id }).lean() : null
    if (!apiKey) {
      throw new HttpException(
        {
          error: 'Api key not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }
    if (!apiKey.revokedAt) {
      throw new HttpException(
        { error: 'Revoke this API key before you can delete it' },
        HttpStatus.BAD_REQUEST,
      )
    }

    const written = await this.apiKeyTombstoneModel.updateOne(
      { apiKeyId: id },
      {
        $setOnInsert: {
          apiKeyId: id,
          userId: apiKey.user,
          deletedAt: new Date(),
          apiKey,
        },
      },
      { upsert: true },
    )

    try {
      await this.apiKeyModel.deleteOne({ _id: id })
    } catch (error) {
      // The record must not outlive a delete that did not happen, or the key
      // reads as gone while it still exists. Only a record this call created
      // is taken back, and only while the key is still there: an error raised
      // after the delete landed leaves the record alone, since that is the
      // only copy of the key left.
      if (written.upsertedCount && (await this.apiKeyModel.exists({ _id: id }))) {
        await this.apiKeyTombstoneModel.deleteOne({ apiKeyId: id })
      }
      throw error
    }
  }

  async revokeApiKey(apiKeyId: string) {
    const apiKey = await this.apiKeyModel.findById(apiKeyId)
    if (!apiKey) {
      throw new HttpException(
        { error: 'Api key not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    apiKey.revokedAt = new Date()
    await apiKey.save()

    // Only revoking changes the live key count. Deleting one requires it to be
    // revoked already, so that path cannot move the number.
    this.userRollup.refreshQuietly(apiKey.user as any)
  }

  async renameApiKey(apiKeyId: string, name: string) {
    const apiKey = await this.apiKeyModel.findById(apiKeyId)
    if (!apiKey) {
      throw new HttpException(
        { error: 'Api key not found' },
        HttpStatus.NOT_FOUND,
      )
    }
    apiKey.name = name
    await apiKey.save()
  }

  /**
   * Runs on every authenticated request from the guards, never awaited.
   *
   * Two things are recorded: how much a key is used, and the distinct origins
   * the account is reached from. Neither may fail a request.
   */
  async trackAccessLog({ request }) {
    const { apiKey } = request

    if (apiKey) {
      this.apiKeyModel
        .findByIdAndUpdate(
          apiKey._id,
          { $inc: { usageCount: 1 }, lastUsedAt: new Date() },
          { new: true },
        )
        .exec()
        .catch((e) => {
          console.log('Failed to update api key usage count')
          console.log(e)
        })
    }

    this.accessFootprintService.record({ request })
  }

  async validateEmail(email: string) {
    // Anchored, with character classes that cannot overlap, and bounded by the
    // RFC length limit. The previous pattern was unanchored \S+@\S+\.\S+,
    // whose repeated \S+ groups backtrack polynomially on a long run of
    // non-space characters. Registration is unauthenticated and accepts a large
    // body, so that was reachable by anyone.
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const candidate = typeof email === 'string' ? email.trim() : ''

    if (candidate.length > 254 || !re.test(candidate)) {
      throw new HttpException(
        { error: 'Invalid email' },
        HttpStatus.BAD_REQUEST,
      )
    }
  }
  async validatePassword(password: string) {
    if (password.length < 6 || password.length > 128) {
      throw new HttpException(
        { error: 'Password must be between 6 and 128 characters' },
        HttpStatus.BAD_REQUEST,
      )
    }
  }
}
