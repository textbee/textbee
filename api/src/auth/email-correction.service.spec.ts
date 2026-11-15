import { HttpException, HttpStatus } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { Types } from 'mongoose'
import { AuthService } from './auth.service'
import { EmailCorrectionService } from './email-correction.service'

const USER_ID = new Types.ObjectId()
const HISTORY_ID = new Types.ObjectId()
const PASSWORD = 'right-password'
const HASH = bcrypt.hashSync(PASSWORD, 4)

const ACTIVITY = [
  'devices',
  'apikeys',
  'sms',
  'smsbatches',
  'webhooksubscriptions',
  'subscriptions',
  'checkoutsessions',
  'checkoutattempts',
  'devicetombstones',
  'apikeytombstones',
] as const
const TOMBSTONES = ['devicetombstones', 'apikeytombstones']

const storedUser = (overrides: Record<string, unknown> = {}) => ({
  _id: USER_ID,
  email: 'bob@gmail.con',
  password: HASH,
  role: 'REGULAR',
  isBanned: false,
  meta: {},
  ...overrides,
})

const build = (overrides: Record<string, unknown> = {}) => {
  const reads: any[] = [storedUser(overrides)]
  const lean = jest.fn(async () => (reads.length > 1 ? reads.shift() : reads[0]))
  const select = jest.fn(() => ({ lean }))
  const userModel = {
    findOne: jest.fn(() => ({ select })),
    exists: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
  }
  const emailHistoryModel = {
    countDocuments: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockResolvedValue({ _id: HISTORY_ID }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  }
  const suppressionModel = { exists: jest.fn().mockResolvedValue(null) }
  const emailVerificationModel = {
    updateMany: jest.fn().mockResolvedValue({}),
  }
  const passwordResetModel = { updateMany: jest.fn().mockResolvedValue({}) }
  const activity = Object.fromEntries(
    ACTIVITY.map((name) => [name, { exists: jest.fn().mockResolvedValue(null) }]),
  ) as Record<(typeof ACTIVITY)[number], { exists: jest.Mock }>
  const authService = {
    validateEmail: jest.fn((email) =>
      AuthService.prototype.validateEmail.call(null, email),
    ),
    sendVerificationLink: jest.fn().mockResolvedValue('sent'),
  }

  const service = new EmailCorrectionService(
    userModel as any,
    emailHistoryModel as any,
    suppressionModel as any,
    emailVerificationModel as any,
    passwordResetModel as any,
    activity.devices as any,
    activity.apikeys as any,
    activity.sms as any,
    activity.smsbatches as any,
    activity.webhooksubscriptions as any,
    activity.subscriptions as any,
    activity.checkoutsessions as any,
    activity.checkoutattempts as any,
    activity.devicetombstones as any,
    activity.apikeytombstones as any,
    authService as any,
  )

  const redis = { eval: jest.fn().mockResolvedValue(1) }
  const redisClient = jest
    .spyOn(service as any, 'redisClient')
    .mockReturnValue(redis)
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined)
  jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined)

  return {
    service,
    reads,
    userModel,
    select,
    emailHistoryModel,
    suppressionModel,
    emailVerificationModel,
    passwordResetModel,
    activity,
    authService,
    redis,
    redisClient,
  }
}

const session = { user: { _id: USER_ID } }
const body = (fields: Record<string, unknown> = {}) => ({
  newEmail: 'bob@gmail.com',
  currentPassword: PASSWORD,
  ...fields,
})
const error = (status: number, message: string) => ({
  status,
  response: { error: message },
})

const NOT_AVAILABLE: Array<[string, Record<string, unknown>]> = [
  ['a googleId is present', { googleId: 'g-1' }],
  ['there is no password', { password: undefined }],
  ['the account is banned', { isBanned: true }],
  ['deletion was requested', { accountDeletionRequestedAt: new Date() }],
  ['the account was merged into another', { meta: { mergedInto: 'x' } }],
  ['another account was merged into it', { meta: { mergedFrom: 'x' } }],
  ['the role is not REGULAR', { role: 'ADMIN' }],
]
const VERIFIED: Array<[string, Record<string, unknown>]> = [
  ['verified', { emailVerifiedAt: new Date() }],
  ['waived', { emailVerificationWaivedAt: new Date() }],
]

describe('EmailCorrectionService eligibility (GET /auth/correct-email)', () => {
  it('answers eligible for an unverified password account with no activity', async () => {
    const ctx = build()

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: true,
    })
    expect(ctx.select).toHaveBeenCalledWith('+password +emailVerificationWaivedAt')
    for (const name of ACTIVITY) {
      expect(ctx.activity[name].exists).toHaveBeenCalledWith(
        TOMBSTONES.includes(name) ? { userId: USER_ID } : { user: USER_ID },
      )
    }
  })

  it.each(VERIFIED)('answers verified when the email is %s', async (_n, user) => {
    const ctx = build(user)

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: false,
      reason: 'verified',
    })
  })

  it.each(ACTIVITY)('answers has_activity for a row in %s', async (name) => {
    const ctx = build()
    ctx.activity[name].exists.mockResolvedValue({ _id: 'row' })

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: false,
      reason: 'has_activity',
    })
  })

  it.each(NOT_AVAILABLE)('answers not_available when %s', async (_n, user) => {
    const ctx = build(user)

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: false,
      reason: 'not_available',
    })
  })

  it('treats an account with no stored role as a regular account', async () => {
    const ctx = build({ role: undefined })

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: true,
    })
  })

  it('answers not_available for a request made with an API key', async () => {
    const ctx = build()

    await expect(
      ctx.service.eligibility({ ...session, apiKey: { _id: 'key' } }),
    ).resolves.toEqual({ eligible: false, reason: 'not_available' })
    expect(ctx.userModel.findOne).not.toHaveBeenCalled()
  })

  it('answers not_available when the account cannot be loaded', async () => {
    const ctx = build()
    ctx.reads.splice(0, 1, null)

    await expect(ctx.service.eligibility(session)).resolves.toEqual({
      eligible: false,
      reason: 'not_available',
    })
  })
})

describe('EmailCorrectionService correctEmail (POST /auth/correct-email)', () => {
  it('records the change, expires old links and codes, changes the email and sends a link', async () => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail(session, body({ newEmail: '  Bob@Gmail.com ' })),
    ).resolves.toEqual({
      message: 'We sent a verification link to bob@gmail.com.',
      email: 'bob@gmail.com',
      sent: true,
    })

    expect(ctx.userModel.updateOne).toHaveBeenCalledWith(
      {
        _id: USER_ID,
        email: 'bob@gmail.con',
        emailVerifiedAt: null,
        emailVerificationWaivedAt: null,
      },
      { $set: { email: 'bob@gmail.com' } },
    )
    for (const model of [ctx.emailVerificationModel, ctx.passwordResetModel]) {
      expect(model.updateMany).toHaveBeenCalledWith(
        { user: USER_ID, expiresAt: { $gt: expect.any(Date) } },
        { $set: { expiresAt: expect.any(Date) } },
      )
    }
    expect(ctx.emailHistoryModel.create).toHaveBeenCalledWith({
      user: USER_ID,
      oldEmail: 'bob@gmail.con',
      newEmail: 'bob@gmail.com',
      source: 'user',
      reason: 'unverified-correction',
      oldEmailVerifiedAt: null,
      changedAt: expect.any(Date),
    })
    expect(ctx.authService.sendVerificationLink).toHaveBeenCalledWith(
      expect.objectContaining({ _id: USER_ID, email: 'bob@gmail.con' }),
      'bob@gmail.com',
    )
    const order = [
      ctx.emailHistoryModel.create,
      ctx.emailVerificationModel.updateMany,
      ctx.passwordResetModel.updateMany,
      ctx.userModel.updateOne,
      ctx.authService.sendVerificationLink,
    ].map((fn) => fn.mock.invocationCallOrder[0])
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(ctx.emailHistoryModel.deleteOne).not.toHaveBeenCalled()
  })

  it('sets changedAt when the history row is inserted, before the update', async () => {
    const ctx = build()
    let changedAt: Date | undefined
    ctx.emailHistoryModel.create.mockImplementation(async (row) => {
      changedAt = row.changedAt
      return { _id: HISTORY_ID }
    })
    const before = Date.now()

    await ctx.service.correctEmail(session, body())

    expect(changedAt?.getTime()).toBeGreaterThanOrEqual(before)
    expect(ctx.emailHistoryModel.create.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.userModel.updateOne.mock.invocationCallOrder[0],
    )
  })

  it('answers 403 for a request made with an API key', async () => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail({ ...session, apiKey: { _id: 'key' } }, body()),
    ).rejects.toMatchObject(
      error(403, 'Use the dashboard to change your email.'),
    )
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it.each([
    ['a malformed address', 'bob@gmail'],
    ['a non-string address', { $ne: null }],
    ['a missing address', undefined],
  ])('answers 400 Invalid email for %s', async (_n, newEmail) => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail(session, body({ newEmail })),
    ).rejects.toMatchObject(error(400, 'Invalid email'))
    expect(ctx.userModel.findOne).not.toHaveBeenCalled()
  })

  it('answers 400 for a non-string password', async () => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail(session, body({ currentPassword: 12345 })),
    ).rejects.toMatchObject(error(400, 'Your password is incorrect.'))
    expect(ctx.userModel.findOne).not.toHaveBeenCalled()
  })

  it.each(VERIFIED)('answers 403 when the email is %s', async (_n, user) => {
    const ctx = build(user)

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(403, 'Your email is already verified. Contact support to change it.'),
    )
  })

  it.each(NOT_AVAILABLE)('answers 403 contact support when %s', async (_n, user) => {
    const ctx = build(user)

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(403, 'Contact support to change your email.'),
    )
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it.each(ACTIVITY)('answers 403 contact support for a row in %s', async (name) => {
    const ctx = build()
    ctx.activity[name].exists.mockResolvedValue({ _id: 'row' })

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(403, 'Contact support to change your email.'),
    )
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('answers 400 for a wrong password and still counts the attempt', async () => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail(session, body({ currentPassword: 'wrong' })),
    ).rejects.toMatchObject(error(400, 'Your password is incorrect.'))
    expect(ctx.redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      `correct-email:attempts:${USER_ID}`,
      24 * 60 * 60,
    )
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('answers 400 when the new email is the current one after trimming and lowercasing', async () => {
    const ctx = build()

    await expect(
      ctx.service.correctEmail(session, body({ newEmail: ' BOB@gmail.CON ' })),
    ).rejects.toMatchObject(error(400, 'This is already your email.'))
  })

  it('answers 429 after 3 changes in 24 hours', async () => {
    const ctx = build()
    ctx.emailHistoryModel.countDocuments.mockResolvedValue(3)

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(
        429,
        'Too many email changes. Try again tomorrow or contact support.',
      ),
    )
    expect(ctx.emailHistoryModel.countDocuments).toHaveBeenCalledWith({
      user: USER_ID,
      source: 'user',
      changedAt: { $gte: expect.any(Date) },
    })
    expect(ctx.emailHistoryModel.create).not.toHaveBeenCalled()
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('answers 429 and removes its row when an overlapping request took the last slot', async () => {
    const ctx = build()
    ctx.emailHistoryModel.countDocuments
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(4)

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(
        429,
        'Too many email changes. Try again tomorrow or contact support.',
      ),
    )
    expect(ctx.emailHistoryModel.create).toHaveBeenCalledTimes(1)
    expect(ctx.emailHistoryModel.deleteOne).toHaveBeenCalledWith({
      _id: HISTORY_ID,
    })
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('removes its history row when expiring old links fails', async () => {
    const ctx = build()
    ctx.passwordResetModel.updateMany.mockRejectedValue(new Error('down'))

    await expect(ctx.service.correctEmail(session, body())).rejects.toThrow('down')
    expect(ctx.emailHistoryModel.deleteOne).toHaveBeenCalledWith({
      _id: HISTORY_ID,
    })
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('allows the tenth attempt in 24 hours and refuses the eleventh', async () => {
    const ctx = build()
    ctx.redis.eval.mockResolvedValueOnce(10).mockResolvedValueOnce(11)

    await expect(ctx.service.correctEmail(session, body())).resolves.toMatchObject({
      email: 'bob@gmail.com',
    })
    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(
        429,
        'Too many email changes. Try again tomorrow or contact support.',
      ),
    )
  })

  it('skips the attempt count when Redis fails', async () => {
    const ctx = build()
    ctx.redis.eval.mockRejectedValue(new Error('down'))

    await expect(ctx.service.correctEmail(session, body())).resolves.toMatchObject({
      email: 'bob@gmail.com',
    })
  })

  it('skips the attempt count when Redis is not configured', async () => {
    const ctx = build()
    ctx.redisClient.mockReturnValue(null)

    await expect(ctx.service.correctEmail(session, body())).resolves.toMatchObject({
      email: 'bob@gmail.com',
    })
  })

  it('answers 409 when another account has the email', async () => {
    const ctx = build()
    ctx.userModel.exists.mockResolvedValue({ _id: 'other' })

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(409, 'This email is already in use. Sign in with it instead.'),
    )
    expect(ctx.userModel.exists).toHaveBeenCalledWith({ email: 'bob@gmail.com' })
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('answers 409 in use when the update hits the unique index', async () => {
    const ctx = build()
    ctx.userModel.updateOne.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    )

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(409, 'This email is already in use. Sign in with it instead.'),
    )
    expect(ctx.emailHistoryModel.deleteOne).toHaveBeenCalledWith({
      _id: HISTORY_ID,
    })
    expect(ctx.authService.sendVerificationLink).not.toHaveBeenCalled()
  })

  it('answers 400 for a suppressed address', async () => {
    const ctx = build()
    ctx.suppressionModel.exists.mockResolvedValue({ _id: 's1' })

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(
        400,
        'We cannot deliver email to this address. Use a different email.',
      ),
    )
    expect(ctx.suppressionModel.exists).toHaveBeenCalledWith({
      email: 'bob@gmail.com',
    })
    expect(ctx.userModel.updateOne).not.toHaveBeenCalled()
  })

  it('answers 409 reload and removes its row when another request changed the email first', async () => {
    const ctx = build()
    ctx.userModel.updateOne.mockResolvedValue({ matchedCount: 0 })
    ctx.reads.push(storedUser({ email: 'bob@gmail.co' }))

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(409, 'Your email was just changed. Reload the page.'),
    )
    expect(ctx.emailHistoryModel.deleteOne).toHaveBeenCalledWith({
      _id: HISTORY_ID,
    })
    expect(ctx.authService.sendVerificationLink).not.toHaveBeenCalled()
  })

  it('answers 403 already verified and removes its row when the account was verified before the update', async () => {
    const ctx = build()
    ctx.userModel.updateOne.mockResolvedValue({ matchedCount: 0 })
    ctx.reads.push(storedUser({ emailVerifiedAt: new Date() }))

    await expect(ctx.service.correctEmail(session, body())).rejects.toMatchObject(
      error(403, 'Your email is already verified. Contact support to change it.'),
    )
    expect(ctx.emailHistoryModel.deleteOne).toHaveBeenCalledWith({
      _id: HISTORY_ID,
    })
  })

  it.each([
    ['throws', () => Promise.reject(new Error('down'))],
    ['reports a failure', () => Promise.resolve('failed')],
    ['is skipped', () => Promise.resolve('skipped')],
  ])('answers 200 with a resend hint when the email %s', async (_n, send) => {
    const ctx = build()
    ctx.authService.sendVerificationLink.mockImplementation(send)

    await expect(ctx.service.correctEmail(session, body())).resolves.toEqual({
      message:
        'Your email is now bob@gmail.com. Press resend to get the verification link.',
      email: 'bob@gmail.com',
      sent: false,
    })
    expect(ctx.emailHistoryModel.create).toHaveBeenCalledTimes(1)
    expect(ctx.emailHistoryModel.deleteOne).not.toHaveBeenCalled()
  })

  it('answers 200 without a resend hint when the verification email limit is reached', async () => {
    const ctx = build()
    ctx.authService.sendVerificationLink.mockRejectedValue(
      new HttpException(
        { error: 'Too many email verification requests. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    )

    await expect(ctx.service.correctEmail(session, body())).resolves.toEqual({
      message:
        'Your email is now bob@gmail.com. You have reached the limit for verification emails. Try again tomorrow or contact support.',
      email: 'bob@gmail.com',
      sent: false,
    })
    expect(ctx.emailHistoryModel.deleteOne).not.toHaveBeenCalled()
  })
})
