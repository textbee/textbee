import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler'
import { Model, Types } from 'mongoose'
import { AuthService } from '../auth/auth.service'
import {
  ApiKey,
  ApiKeyDocument,
  DEVICE_LINK_KEY_SOURCE,
} from '../auth/schemas/api-key.schema'
import { BillingService } from '../billing/billing.service'
import { canonicalAddress, resolveClientAddress } from '../common/client-address'
import { resolveSetting } from '../gateway/app-settings'
import { normalizeOsFields } from '../gateway/os-version'
import { deviceVersionCode } from '../gateway/push-ownership'
import { Device, DeviceDocument } from '../gateway/schemas/device.schema'
import { appPublicUrl } from '../mail/email-links'
import { MailService } from '../mail/mail.service'
import { UserRollupService } from '../users/user-rollup.service'
import { UsersService } from '../users/users.service'
import {
  ChoiceDevice,
  Choices,
  checkChoice,
  m2Text,
  networkFacts,
  placeLabel,
  sameNetwork,
  strongSameNetwork,
  buildChoices,
} from './device-link-choices'
import {
  displayCode,
  maskEmail,
  newCode,
  newPollToken,
  normalizeCode,
  parseApproveBody,
  parseCreateBody,
  parseLinkHeaders,
  parsePollToken,
  parseTesters,
  linkHashSecret,
  serverHash,
  sha256,
} from './device-link-input'
import { DeviceLink, DeviceLinkDocument } from './schemas/device-link.schema'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export const APPROVE_WINDOW_MS = 10 * MINUTE_MS
export const COLLECT_WINDOW_MS = 30 * MINUTE_MS
export const DELIVERING_STALE_MS = 30 * 1000
export const REPEAT_WINDOW_MS = 2 * MINUTE_MS
export const MAX_REPEATS = 3
export const POLL_MIN_GAP_MS = 1500
export const POLL_INTERVAL_SECONDS = 3
export const MAX_PENDING = 3000
export const CREATE_LIMIT_PER_HOUR = 60
// Per user and hour: calls that name a code, and wrong codes among them
export const CODE_ATTEMPTS_PER_HOUR = 120
export const WRONG_CODES_PER_HOUR = 20
// Users the wrong-code count keeps at most; the oldest entries go first
const WRONG_CODE_USERS_MAX = 10_000
const CODE_TRIES = 5
const NEVER_APPROVED_KEEP_MS = DAY_MS
const KEEP_MS = 30 * DAY_MS
// The first app build with sign-in
export const SIGN_IN_MIN_VERSION_CODE = 23
const RECENT_DEVICE_MS = 30 * DAY_MS
const THROTTLER_NAME = 'device-link'
export const EMAIL_TEMPLATE_KEY = 'T4'

export const ERRORS = {
  invalidPhone: 'Invalid phone details.',
  tooManyRequests: 'Too many sign-in requests. Try again later.',
  off: 'Sign-in is not available right now. Use an API key instead.',
  pollNotFound: 'This sign-in request was not found. Start again.',
  codeNotFound: 'This code is not valid or has expired. Start again in the app.',
  choice: 'This choice is not available. Reload the page.',
  codeMismatch: 'The code does not match the code on the phone.',
  cannotConnect: 'This account cannot connect a phone. Contact support.',
  tooManyCodes: 'Too many wrong codes. Try again later.',
}

export const POLL_TEXTS = {
  denied: 'The request was cancelled.',
  limit: 'Your plan has no room for another active device. Start again and choose a device for this phone to replace.',
  expired: 'The code expired. Tap "Sign in with textbee" to try again.',
}

const APPROVED_STATES = ['approved', 'delivering', 'delivered', 'completed']

type AccountUser = {
  _id: Types.ObjectId
  email?: string
  emailVerifiedAt?: Date
  isBanned?: boolean
  accountDeletionRequestedAt?: Date
}

type RequestLike = {
  ip?: string
  headers?: Record<string, any>
}

type PollAnswer = Record<string, unknown> & { status: string }

const fail = (status: HttpStatus, body: Record<string, string>) =>
  new HttpException(body, status)

const isDuplicateCode = (error: any) =>
  error?.code === 11000 && !!(error?.keyPattern?.code ?? /code_1/.test(String(error?.message)))

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

@Injectable()
export class DeviceLinksService {
  private readonly logger = new Logger(DeviceLinksService.name)
  // Wrong codes per user in the current hour, in this process
  private readonly wrongCodes = new Map<string, { count: number; resetAt: number }>()

  constructor(
    @InjectModel(DeviceLink.name)
    private readonly deviceLinkModel: Model<DeviceLinkDocument>,
    @InjectModel(Device.name) private readonly deviceModel: Model<DeviceDocument>,
    @InjectModel(ApiKey.name) private readonly apiKeyModel: Model<ApiKeyDocument>,
    @InjectThrottlerStorage() private readonly throttlerStorage: ThrottlerStorage,
    private readonly authService: AuthService,
    private readonly billingService: BillingService,
    private readonly usersService: UsersService,
    private readonly userRollup: UserRollupService,
    private readonly mailService: MailService,
  ) {}

  // On for the whole platform, or for the accounts in the tester list.
  // Never on without a secret for the server hashes.
  private signInOnFor(userId: Types.ObjectId | string): boolean {
    if (!linkHashSecret()) return false
    if (resolveSetting('deviceLinksEnabled') === true) return true
    return parseTesters(resolveSetting('deviceLinksTesters')).has(String(userId).toLowerCase())
  }

  private assertOn(user: AccountUser): void {
    if (!this.signInOnFor(user._id)) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' })
    }
  }

  async create(body: unknown, req: RequestLike) {
    const testers = parseTesters(resolveSetting('deviceLinksTesters'))
    if (
      !linkHashSecret() ||
      (resolveSetting('deviceLinksEnabled') !== true && testers.size === 0)
    ) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' })
    }

    const address = resolveClientAddress(req)
    await this.limitCreate(address.ip ?? req.ip)

    const input = parseCreateBody(body)
    if (!input) throw fail(HttpStatus.BAD_REQUEST, { error: ERRORS.invalidPhone })
    if (input.appVersionCode < (resolveSetting('deviceLinksMinVersionCode') as number)) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' })
    }

    const now = new Date()
    const pending = await this.deviceLinkModel.countDocuments({
      status: 'pending',
      expiresAt: { $gt: now },
    })
    if (pending > MAX_PENDING) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: ERRORS.off, code: 'DEVICE_LINKS_BUSY' })
    }

    const headers = parseLinkHeaders(req.headers)
    const pollToken = newPollToken()
    const expiresAt = new Date(now.getTime() + APPROVE_WINDOW_MS)
    const { deviceId, ...facts } = input
    const record: Partial<DeviceLink> = {
      ...facts,
      pollTokenHash: sha256(pollToken),
      status: 'pending',
      ...(deviceId && { requestDeviceId: new Types.ObjectId(deviceId) }),
      ...(headers.installId && { installId: headers.installId }),
      ...(headers.phoneId && { phoneId: serverHash('phone', headers.phoneId) }),
      ...(headers.phoneSigner && { phoneSigner: headers.phoneSigner }),
      ...networkFacts(address.ip, address.asn, address.country),
      repeatCount: 0,
      expiresAt,
      deleteAt: new Date(expiresAt.getTime() + NEVER_APPROVED_KEEP_MS),
    }

    let code: string | undefined
    for (let attempt = 0; attempt < CODE_TRIES && !code; attempt++) {
      const candidate = newCode()
      try {
        // The schema's `model` field collides with Mongoose's own typing; the cast is types only
        await this.deviceLinkModel.create({ ...record, code: candidate } as any)
        code = candidate
      } catch (error) {
        if (!isDuplicateCode(error)) throw error
      }
    }
    if (!code) {
      throw fail(HttpStatus.SERVICE_UNAVAILABLE, { error: ERRORS.off, code: 'DEVICE_LINKS_BUSY' })
    }

    const base = appPublicUrl()
    return {
      displayCode: displayCode(code),
      linkUrl: `${base}/link-device?code=${displayCode(code)}`,
      manualUrl: `${base.replace(/^https?:\/\//, '')}/link-device`,
      pollToken,
      expiresAt: expiresAt.toISOString(),
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      autoOpenBrowser: resolveSetting('deviceLinksAutoOpenBrowser') === true,
    }
  }

  // 60 a hour per address; IPv6 counts by its first 48 bits
  private async limitCreate(ip: string | undefined): Promise<void> {
    const network = canonicalAddress(ip)
    const bucket = network?.includes(':')
      ? `${network.split(':').slice(0, 3).join(':')}::/48`
      : (network ?? 'unknown')
    const { isBlocked } = await this.throttlerStorage.increment(
      `device-link-create:${bucket}`,
      HOUR_MS,
      CREATE_LIMIT_PER_HOUR,
      0,
      THROTTLER_NAME,
    )
    if (isBlocked) {
      throw fail(HttpStatus.TOO_MANY_REQUESTS, { error: ERRORS.tooManyRequests })
    }
  }

  async poll(body: unknown): Promise<PollAnswer> {
    const token = parsePollToken(body)
    const link = token
      ? await this.deviceLinkModel.findOne({ pollTokenHash: sha256(token) }).lean()
      : null
    if (!link) throw fail(HttpStatus.NOT_FOUND, { error: ERRORS.pollNotFound })

    const now = new Date()
    const paced = await this.deviceLinkModel.updateOne(
      {
        _id: link._id,
        $or: [
          { lastPolledAt: { $exists: false } },
          { lastPolledAt: null },
          { lastPolledAt: { $lte: new Date(now.getTime() - POLL_MIN_GAP_MS) } },
        ],
      },
      { $set: { lastPolledAt: now } },
    )
    // Too soon after the last poll: no step runs, the phone just asks again
    if (paced.matchedCount === 0) return this.pendingAnswer()

    switch (link.status) {
      case 'pending':
        if (link.expiresAt.getTime() > now.getTime()) return this.pendingAnswer()
        await this.deviceLinkModel.updateOne(
          { _id: link._id, status: 'pending' },
          { $set: { status: 'expired' } },
        )
        return this.expired()
      case 'denied':
        return this.deniedAnswer(link)
      case 'approved':
        if (now.getTime() - link.approvedAt.getTime() > COLLECT_WINDOW_MS) return this.expired()
        return this.deliver(link, now)
      case 'delivering':
        if (now.getTime() - link.approvedAt.getTime() > COLLECT_WINDOW_MS) return this.expired()
        if (now.getTime() - link.deliveringAt.getTime() < DELIVERING_STALE_MS) {
          return this.pendingAnswer()
        }
        return this.deliver(link, now)
      case 'delivered':
        if (
          !link.completedAt &&
          now.getTime() - link.deliveredAt.getTime() <= REPEAT_WINDOW_MS &&
          (link.repeatCount ?? 0) < MAX_REPEATS
        ) {
          return this.repeat(link)
        }
        return this.expired()
      default:
        return this.expired()
    }
  }

  private expired(): PollAnswer {
    return { status: 'expired', message: POLL_TEXTS.expired }
  }

  private async deniedAnswer(link: DeviceLink): Promise<PollAnswer> {
    if (link.deniedReason === 'account') {
      return { status: 'denied', message: ERRORS.cannotConnect }
    }
    if (link.deniedReason === 'device-limit') {
      const limit = link.user ? await this.deviceLimit(link.user) : null
      return { status: 'denied', message: limit !== null ? m2Text(limit) : POLL_TEXTS.limit }
    }
    return { status: 'denied', message: POLL_TEXTS.denied }
  }

  private pendingAnswer(): PollAnswer {
    return { status: 'pending', pollIntervalSeconds: POLL_INTERVAL_SECONDS }
  }

  // The first poll to claim an approved request makes the device and the key
  private async deliver(link: DeviceLink, now: Date): Promise<PollAnswer> {
    const claimed = await this.deviceLinkModel
      .findOneAndUpdate(
        {
          _id: link._id,
          $or: [
            {
              status: 'approved',
              approvedAt: { $gte: new Date(now.getTime() - COLLECT_WINDOW_MS) },
            },
            {
              status: 'delivering',
              approvedAt: { $gte: new Date(now.getTime() - COLLECT_WINDOW_MS) },
              deliveringAt: { $lte: new Date(now.getTime() - DELIVERING_STALE_MS) },
            },
          ],
        },
        { $set: { status: 'delivering', deliveringAt: now } },
        { returnDocument: 'after' },
      )
      .lean()
    if (!claimed) return this.pendingAnswer()
    try {
      return await this.runDelivery(claimed, now)
    } catch (error) {
      // The request stays delivering; a poll after DELIVERING_STALE_MS repeats the steps
      this.logger.error(`device link delivery failed: ${error?.message ?? error}`)
      return this.pendingAnswer()
    }
  }

  private async runDelivery(link: DeviceLink, now: Date): Promise<PollAnswer> {
    const mine = { _id: link._id, status: 'delivering' as const, deliveringAt: link.deliveringAt }
    const user = (await this.usersService.findOne({ _id: link.user })) as AccountUser | null
    if (!user) {
      await this.deviceLinkModel.updateOne(mine, { $set: { status: 'denied' } })
      return { status: 'denied', message: POLL_TEXTS.denied }
    }
    if (user.isBanned || user.accountDeletionRequestedAt) {
      await this.deviceLinkModel.updateOne(mine, {
        $set: { status: 'denied', deniedReason: 'account' },
      })
      return { status: 'denied', message: ERRORS.cannotConnect }
    }

    let deviceId = link.deviceId
    let deviceName: string
    let replaced: string | undefined
    if (link.action === 'new') {
      if (!deviceId) {
        const limit = await this.deviceLimit(user._id)
        if (limit !== null) {
          const active = await this.deviceModel.countDocuments({ user: user._id, enabled: true })
          if (active >= limit) {
            await this.deviceLinkModel.updateOne(mine, {
              $set: { status: 'denied', deniedReason: 'device-limit' },
            })
            return { status: 'denied', message: m2Text(limit) }
          }
        }
        deviceId = new Types.ObjectId()
        const saved = await this.deviceLinkModel.updateOne(
          { ...mine, deviceId: { $exists: false } },
          { $set: { deviceId } },
        )
        if (saved.matchedCount === 0) return this.pendingAnswer()
      }
      deviceName = link.chosenName
      await this.ensureDevice(deviceId, user, link)
    } else {
      deviceId = link.chosenDeviceId
      const device = await this.deviceModel
        .findOne({ _id: deviceId, user: user._id }, 'name brand model')
        .lean()
      if (!device) {
        // The device was deleted after approval
        await this.deviceLinkModel.updateOne(mine, { $set: { status: 'denied' } })
        return { status: 'denied', message: POLL_TEXTS.denied }
      }
      deviceName = device.name || `${device.brand ?? ''} ${device.model ?? ''}`.trim()
      replaced = deviceName
    }

    const keyName = `Phone sign-in: ${deviceName}`
    const key = await this.authService.createSignInKey(user._id, deviceId, keyName, link._id)
    const done = await this.deviceLinkModel.updateOne(mine, {
      $set: { status: 'delivered', apiKeyId: key.id, deviceId, deliveredAt: now },
    })
    if (done.matchedCount === 0) {
      // Another poll took the delivery over; this key is never handed out
      await this.authService.revokeApiKeyIfLive(key.id)
      return this.pendingAnswer()
    }
    // A key left by a stopped delivery was never handed out
    await this.authService.revokeOtherLinkKeys(link._id, key.id)

    this.sendEmail(user, link, deviceName, keyName, replaced, now).catch((error) =>
      this.logger.error(`device link email failed: ${error?.message ?? error}`),
    )
    return this.approvedAnswer(link, key.apiKey, deviceId, deviceName, user.email)
  }

  private approvedAnswer(
    link: DeviceLink,
    apiKey: string,
    deviceId: Types.ObjectId,
    deviceName: string,
    email: string | undefined,
  ): PollAnswer {
    return {
      status: 'approved',
      apiKey,
      deviceId: deviceId.toString(),
      deviceName,
      accountEmail: maskEmail(email),
      reconnected: link.action === 'reconnect',
      enable: link.mode !== 'reconnect-only',
    }
  }

  // Creates the device with the saved id, or leaves the existing one alone.
  // Only the first device of an account becomes its default.
  private async ensureDevice(deviceId: Types.ObjectId, user: AccountUser, link: DeviceLink) {
    const existing = await this.deviceModel
      .find({ user: user._id, _id: { $ne: deviceId } }, 'enabled isDefault lastHeartbeat')
      .lean()
    if (existing.length > 0 && !existing.some((device) => device.isDefault)) {
      // Without a default, sends follow the newest heartbeat, which the new
      // device could win. Pin the device that sends today.
      const current = [...existing].sort(
        (a, b) =>
          Number(b.enabled === true) - Number(a.enabled === true) ||
          (b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0) -
            (a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0) ||
          String(b._id).localeCompare(String(a._id)),
      )[0]
      await this.deviceModel.updateOne({ _id: current._id }, { $set: { isDefault: true } })
    }
    const fields: Record<string, unknown> = {
      user: user._id,
      enabled: true,
      isDefault: existing.length === 0,
      name: link.chosenName,
      brand: link.brand,
      model: link.model,
      appVersionCode: link.appVersionCode,
      ...(link.manufacturer && { manufacturer: link.manufacturer }),
      ...(link.appVersionName && { appVersionName: link.appVersionName }),
      ...normalizeOsFields({ osApiLevel: link.osApiLevel }),
    }
    const result = await this.deviceModel.updateOne(
      { _id: deviceId },
      { $setOnInsert: fields },
      { upsert: true },
    )
    if (result.upsertedCount) {
      this.usersService.markMilestone(user._id, 'firstDeviceAt').catch(() => undefined)
      this.userRollup.refreshQuietly(user._id)
    }
  }

  // A lost answer is repaired with a fresh key for the same device, a few times
  private async repeat(link: DeviceLink): Promise<PollAnswer> {
    const claimed = await this.deviceLinkModel
      .findOneAndUpdate(
        { _id: link._id, status: 'delivered', repeatCount: link.repeatCount ?? 0 },
        { $inc: { repeatCount: 1 } },
        { returnDocument: 'after' },
      )
      .lean()
    if (!claimed) return this.pendingAnswer()
    if (claimed.apiKeyId) await this.authService.revokeApiKeyIfLive(claimed.apiKeyId)

    const [user, device] = await Promise.all([
      this.usersService.findOne({ _id: claimed.user }) as Promise<AccountUser | null>,
      this.deviceModel.findOne({ _id: claimed.deviceId, user: claimed.user }, 'name').lean(),
    ])
    if (!user || !device) return this.expired()
    if (user.isBanned || user.accountDeletionRequestedAt) {
      return { status: 'denied', message: ERRORS.cannotConnect }
    }

    const deviceName = device.name || claimed.chosenName || ''
    const key = await this.authService.createSignInKey(
      user._id,
      claimed.deviceId,
      `Phone sign-in: ${deviceName}`,
      claimed._id,
    )
    const saved = await this.deviceLinkModel.updateOne(
      { _id: claimed._id, status: 'delivered', repeatCount: claimed.repeatCount },
      { $set: { apiKeyId: key.id } },
    )
    if (saved.matchedCount === 0) {
      await this.authService.revokeApiKeyIfLive(key.id)
      return this.pendingAnswer()
    }
    await this.authService.revokeOtherLinkKeys(claimed._id, key.id)
    return this.approvedAnswer(claimed, key.apiKey, claimed.deviceId, deviceName, user.email)
  }

  private async sendEmail(
    user: AccountUser,
    link: DeviceLink,
    deviceName: string,
    keyName: string,
    replaced: string | undefined,
    now: Date,
  ) {
    const base = appPublicUrl()
    await this.mailService.sendTemplated({
      key: EMAIL_TEMPLATE_KEY,
      userId: user._id,
      vars: {
        deviceName,
        connectedAt: `${dateTimeFormat.format(now)} UTC`,
        requestedFrom: placeLabel(link.country),
        action: replaced ? `took the place of ${replaced}` : 'added as a new device',
        keyName,
        apiKeysUrl: `${base}/dashboard`,
        changePasswordUrl: `${base}/dashboard/account/change-password`,
      },
      meta: { deviceLinkId: String(link._id) },
    })
  }

  // The plan's device limit, or null for no limit. A failed lookup means no limit, as elsewhere.
  private async deviceLimit(userId: Types.ObjectId): Promise<number | null> {
    try {
      const limits = await this.billingService.getUserLimits(String(userId))
      const limit = limits?.deviceLimit
      return typeof limit === 'number' && limit >= 0 ? limit : null
    } catch (error) {
      this.logger.error(`device link limit lookup failed: ${error?.message ?? error}`)
      return null
    }
  }

  // Each lookup, approve and deny counts before the code is read, in one
  // increment, so a parallel burst cannot pass the cap. A user who reached
  // the wrong-code limit is refused before the code is read as well.
  private async countCodeAttempt(user: AccountUser): Promise<void> {
    const { isBlocked } = await this.throttlerStorage.increment(
      `device-link-code-attempt:${String(user._id)}`,
      HOUR_MS,
      CODE_ATTEMPTS_PER_HOUR,
      0,
      THROTTLER_NAME,
    )
    if (isBlocked || this.wrongCodeCount(user, Date.now()) >= WRONG_CODES_PER_HOUR) {
      throw fail(HttpStatus.TOO_MANY_REQUESTS, { error: ERRORS.tooManyCodes })
    }
  }

  private wrongCodeCount(user: AccountUser, now: number): number {
    const entry = this.wrongCodes.get(String(user._id))
    return entry && entry.resetAt > now ? entry.count : 0
  }

  // Counts the wrong code as soon as it is known and answers the 404
  private wrongCode(user: AccountUser): HttpException {
    const now = Date.now()
    const key = String(user._id)
    const entry = this.wrongCodes.get(key)
    if (entry && entry.resetAt > now) {
      entry.count += 1
    } else {
      this.wrongCodes.delete(key)
      this.wrongCodes.set(key, { count: 1, resetAt: now + HOUR_MS })
    }
    if (this.wrongCodes.size > WRONG_CODE_USERS_MAX) {
      for (const [other, value] of this.wrongCodes) {
        if (value.resetAt <= now) this.wrongCodes.delete(other)
      }
      for (const other of this.wrongCodes.keys()) {
        if (this.wrongCodes.size <= WRONG_CODE_USERS_MAX) break
        this.wrongCodes.delete(other)
      }
    }
    return fail(HttpStatus.NOT_FOUND, { error: ERRORS.codeNotFound })
  }

  private isMine(link: DeviceLink, user: AccountUser): boolean {
    return !!link.user && String(link.user) === String(user._id)
  }

  // The request a code names, as this user may see it, or a 404
  private async findForUser(
    user: AccountUser,
    rawCode: unknown,
    now: Date,
  ): Promise<{ link: DeviceLink; view: 'pending' | 'approved' | 'denied' }> {
    const code = normalizeCode(rawCode)
    const link = code ? await this.deviceLinkModel.findOne({ code }).lean() : null
    if (link) {
      if (link.status === 'pending' && link.expiresAt.getTime() > now.getTime()) {
        return { link, view: 'pending' }
      }
      if (this.isMine(link, user) && APPROVED_STATES.includes(link.status)) {
        return { link, view: 'approved' }
      }
      if (this.isMine(link, user) && link.status === 'denied') return { link, view: 'denied' }
    }
    throw this.wrongCode(user)
  }

  private async choicesFor(
    link: DeviceLink,
    user: AccountUser,
    req: RequestLike,
    now: Date,
  ): Promise<{ choices: Choices; same: boolean; strong: boolean; browserCountry?: string }> {
    const devices = await this.deviceModel
      .find(
        { user: user._id },
        'name brand model enabled lastHeartbeat heartbeatIntervalMinutes +phoneId +phoneSigner',
      )
      .lean()
    const deviceIds = devices.map((device) => device._id)
    const keyed = deviceIds.length
      ? await this.apiKeyModel.distinct('linkedDevice', {
          user: user._id,
          source: DEVICE_LINK_KEY_SOURCE,
          linkedDevice: { $in: deviceIds },
          $or: [{ revokedAt: { $exists: false } }, { revokedAt: null }],
        })
      : []
    const withKeys = new Set(keyed.map((id) => String(id)))
    const choiceDevices: ChoiceDevice[] = devices.map((device) => ({
      ...device,
      _id: device._id,
      hasSignInKey: withKeys.has(String(device._id)),
    }))

    const requestDeviceId = link.requestDeviceId ? String(link.requestDeviceId) : undefined
    let otherAccountDevice: ChoiceDevice | null = null
    if (requestDeviceId && !devices.some((device) => String(device._id) === requestDeviceId)) {
      otherAccountDevice = await this.deviceModel
        .findOne(
          { _id: link.requestDeviceId, user: { $ne: user._id } },
          'brand model +phoneId +phoneSigner',
        )
        .lean()
    }

    const address = resolveClientAddress(req)
    const browser = networkFacts(address.ip, address.asn, address.country)
    const same = sameNetwork(link, browser)
    const strong = strongSameNetwork(link, browser)
    const choices = buildChoices({
      request: {
        brand: link.brand,
        model: link.model,
        phoneId: link.phoneId,
        phoneSigner: link.phoneSigner,
        requestDeviceId,
      },
      devices: choiceDevices,
      otherAccountDevice,
      limit: await this.deviceLimit(user._id),
      activeCount: devices.filter((device) => device.enabled === true).length,
      strongSameNetwork: strong,
      now,
    })
    return { choices, same, strong, browserCountry: address.country }
  }

  async lookup(user: AccountUser, rawCode: unknown, req: RequestLike) {
    this.assertOn(user)
    await this.countCodeAttempt(user)
    const now = new Date()
    const { link, view } = await this.findForUser(user, rawCode, now)
    const { choices, same, strong, browserCountry } = await this.choicesFor(link, user, req, now)
    return {
      mode: choices.mode,
      status: view,
      phone: { name: link.deviceName, brand: link.brand, model: link.model },
      requestedFrom: placeLabel(link.country),
      browserFrom: placeLabel(browserCountry),
      sameNetwork: same,
      strongSameNetwork: strong,
      mustTypeCode: !same,
      accountEmail: user.email,
      emailVerified: !!user.emailVerifiedAt,
      expiresAt: link.expiresAt.toISOString(),
      defaultName: choices.defaultName,
      deviceLimit: choices.deviceLimit,
      suggested: choices.suggested,
      message: choices.message,
      options: choices.options,
    }
  }

  async approve(user: AccountUser, rawCode: unknown, body: unknown, req: RequestLike) {
    this.assertOn(user)
    if (user.isBanned || user.accountDeletionRequestedAt) {
      throw fail(HttpStatus.FORBIDDEN, { error: ERRORS.cannotConnect })
    }
    await this.countCodeAttempt(user)
    const now = new Date()
    const { link, view } = await this.findForUser(user, rawCode, now)
    if (view !== 'pending') throw this.wrongCode(user)

    const input = parseApproveBody(body)
    if (!input) throw fail(HttpStatus.BAD_REQUEST, { error: ERRORS.choice })

    const { choices, same } = await this.choicesFor(link, user, req, now)
    // On another network the page must send the code the user typed
    if (!same && input.typedCode === undefined) {
      throw fail(HttpStatus.BAD_REQUEST, { error: ERRORS.codeMismatch })
    }
    if (input.typedCode !== undefined && input.typedCode !== link.code) {
      throw fail(HttpStatus.BAD_REQUEST, { error: ERRORS.codeMismatch })
    }

    const chosen = checkChoice(choices, input)
    if (chosen.ok === false) {
      if (chosen.reason === 'limit' && choices.deviceLimit.limit !== null) {
        throw fail(HttpStatus.CONFLICT, {
          error: m2Text(choices.deviceLimit.limit),
          code: 'DEVICE_LIMIT',
        })
      }
      throw fail(HttpStatus.BAD_REQUEST, { error: ERRORS.choice })
    }

    const picked = chosen.action === 'new' ? 'new' : chosen.option.deviceId
    const update: Partial<DeviceLink> = {
      status: 'approved',
      user: user._id,
      action: chosen.action,
      mode: choices.mode,
      changedSuggestion: choices.suggested !== null && choices.suggested !== picked,
      approvedAt: now,
      deleteAt: new Date((link.createdAt ?? now).getTime() + KEEP_MS),
    }
    if (chosen.action === 'new') {
      update.chosenName = input.action === 'new' && input.name ? input.name : choices.defaultName
    } else {
      update.chosenDeviceId = new Types.ObjectId(chosen.option.deviceId)
    }
    const approved = await this.deviceLinkModel.findOneAndUpdate(
      { _id: link._id, status: 'pending', expiresAt: { $gt: now } },
      { $set: update },
    )
    if (!approved) throw fail(HttpStatus.NOT_FOUND, { error: ERRORS.codeNotFound })
    return { status: 'approved' }
  }

  async deny(user: AccountUser, rawCode: unknown) {
    await this.countCodeAttempt(user)
    const now = new Date()
    const code = normalizeCode(rawCode)
    const denied = code
      ? await this.deviceLinkModel.findOneAndUpdate(
          { code, status: 'pending', expiresAt: { $gt: now } },
          { $set: { status: 'denied', user: user._id } },
        )
      : null
    if (denied) return { status: 'denied' }
    throw this.wrongCode(user)
  }

  async settings(user: AccountUser) {
    const tester = parseTesters(resolveSetting('deviceLinksTesters')).has(
      String(user._id).toLowerCase(),
    )
    const enabled =
      tester ||
      (resolveSetting('deviceLinksEnabled') === true &&
        resolveSetting('deviceLinksInDashboard') === true)
    return { enabled, defaultTab: await this.defaultTab(user._id, new Date()) }
  }

  // Which tab of the add-device dialog opens first; the first match wins
  async defaultTab(userId: Types.ObjectId, now: Date): Promise<'code' | 'key'> {
    const devices = await this.deviceModel
      .find({ user: userId }, 'lastHeartbeat appVersionCode appVersionInfo')
      .lean()
    if (devices.length === 0) return 'code'
    if (await this.apiKeyModel.exists({ user: userId, source: DEVICE_LINK_KEY_SOURCE })) {
      return 'code'
    }
    const since = now.getTime() - RECENT_DEVICE_MS
    const recentNewApp = devices.some(
      (device) =>
        device.lastHeartbeat &&
        new Date(device.lastHeartbeat).getTime() > since &&
        deviceVersionCode(device) >= SIGN_IN_MIN_VERSION_CODE,
    )
    return recentNewApp ? 'code' : 'key'
  }
}
