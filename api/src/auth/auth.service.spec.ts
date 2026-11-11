import { HttpException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import axios from 'axios'
import { AuthService } from './auth.service'

// bcryptjs is ESM, so jest.spyOn cannot patch it. Wrap the real calls instead.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual('bcryptjs')
  return {
    ...actual,
    compare: jest.fn(actual.compare),
    compareSync: jest.fn(actual.compareSync),
  }
})

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

// AuthService takes ten constructor deps. Only the ones a given flow
// touches are given real behaviour; the rest are inert stubs.
const build = () => {
  let lastApiKeyDoc: any

  const apiKeyModel: any = jest.fn().mockImplementation((doc: any) => {
    lastApiKeyDoc = { ...doc, save: jest.fn().mockResolvedValue(undefined) }
    return lastApiKeyDoc
  })
  apiKeyModel.findOne = jest.fn()
  apiKeyModel.findById = jest.fn()
  apiKeyModel.updateOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue(undefined),
  })
  apiKeyModel.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 })
  apiKeyModel.exists = jest.fn().mockResolvedValue({ _id: 'key_1' })

  const apiKeyTombstoneModel = {
    updateOne: jest.fn().mockResolvedValue({ upsertedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  }

  const usersService = {
    findOne: jest.fn(),
    findOneWithPassword: jest.fn(),
    create: jest.fn(),
    markMilestone: jest.fn().mockResolvedValue(false),
    markEmailVerified: jest.fn().mockResolvedValue(true),
    touchClient: jest.fn(),
  }
  const passwordResetModel = { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
  const mailService = {
    sendEmailFromTemplate: jest.fn().mockResolvedValue(undefined),
    sendTemplated: jest.fn().mockResolvedValue('sent'),
  }
  const jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') }
  const turnstileService = { verify: jest.fn().mockResolvedValue(undefined) }
  const analyticsService = {
    userRegistered: jest.fn(),
    checkoutStarted: jest.fn(),
    purchase: jest.fn(),
  }
  const emailVerificationModel: any = { findOne: jest.fn() }
  const emailHistoryModel = { exists: jest.fn().mockResolvedValue(null) }

  const service = new AuthService(
    usersService as any,
    { refreshQuietly: jest.fn().mockResolvedValue(undefined) } as any,
    jwtService as any,
    apiKeyModel,
    apiKeyTombstoneModel as any,
    passwordResetModel as any,
    {} as any, // accessLogModel
    emailVerificationModel,
    mailService as any,
    turnstileService as any,
    analyticsService as any,
    emailHistoryModel as any,
  )

  return {
    service,
    apiKeyModel,
    apiKeyTombstoneModel,
    usersService,
    passwordResetModel,
    mailService,
    jwtService,
    turnstileService,
    emailVerificationModel,
    emailHistoryModel,
    getLastApiKeyDoc: () => lastApiKeyDoc,
  }
}

describe('AuthService', () => {
  describe('validateEmail', () => {
    it('accepts a well-formed address', async () => {
      const { service } = build()
      await expect(service.validateEmail('a@b.com')).resolves.toBeUndefined()
    })

    it('tolerates surrounding whitespace', async () => {
      const { service } = build()
      await expect(service.validateEmail('  a@b.com  ')).resolves.toBeUndefined()
    })

    it.each([
      'plainaddress',
      'no-at-sign.com',
      'missing@dot',
      '@no-local.com',
      // Used to pass: the pattern was unanchored, so any substring matched.
      'hello a@b.com world',
      'a b@c.com',
      undefined as any,
      null as any,
    ])('rejects %s', async (bad) => {
      const { service } = build()
      await expect(service.validateEmail(bad)).rejects.toThrow(HttpException)
    })

    it('rejects an over-long address without scanning it', async () => {
      const { service } = build()
      const huge = `${'!'.repeat(100000)}@b.com`

      const startedAt = Date.now()
      await expect(service.validateEmail(huge)).rejects.toThrow(HttpException)
      // The old unanchored pattern backtracked on input like this.
      expect(Date.now() - startedAt).toBeLessThan(1000)
    })
  })

  describe('validatePassword', () => {
    it('rejects a password shorter than 6 characters', async () => {
      const { service } = build()
      await expect(service.validatePassword('12345')).rejects.toThrow(HttpException)
    })

    it('accepts the 6 and 128 character boundaries', async () => {
      const { service } = build()
      await expect(service.validatePassword('123456')).resolves.toBeUndefined()
      await expect(service.validatePassword('a'.repeat(128))).resolves.toBeUndefined()
    })

    it('rejects a password longer than 128 characters', async () => {
      const { service } = build()
      await expect(service.validatePassword('a'.repeat(129))).rejects.toThrow(
        HttpException,
      )
    })
  })

  describe('generateApiKey', () => {
    it('returns a raw key and persists only a masked value plus a bcrypt hash', async () => {
      const { service, getLastApiKeyDoc } = build()

      const result = await service.generateApiKey({ _id: 'user_1' } as any)

      expect(typeof result.apiKey).toBe('string')
      const doc = getLastApiKeyDoc()
      // The stored apiKey is masked: it must not be the raw key.
      expect(doc.apiKey).not.toBe(result.apiKey)
      expect(doc.apiKey.endsWith('*'.repeat(18))).toBe(true)
      expect(doc.apiKey.startsWith(result.apiKey.substr(0, 17))).toBe(true)
      // The stored hash is a bcrypt hash of the raw key, never the raw key.
      expect(doc.hashedApiKey).not.toBe(result.apiKey)
      expect(bcrypt.compareSync(result.apiKey, doc.hashedApiKey)).toBe(true)
      expect(doc.user).toBe('user_1')
      expect(doc.save).toHaveBeenCalledTimes(1)
    })

    it('issues prefixed base62 keys that differ between calls', async () => {
      const { service } = build()

      const first = await service.generateApiKey({ _id: 'user_1' } as any)
      const second = await service.generateApiKey({ _id: 'user_1' } as any)

      expect(first.apiKey).toMatch(/^txb_[A-Za-z0-9]{32}$/)
      expect(second.apiKey).toMatch(/^txb_[A-Za-z0-9]{32}$/)
      expect(first.apiKey).not.toBe(second.apiKey)
    })

    it('stores the sha256 lookup hash of the raw key', async () => {
      const { service, getLastApiKeyDoc } = build()

      const result = await service.generateApiKey({ _id: 'user_1' } as any)

      const doc = getLastApiKeyDoc()
      expect(doc.hashedApiKeySha256).toBe(sha256(result.apiKey))
      expect(doc.hashedApiKeySha256).not.toBe(result.apiKey)
    })
  })

  describe('verifyApiKey', () => {
    const raw = 'txb_' + 'a'.repeat(32)

    it('resolves through the sha256 index without touching bcrypt', async () => {
      const { service, apiKeyModel } = build()
      const stored = { _id: 'key_1', user: 'user_1', revokedAt: null }
      apiKeyModel.findOne.mockResolvedValueOnce(stored)
      const compare = jest.mocked(bcrypt.compare)
      compare.mockClear()

      await expect(service.verifyApiKey(raw)).resolves.toBe(stored)
      expect(apiKeyModel.findOne).toHaveBeenCalledTimes(1)
      expect(apiKeyModel.findOne).toHaveBeenCalledWith({
        hashedApiKeySha256: sha256(raw),
      })
      expect(compare).not.toHaveBeenCalled()
    })

    it('rejects a revoked key on the fast path without a legacy lookup', async () => {
      const { service, apiKeyModel } = build()
      apiKeyModel.findOne.mockResolvedValueOnce({
        _id: 'key_1',
        user: 'user_1',
        revokedAt: new Date(),
      })

      await expect(service.verifyApiKey(raw)).resolves.toBeNull()
      // Only the sha256 lookup ran: no masked or regex fallback query.
      expect(apiKeyModel.findOne).toHaveBeenCalledTimes(1)
    })

    it('verifies a legacy bcrypt-only key and backfills its sha256 hash', async () => {
      const { service, apiKeyModel } = build()
      const legacy = {
        _id: 'key_legacy',
        user: 'user_1',
        hashedApiKey: bcrypt.hashSync(raw, 4),
      }
      apiKeyModel.findOne
        .mockResolvedValueOnce(null) // sha256 miss
        .mockResolvedValueOnce(legacy) // masked hit
      const compare = jest.mocked(bcrypt.compare)
      compare.mockClear()

      await expect(service.verifyApiKey(raw)).resolves.toBe(legacy)
      // Proves the bcryptjs mock reaches the service, so the
      // "without touching bcrypt" checks above test something.
      expect(compare).toHaveBeenCalledWith(raw, legacy.hashedApiKey)
      expect(apiKeyModel.updateOne).toHaveBeenCalledWith(
        { _id: 'key_legacy' },
        { $set: { hashedApiKeySha256: sha256(raw) } },
      )
    })

    it('still authenticates when the backfill write fails', async () => {
      const { service, apiKeyModel } = build()
      const legacy = {
        _id: 'key_legacy',
        user: 'user_1',
        hashedApiKey: bcrypt.hashSync(raw, 4),
      }
      apiKeyModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(legacy)
      apiKeyModel.updateOne.mockReturnValueOnce({
        exec: jest.fn().mockRejectedValue(new Error('mongo down')),
      })

      await expect(service.verifyApiKey(raw)).resolves.toBe(legacy)
    })

    it('rejects a key that shares a masked prefix but not the secret body', async () => {
      const { service, apiKeyModel } = build()
      const otherKey = 'txb_' + 'a'.repeat(13) + 'b'.repeat(19)
      const collidingDoc = {
        _id: 'key_other',
        user: 'user_2',
        hashedApiKey: bcrypt.hashSync(otherKey, 4),
      }
      apiKeyModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(collidingDoc)

      // Same first 17 characters, so the masked lookup finds the wrong document.
      expect(otherKey.substring(0, 17)).toBe(raw.substring(0, 17))
      await expect(service.verifyApiKey(raw)).resolves.toBeNull()
      expect(apiKeyModel.updateOne).not.toHaveBeenCalled()
    })

    it('resolves a legacy lookup whose stored mask is already in the new format', async () => {
      const { service, apiKeyModel } = build()
      const legacy = {
        _id: 'key_new_format',
        apiKey: `${raw.substring(0, 17)}${'*'.repeat(18)}`,
        user: 'user_1',
        hashedApiKey: bcrypt.hashSync(raw, 4),
      }
      apiKeyModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(legacy)

      await expect(service.verifyApiKey(raw)).resolves.toBe(legacy)
    })

    it('returns null for an unknown key', async () => {
      const { service, apiKeyModel } = build()
      apiKeyModel.findOne.mockResolvedValue(null)

      await expect(service.verifyApiKey(raw)).resolves.toBeNull()
    })

    it('returns null for a missing or non-string key without querying', async () => {
      const { service, apiKeyModel } = build()

      await expect(service.verifyApiKey(undefined as any)).resolves.toBeNull()
      await expect(service.verifyApiKey('')).resolves.toBeNull()
      expect(apiKeyModel.findOne).not.toHaveBeenCalled()
    })

    // request.query.apiKey is attacker-controlled and need not be a string.
    // Without the type guard these would reach findOne as query operators.
    it.each([
      [{ $ne: null }],
      [{ $gt: '' }],
      [{ $regex: '.*' }],
      [['a', 'b']],
      [[]],
      [{}],
      [0],
      [true],
      [null],
    ])('rejects non-string payload %p without querying', async (payload) => {
      const { service, apiKeyModel } = build()

      await expect(service.verifyApiKey(payload as any)).resolves.toBeNull()
      expect(apiKeyModel.findOne).not.toHaveBeenCalled()
    })

    it('rejects a revoked legacy key and does not backfill it', async () => {
      const { service, apiKeyModel } = build()
      apiKeyModel.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        _id: 'key_legacy',
        user: 'user_1',
        hashedApiKey: bcrypt.hashSync(raw, 4),
        revokedAt: new Date(),
      })

      await expect(service.verifyApiKey(raw)).resolves.toBeNull()
      expect(apiKeyModel.updateOne).not.toHaveBeenCalled()
    })

    afterEach(() => jest.restoreAllMocks())
  })

  describe('getUserApiKeys', () => {
    it('excludes both credential digests from the projection', async () => {
      const { service, apiKeyModel } = build()
      apiKeyModel.find = jest.fn().mockResolvedValue([])

      await service.getUserApiKeys({ _id: 'user_1' } as any)

      const projection = apiKeyModel.find.mock.calls[0][1]
      expect(projection).toContain('-hashedApiKey')
      expect(projection).toContain('-hashedApiKeySha256')
    })
  })

  describe('deleteApiKey', () => {
    const apiKeyId = '507f1f77bcf86cd799439011'
    const userId = '507f1f77bcf86cd799439012'
    const revokedKey = {
      _id: apiKeyId,
      user: userId,
      name: 'Server key',
      apiKey: 'txb_abc123******',
      hashedApiKey: 'bcrypt-hash',
      hashedApiKeySha256: 'sha-hash',
      usageCount: 128,
      revokedAt: new Date('2026-09-01T00:00:00.000Z'),
    }
    const leanFindOne = (model: any, value: any) =>
      model.findOne.mockReturnValue({
        lean: jest.fn().mockResolvedValue(value),
      })

    it('keeps the whole key document before deleting it', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, revokedKey)

      await service.deleteApiKey(apiKeyId)

      const [filter, update, options] =
        apiKeyTombstoneModel.updateOne.mock.calls[0]
      expect(filter.apiKeyId.toString()).toBe(apiKeyId)
      expect(update.$setOnInsert.apiKey).toEqual(revokedKey)
      expect(update.$setOnInsert.userId).toBe(userId)
      expect(update.$setOnInsert.deletedAt).toBeInstanceOf(Date)
      expect(options).toEqual({ upsert: true })
      expect(String(apiKeyModel.deleteOne.mock.calls[0][0]._id)).toBe(apiKeyId)
      expect(apiKeyTombstoneModel.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
        apiKeyModel.deleteOne.mock.invocationCallOrder[0],
      )
    })

    it('takes back the record when the delete fails', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, revokedKey)
      apiKeyModel.deleteOne.mockRejectedValueOnce(new Error('write failed'))

      await expect(service.deleteApiKey(apiKeyId)).rejects.toThrow('write failed')

      expect(String(apiKeyTombstoneModel.deleteOne.mock.calls[0][0].apiKeyId)).toBe(
        apiKeyId,
      )
    })

    it('keeps the record when the delete landed before the error', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, revokedKey)
      apiKeyModel.deleteOne.mockRejectedValueOnce(new Error('write failed'))
      // The key is gone, so the record is the only copy left.
      apiKeyModel.exists.mockResolvedValueOnce(null)

      await expect(service.deleteApiKey(apiKeyId)).rejects.toThrow('write failed')
      expect(apiKeyTombstoneModel.deleteOne).not.toHaveBeenCalled()
    })

    it('keeps an earlier record when a retry fails', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, revokedKey)
      // Matched, not inserted: the record predates this call.
      apiKeyTombstoneModel.updateOne.mockResolvedValueOnce({ upsertedCount: 0 })
      apiKeyModel.deleteOne.mockRejectedValueOnce(new Error('write failed'))

      await expect(service.deleteApiKey(apiKeyId)).rejects.toThrow('write failed')
      expect(apiKeyTombstoneModel.deleteOne).not.toHaveBeenCalled()
    })

    it('records nothing when the key does not exist', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, null)

      await expect(service.deleteApiKey(apiKeyId)).rejects.toThrow(HttpException)
      expect(apiKeyTombstoneModel.updateOne).not.toHaveBeenCalled()
      expect(apiKeyModel.deleteOne).not.toHaveBeenCalled()
    })

    it('never queries with an id that is not an ObjectId', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()

      await expect(service.deleteApiKey('not-an-id')).rejects.toThrow(HttpException)
      expect(apiKeyModel.findOne).not.toHaveBeenCalled()
      expect(apiKeyTombstoneModel.updateOne).not.toHaveBeenCalled()
      expect(apiKeyModel.deleteOne).not.toHaveBeenCalled()
    })

    it('records nothing when the key is still active', async () => {
      const { service, apiKeyModel, apiKeyTombstoneModel } = build()
      leanFindOne(apiKeyModel, { ...revokedKey, revokedAt: undefined })

      await expect(service.deleteApiKey(apiKeyId)).rejects.toThrow(HttpException)
      expect(apiKeyTombstoneModel.updateOne).not.toHaveBeenCalled()
      expect(apiKeyModel.deleteOne).not.toHaveBeenCalled()
    })
  })

  describe('findActiveApiKeyByClientKey', () => {
    const revokedClause = {
      $or: [{ revokedAt: null }, { revokedAt: { $exists: false } }],
    }

    it('resolves via the exact masked match when one exists', async () => {
      const { service, apiKeyModel } = build()
      const hit = { apiKey: 'masked', user: 'user_1' }
      apiKeyModel.findOne.mockResolvedValueOnce(hit)

      const raw = 'abcdefghijklmnopqrstuvwxyz'
      const found = await service.findActiveApiKeyByClientKey(raw)

      expect(found).toBe(hit)
      expect(apiKeyModel.findOne).toHaveBeenCalledTimes(1)
      expect(apiKeyModel.findOne).toHaveBeenCalledWith({
        apiKey: `${raw.substring(0, 17)}${'*'.repeat(18)}`,
        ...revokedClause,
      })
    })

    it('falls back to a prefix regex when there is no masked match', async () => {
      const { service, apiKeyModel } = build()
      const hit = { apiKey: 'legacy', user: 'user_1' }
      apiKeyModel.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(hit)

      const raw = 'abcdefghijklmnopqrstuvwxyz'
      const found = await service.findActiveApiKeyByClientKey(raw)

      expect(found).toBe(hit)
      expect(apiKeyModel.findOne).toHaveBeenCalledTimes(2)
      const fallbackArg = apiKeyModel.findOne.mock.calls[1][0]
      expect(fallbackArg.apiKey.$regex).toBeInstanceOf(RegExp)
      // A legitimate prefix matches its own masked value.
      expect(fallbackArg.apiKey.$regex.test(raw.substring(0, 17))).toBe(true)
      // The revoked-key exclusion is applied on both lookups.
      expect(fallbackArg.$or).toEqual(revokedClause.$or)
    })

    it('does not throw when the key contains regex metacharacters', async () => {
      const { service, apiKeyModel } = build()
      apiKeyModel.findOne.mockResolvedValue(null) // no masked hit -> regex fallback

      const raw = '((((' + 'x'.repeat(20)
      await expect(service.findActiveApiKeyByClientKey(raw)).resolves.toBeNull()

      // The prefix is escaped before it reaches the RegExp, so the parens are
      // literal and the pattern compiles instead of throwing SyntaxError.
      const fallbackArg = apiKeyModel.findOne.mock.calls[1][0]
      expect(fallbackArg.apiKey.$regex.source).toContain('\\(')
    })
  })

  describe('login', () => {
    const attempt = async (
      stored: Record<string, unknown>,
      password?: string,
    ) => {
      const { service, usersService } = build()
      usersService.findOneWithPassword.mockResolvedValue({
        _id: 'user_1',
        email: 'ada@example.com',
        save: jest.fn().mockResolvedValue(undefined),
        ...stored,
      })
      return service.login({
        email: 'ada@example.com',
        password,
        turnstileToken: 'token',
      })
    }

    it.each([
      ['an account with no stored password', {}, 'any-password'],
      ['a request with no password', { password: bcrypt.hashSync('right', 4) }, undefined],
      ['a wrong password', { password: bcrypt.hashSync('right', 4) }, 'wrong'],
    ])('answers 401 for %s', async (_name, stored, password) => {
      await expect(attempt(stored, password)).rejects.toMatchObject({
        status: 401,
      })
    })
  })

  describe('changePassword', () => {
    it('answers 400 for an account with no stored password', async () => {
      const { service, usersService } = build()
      const stored = { _id: 'user_1', save: jest.fn() }
      usersService.findOneWithPassword.mockResolvedValue(stored)

      await expect(
        service.changePassword(
          { oldPassword: 'any', newPassword: 'a-brand-new-password' },
          { _id: 'user_1' } as any,
        ),
      ).rejects.toMatchObject({ status: 400 })
      expect(stored.save).not.toHaveBeenCalled()
    })

    const withOldPassword = async (old: string) => {
      const ctx = build()
      const stored = {
        _id: 'user_1',
        password: bcrypt.hashSync(old, 10),
        save: jest.fn().mockResolvedValue(undefined),
      }
      ctx.usersService.findOneWithPassword.mockResolvedValue(stored)
      return { ...ctx, stored }
    }

    it('rejects a wrong old password without saving', async () => {
      const { service, stored } = await withOldPassword('correct-old')

      await expect(
        service.changePassword(
          { oldPassword: 'wrong', newPassword: 'a-brand-new-password' },
          { _id: 'user_1' } as any,
        ),
      ).rejects.toThrow(HttpException)
      expect(stored.save).not.toHaveBeenCalled()
    })

    it('updates the hash on success', async () => {
      const { service, stored } = await withOldPassword('correct-old')
      const before = stored.password

      await service.changePassword(
        { oldPassword: 'correct-old', newPassword: 'a-brand-new-password' },
        { _id: 'user_1' } as any,
      )

      expect(stored.save).toHaveBeenCalledTimes(1)
      expect(stored.password).not.toBe(before)
      expect(bcrypt.compareSync('a-brand-new-password', stored.password)).toBe(true)
    })
  })

  describe('register input validation', () => {
    const registerSetup = () => {
      const ctx = build()
      ctx.usersService.findOne.mockResolvedValue(null) // no existing user
      // If validation is (incorrectly) skipped, register would reach create;
      // return a usable doc so the pre-fix path resolves rather than erroring.
      ctx.usersService.create.mockResolvedValue({
        _id: 'user_1',
        email: 'x',
        lastLoginAt: null,
        save: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ _id: 'user_1' }),
      })
      return ctx
    }

    it('rejects a malformed email and does not create the user', async () => {
      const { service, usersService } = registerSetup()

      await expect(
        service.register({
          name: 'Ada',
          email: 'not-an-email',
          password: 'a-valid-password',
          turnstileToken: 'token',
        }),
      ).rejects.toThrow(HttpException)
      expect(usersService.create).not.toHaveBeenCalled()
    })

    it('rejects a too-short password and does not create the user', async () => {
      const { service, usersService } = registerSetup()

      await expect(
        service.register({
          name: 'Ada',
          email: 'a@b.com',
          password: '123',
          turnstileToken: 'token',
        }),
      ).rejects.toThrow(HttpException)
      expect(usersService.create).not.toHaveBeenCalled()
    })

    it('creates the user when email and password are valid', async () => {
      const { service, usersService } = registerSetup()

      await service.register({
        name: 'Ada',
        email: 'a@b.com',
        password: 'a-valid-password',
        turnstileToken: 'token',
      })
      expect(usersService.create).toHaveBeenCalledTimes(1)
    })
  })

  describe('changePassword input validation', () => {
    it('rejects a too-short new password without saving', async () => {
      const ctx = build()
      const stored = {
        _id: 'user_1',
        password: bcrypt.hashSync('correct-old', 10),
        save: jest.fn().mockResolvedValue(undefined),
      }
      ctx.usersService.findOneWithPassword.mockResolvedValue(stored)

      await expect(
        ctx.service.changePassword(
          { oldPassword: 'correct-old', newPassword: '123' },
          { _id: 'user_1' } as any,
        ),
      ).rejects.toThrow(HttpException)
      expect(stored.save).not.toHaveBeenCalled()
    })
  })

  describe('resetPassword', () => {
    const setup = () => {
      const ctx = build()
      const user = {
        _id: 'user_1',
        email: 'a@b.com',
        name: 'Ada',
        password: 'old-hash',
        save: jest.fn().mockResolvedValue(undefined),
      }
      ctx.usersService.findOne.mockResolvedValue(user)
      return { ...ctx, user }
    }

    const MAX_ATTEMPTS = 5

    const buildReset = (rawOtp: string, attempts = 0) => ({
      _id: 'reset_1',
      otp: bcrypt.hashSync(rawOtp, 10),
      expiresAt: new Date(Date.now() + 60_000),
      attempts,
      save: jest.fn().mockResolvedValue(undefined),
    })

    // The service reads the newest record, then claims an attempt against it
    // with an atomic findOneAndUpdate. This models that server-side guard:
    // no match once the record is at the cap, otherwise increment and return.
    const stageReset = (ctx: ReturnType<typeof setup>, reset: any) => {
      ctx.passwordResetModel.findOne.mockResolvedValue(reset)
      ctx.passwordResetModel.findOneAndUpdate.mockImplementation(async () => {
        if (reset.attempts >= MAX_ATTEMPTS) return null
        reset.attempts += 1
        return reset
      })
    }

    const submit = (ctx: ReturnType<typeof setup>, otp: string) =>
      ctx.service.resetPassword({
        email: 'a@b.com',
        otp,
        newPassword: 'new-password',
      })

    it('rejects when there is no valid reset record', async () => {
      const ctx = setup()
      ctx.passwordResetModel.findOne.mockResolvedValue(null)

      await expect(submit(ctx, '1234')).rejects.toThrow(HttpException)
      expect(ctx.user.save).not.toHaveBeenCalled()
    })

    it('rejects when the OTP does not match', async () => {
      const ctx = setup()
      stageReset(ctx, buildReset('9999'))

      await expect(submit(ctx, '1234')).rejects.toThrow(HttpException)
      expect(ctx.user.save).not.toHaveBeenCalled()
    })

    it('updates the password and expires the reset on success', async () => {
      const ctx = setup()
      const reset = buildReset('1234')
      stageReset(ctx, reset)

      const res = await submit(ctx, '1234')

      expect(ctx.user.save).toHaveBeenCalledTimes(1)
      expect(bcrypt.compareSync('new-password', ctx.user.password)).toBe(true)
      expect(reset.save).toHaveBeenCalledTimes(1)
      // The reset window is closed (expiry moved to now or earlier).
      expect(reset.expiresAt.getTime()).toBeLessThanOrEqual(Date.now())
      expect(res.message).toMatch(/reset/i)
    })

    it('locks the record out after 5 wrong OTPs, including against the correct one', async () => {
      const ctx = setup()
      const reset = buildReset('1234')
      stageReset(ctx, reset)

      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await expect(submit(ctx, '0000')).rejects.toThrow(HttpException)
      }
      // The correct OTP must not rescue an exhausted record.
      await expect(submit(ctx, '1234')).rejects.toThrow(HttpException)

      expect(ctx.user.save).not.toHaveBeenCalled()
      expect(reset.attempts).toBe(MAX_ATTEMPTS)
    })

    it('rejects the correct OTP when the record is already at the cap', async () => {
      const ctx = setup()
      stageReset(ctx, buildReset('1234', MAX_ATTEMPTS))

      await expect(submit(ctx, '1234')).rejects.toThrow(HttpException)
      expect(ctx.user.save).not.toHaveBeenCalled()
    })

    it('claims each attempt atomically so parallel guesses cannot bypass the cap', async () => {
      const ctx = setup()
      stageReset(ctx, buildReset('1234'))

      await expect(submit(ctx, '0000')).rejects.toThrow(HttpException)

      // A read-modify-write counter would let concurrent requests all observe
      // the same count, so the increment has to happen in the query itself.
      const [filter, update] =
        ctx.passwordResetModel.findOneAndUpdate.mock.calls[0]
      expect(update).toEqual({ $inc: { attempts: 1 } })
      expect(filter._id).toBe('reset_1')
      expect(filter.$or).toEqual([
        { attempts: { $lt: MAX_ATTEMPTS } },
        { attempts: { $exists: false } },
      ])
    })

    it('reports an unknown address the same way as a bad code', async () => {
      const ctx = build()
      ctx.usersService.findOne.mockResolvedValue(null)

      await expect(
        ctx.service.resetPassword({
          email: 'nobody@b.com',
          otp: '123456',
          newPassword: 'Str0ng!pass',
        } as any),
      ).rejects.toMatchObject({
        response: { error: 'Invalid OTP' },
        status: 400,
      })
    })

    it('does not pass a non-string email to the user lookup', async () => {
      const ctx = build()

      await expect(
        ctx.service.resetPassword({
          email: { $ne: null } as any,
          otp: '123456',
          newPassword: 'Str0ng!pass',
        } as any),
      ).rejects.toThrow(HttpException)
      expect(ctx.usersService.findOne).not.toHaveBeenCalled()
    })
  })

  describe('login', () => {
    const credentials = {
      email: 'ada@example.com',
      password: 'correct-password',
      turnstileToken: 'token',
    }

    const setup = () => {
      const ctx = build()
      const stored = {
        _id: 'user_1',
        email: 'ada@example.com',
        password: bcrypt.hashSync('correct-password', 4),
        save: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ _id: 'user_1', email: 'ada@example.com' }),
      }
      ctx.usersService.findOneWithPassword.mockResolvedValue(stored)
      return { ...ctx, stored }
    }

    it('records the browser in the same write as the login time', async () => {
      const { service, usersService, stored } = setup()

      await service.login(credentials, { userAgent: BROWSER_UA })

      expect(usersService.touchClient).toHaveBeenCalledWith(stored, BROWSER_UA)
      expect(stored.save).toHaveBeenCalledTimes(1)
      expect(usersService.touchClient.mock.invocationCallOrder[0]).toBeLessThan(
        stored.save.mock.invocationCallOrder[0],
      )
    })

    it('still logs in when no browser details were forwarded', async () => {
      const { service, stored } = setup()

      const result = await service.login(credentials)

      expect(result.accessToken).toBe('signed-jwt')
      expect(stored.save).toHaveBeenCalledTimes(1)
    })

    it('records nothing for a wrong password', async () => {
      const { service, usersService } = setup()

      await expect(
        service.login(
          { ...credentials, password: 'wrong-password' },
          { userAgent: BROWSER_UA },
        ),
      ).rejects.toThrow(HttpException)
      expect(usersService.touchClient).not.toHaveBeenCalled()
    })
  })

  // tokeninfo only proves Google signed the token. Without these checks a token
  // minted for any other Google OAuth client would be accepted.
  describe('loginWithGoogle', () => {
    const ORIGINAL_ENV = process.env.GOOGLE_CLIENT_ID
    const OURS = 'our-client-id.apps.googleusercontent.com'

    const stageTokenInfo = (data: any) => {
      jest.spyOn(axios, 'get').mockResolvedValue({ data } as any)
    }

    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = OURS
    })

    afterEach(() => {
      process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV
      jest.restoreAllMocks()
    })

    it('rejects a token minted for a different OAuth client', async () => {
      const ctx = build()
      stageTokenInfo({
        aud: 'someone-elses-client.apps.googleusercontent.com',
        email: 'victim@example.com',
        email_verified: 'true',
        sub: 'g1',
      })

      await expect(ctx.service.loginWithGoogle('tok')).rejects.toThrow(
        HttpException,
      )
      expect(ctx.usersService.findOne).not.toHaveBeenCalled()
    })

    it('rejects a token whose email is not verified', async () => {
      const ctx = build()
      stageTokenInfo({
        aud: OURS,
        email: 'victim@example.com',
        email_verified: 'false',
        sub: 'g1',
      })

      await expect(ctx.service.loginWithGoogle('tok')).rejects.toThrow(
        HttpException,
      )
      expect(ctx.usersService.findOne).not.toHaveBeenCalled()
    })

    it('accepts our own audience with a verified email', async () => {
      const ctx = build()
      stageTokenInfo({
        aud: OURS,
        email: 'ada@example.com',
        email_verified: 'true',
        sub: 'g1',
        name: 'Ada',
      })
      ctx.usersService.findOne.mockResolvedValue({
        _id: 'user_1',
        email: 'ada@example.com',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ _id: 'user_1', email: 'ada@example.com' }),
      })

      const result = await ctx.service.loginWithGoogle('tok')

      expect(result.accessToken).toBe('signed-jwt')
    })

    it('records the browser for a returning account', async () => {
      const ctx = build()
      stageTokenInfo({
        aud: OURS,
        email: 'ada@example.com',
        email_verified: 'true',
        sub: 'g1',
        name: 'Ada',
      })
      const existing = {
        _id: 'user_1',
        email: 'ada@example.com',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ _id: 'user_1', email: 'ada@example.com' }),
      }
      ctx.usersService.findOne.mockResolvedValue(existing)

      await ctx.service.loginWithGoogle('tok', { userAgent: BROWSER_UA })

      expect(ctx.usersService.touchClient).toHaveBeenCalledWith(
        existing,
        BROWSER_UA,
      )
      expect(existing.save).toHaveBeenCalledTimes(1)
    })

    it('leaves a new account to the client recorded at signup', async () => {
      const ctx = build()
      stageTokenInfo({
        aud: OURS,
        email: 'ada@example.com',
        email_verified: 'true',
        sub: 'g1',
        name: 'Ada',
      })
      ctx.usersService.findOne.mockResolvedValue(null)
      ctx.usersService.create.mockResolvedValue({
        _id: 'user_1',
        email: 'ada@example.com',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: () => ({ _id: 'user_1', email: 'ada@example.com' }),
      })

      await ctx.service.loginWithGoogle('tok', { userAgent: BROWSER_UA })

      expect(ctx.usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: BROWSER_UA }),
      )
      expect(ctx.usersService.touchClient).not.toHaveBeenCalled()
    })
  })
})

describe('AuthService account emails', () => {
  const setup = (recentCount = 0) => {
    const saved: any[] = []
    const emailVerificationModel: any = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn(async () => saved.push(doc)),
    }))
    emailVerificationModel.countDocuments = jest.fn().mockResolvedValue(recentCount)
    const mailService = { sendTemplated: jest.fn().mockResolvedValue('sent') }
    const service = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      emailVerificationModel,
      mailService as any,
      {} as any,
      {} as any,
      {} as any,
    )
    return { service, emailVerificationModel, mailService, saved }
  }
  const user: any = { _id: '507f1f77bcf86cd799439011', email: 'a@example.com' }

  it('sends T1 with a 20 minute link and leaves reminders out of the resend cap', async () => {
    const { service, emailVerificationModel, mailService, saved } = setup()

    await service.sendEmailVerificationEmail(user)

    expect(emailVerificationModel.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ source: { $ne: 'reminder' } }),
    )
    const expiresIn = saved[0].expiresAt.getTime() - Date.now()
    expect(expiresIn).toBeGreaterThan(19 * 60 * 1000)
    expect(expiresIn).toBeLessThanOrEqual(20 * 60 * 1000)
    expect(saved[0].source).toBeUndefined()
    expect(mailService.sendTemplated).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'T1',
        vars: expect.objectContaining({ linkTtl: '20 minutes' }),
        redactVars: ['verificationUrl'],
      }),
    )
  })

  it('still caps manual resends at five a day', async () => {
    const { service, mailService } = setup(5)

    await expect(service.sendEmailVerificationEmail(user)).rejects.toMatchObject({
      status: 429,
    })
    expect(mailService.sendTemplated).not.toHaveBeenCalled()
  })

  it('mints a reminder link with its own lifetime and marker', async () => {
    const { service, saved } = setup()

    const url = await service.mintEmailVerificationLink(user, user.email, {
      lifetimeMs: 24 * 3600 * 1000,
      source: 'reminder',
    })

    expect(url).toContain(`/verify-email?userId=${user._id}&verificationCode=`)
    expect(saved[0].source).toBe('reminder')
    expect(saved[0].email).toBe(user.email)
    expect(saved[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600 * 1000)
  })
})

describe('AuthService email trimming', () => {
  const newUserDoc = () => ({
    _id: 'user_1',
    email: 'ada@example.com',
    save: jest.fn().mockResolvedValue(undefined),
    toObject: () => ({ _id: 'user_1', email: 'ada@example.com' }),
  })

  const signup = {
    name: 'Ada',
    email: '  ada@example.com  ',
    password: 'a-valid-password',
    turnstileToken: 'token',
  }

  it('register uses the trimmed email for the lookup and the stored value', async () => {
    const ctx = build()
    ctx.usersService.findOne.mockResolvedValue(null)
    ctx.usersService.create.mockResolvedValue(newUserDoc())
    jest.spyOn(ctx.service, 'sendEmailVerificationEmail').mockResolvedValue({
      message: 'Email verification email sent',
    })

    await ctx.service.register(signup)

    expect(ctx.usersService.findOne).toHaveBeenCalledWith({
      email: 'ada@example.com',
    })
    expect(ctx.usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com' }),
    )
  })

  it('register answers the normal 400 for an existing address with surrounding spaces', async () => {
    const ctx = build()
    ctx.usersService.findOne.mockImplementation(async ({ email }) =>
      email === 'ada@example.com' ? newUserDoc() : null,
    )

    await expect(ctx.service.register(signup)).rejects.toMatchObject({
      status: 400,
      response: { error: 'User already exists, please login instead' },
    })
    expect(ctx.usersService.create).not.toHaveBeenCalled()
  })

  it.each([
    ['an object', { $ne: null }],
    ['a number', 42],
    ['a missing value', undefined],
  ])('login answers 401 for %s as the email without a lookup', async (_n, email) => {
    const ctx = build()

    await expect(
      ctx.service.login({ email, password: 'right', turnstileToken: 'token' }),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'Invalid credentials' },
    })
    expect(ctx.usersService.findOneWithPassword).not.toHaveBeenCalled()
  })

  it.each([
    ['an object', { $ne: null }],
    ['a number', 42],
    ['a missing value', undefined],
  ])('register answers 400 for %s as the email without a lookup', async (_n, email) => {
    const ctx = build()

    await expect(ctx.service.register({ ...signup, email })).rejects.toMatchObject({
      status: 400,
      response: { error: 'Invalid email' },
    })
    expect(ctx.usersService.findOne).not.toHaveBeenCalled()
    expect(ctx.usersService.create).not.toHaveBeenCalled()
  })

  it('login looks the account up by the trimmed email', async () => {
    const ctx = build()
    ctx.usersService.findOneWithPassword.mockResolvedValue({
      ...newUserDoc(),
      password: bcrypt.hashSync('right', 4),
    })

    await ctx.service.login({
      email: ' ada@example.com ',
      password: 'right',
      turnstileToken: 'token',
    })

    expect(ctx.usersService.findOneWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
    })
  })
})

describe('AuthService verifyEmail', () => {
  const USER_ID = '507f1f77bcf86cd799439011'
  const CODE = 'the-code'
  const HASH = bcrypt.hashSync(CODE, 4)
  const STALE = {
    status: 400,
    response: {
      error: 'This link is for a previous email address. Request a new link.',
    },
  }

  const setup = ({
    link,
    user = {},
    laterChange = false,
  }: {
    link: Record<string, unknown>
    user?: Record<string, unknown>
    laterChange?: boolean
  }) => {
    const ctx = build()
    ctx.usersService.findOne.mockResolvedValue({
      _id: USER_ID,
      email: 'new@example.com',
      emailVerifiedAt: undefined,
      save: jest.fn(),
      ...user,
    })
    ctx.emailVerificationModel.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue({
        verificationCode: HASH,
        createdAt: new Date('2026-11-11T10:00:00Z'),
        ...link,
      }),
    })
    ctx.emailHistoryModel.exists.mockResolvedValue(
      laterChange ? { _id: 'h1' } : null,
    )
    return ctx
  }

  const verify = (ctx: ReturnType<typeof build>, code = CODE) =>
    ctx.service.verifyEmail({ userId: USER_ID, verificationCode: code })

  it('verifies with a link for the current address, conditional on that address', async () => {
    const ctx = setup({ link: { email: 'new@example.com' } })

    await expect(verify(ctx)).resolves.toEqual({
      message: 'Email verified successfully',
    })
    expect(ctx.usersService.markEmailVerified).toHaveBeenCalledWith(
      USER_ID,
      'new@example.com',
    )
  })

  it('rejects a wrong code', async () => {
    const ctx = setup({ link: { email: 'new@example.com' } })

    await expect(verify(ctx, 'wrong')).rejects.toMatchObject({
      status: 400,
      response: { error: 'Invalid verification code' },
    })
    expect(ctx.usersService.markEmailVerified).not.toHaveBeenCalled()
  })

  it('answers already verified for a verified account', async () => {
    const ctx = setup({
      link: { email: 'new@example.com' },
      user: { emailVerifiedAt: new Date() },
    })

    await expect(verify(ctx)).resolves.toEqual({
      message: 'Email already verified',
    })
    expect(ctx.usersService.markEmailVerified).not.toHaveBeenCalled()
  })

  it('rejects a link bound to a previous address', async () => {
    const ctx = setup({ link: { email: 'old@example.con' } })

    await expect(verify(ctx)).rejects.toMatchObject(STALE)
    expect(ctx.usersService.markEmailVerified).not.toHaveBeenCalled()
  })

  it('accepts a link without an address when the email has not changed since', async () => {
    const ctx = setup({ link: {} })

    await expect(verify(ctx)).resolves.toEqual({
      message: 'Email verified successfully',
    })
    expect(ctx.emailHistoryModel.exists).toHaveBeenCalledWith({
      user: USER_ID,
      changedAt: { $gt: new Date('2026-11-11T10:00:00Z') },
    })
    expect(ctx.usersService.markEmailVerified).toHaveBeenCalledWith(
      USER_ID,
      'new@example.com',
    )
  })

  it('rejects a link without an address when the email changed after it was made', async () => {
    const ctx = setup({ link: {}, laterChange: true })

    await expect(verify(ctx)).rejects.toMatchObject(STALE)
    expect(ctx.usersService.markEmailVerified).not.toHaveBeenCalled()
  })

  it('does not verify when the email changed between the read and the write', async () => {
    const ctx = setup({ link: { email: 'new@example.com' } })
    ctx.usersService.markEmailVerified.mockResolvedValue(false)
    ctx.usersService.findOne
      .mockResolvedValueOnce({
        _id: USER_ID,
        email: 'new@example.com',
        save: jest.fn(),
      })
      .mockResolvedValueOnce({
        _id: USER_ID,
        email: 'other@example.com',
        emailVerifiedAt: undefined,
      })

    await expect(verify(ctx)).rejects.toMatchObject(STALE)
  })

  it('answers already verified when the account was verified before the write', async () => {
    const ctx = setup({ link: { email: 'new@example.com' } })
    ctx.usersService.markEmailVerified.mockResolvedValue(false)
    ctx.usersService.findOne
      .mockResolvedValueOnce({
        _id: USER_ID,
        email: 'new@example.com',
        save: jest.fn(),
      })
      .mockResolvedValueOnce({
        _id: USER_ID,
        email: 'new@example.com',
        emailVerifiedAt: new Date(),
      })

    await expect(verify(ctx)).resolves.toEqual({
      message: 'Email already verified',
    })
  })
})

describe('AuthService verification resend limits', () => {
  const DAY = 24 * 3600 * 1000
  type Row = { email?: string; source?: string; createdAt: Date }

  // Applies the user, window, source and email filters the service sends.
  const setup = (rows: Row[]) => {
    const matches = (row: Row, filter: any) => {
      if (row.createdAt < filter.createdAt.$gte) return false
      if (row.source === 'reminder') return false
      if (filter.email === undefined) return true
      if (typeof filter.email === 'string') return row.email === filter.email
      return filter.email.$in.includes(row.email ?? null)
    }
    const emailVerificationModel: any = jest.fn().mockImplementation((doc) => ({
      save: jest.fn(async () => rows.push({ ...doc, createdAt: new Date() })),
    }))
    emailVerificationModel.countDocuments = jest.fn(
      async (filter) => rows.filter((row) => matches(row, filter)).length,
    )
    const mailService = { sendTemplated: jest.fn().mockResolvedValue('sent') }
    const service = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      emailVerificationModel,
      mailService as any,
      {} as any,
      {} as any,
      {} as any,
    )
    return { service, rows, mailService }
  }
  const recent = (email?: string, source?: string): Row => ({
    email,
    source,
    createdAt: new Date(Date.now() - 60 * 1000),
  })
  const old: any = { _id: 'user_1', email: 'bob@gmail.con' }
  const fixed: any = { _id: 'user_1', email: 'bob@gmail.com' }
  const TOO_MANY = { status: 429 }

  it('allows five per address and refuses the sixth', async () => {
    const { service, mailService } = setup(
      Array.from({ length: 4 }, () => recent('bob@gmail.con')),
    )

    await service.sendEmailVerificationEmail(old)
    await expect(service.sendEmailVerificationEmail(old)).rejects.toMatchObject(
      TOO_MANY,
    )
    expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
  })

  it('counts rows without an address for the current address', async () => {
    const { service } = setup([
      ...Array.from({ length: 3 }, () => recent()),
      ...Array.from({ length: 2 }, () => recent('bob@gmail.con')),
    ])

    await expect(service.sendEmailVerificationEmail(old)).rejects.toMatchObject(
      TOO_MANY,
    )
  })

  it('leaves reminder links out of both limits', async () => {
    const { service, mailService } = setup([
      ...Array.from({ length: 4 }, () => recent('bob@gmail.con')),
      ...Array.from({ length: 6 }, () => recent('bob@gmail.con', 'reminder')),
    ])

    await service.sendEmailVerificationEmail(old)
    expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
  })

  it('ignores rows older than a day', async () => {
    const { service, mailService } = setup(
      Array.from({ length: 8 }, () => ({
        email: 'bob@gmail.con',
        createdAt: new Date(Date.now() - DAY - 60 * 1000),
      })),
    )

    await service.sendEmailVerificationEmail(old)
    expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
  })

  it('makes the change email the first for the new address, up to eight a day in all', async () => {
    const { service, rows, mailService } = setup(
      Array.from({ length: 5 }, () => recent('bob@gmail.con')),
    )
    await expect(service.sendEmailVerificationEmail(old)).rejects.toMatchObject(
      TOO_MANY,
    )

    await expect(service.sendVerificationLink(old, 'bob@gmail.com')).resolves.toBe(
      'sent',
    )
    expect(rows[5].email).toBe('bob@gmail.com')
    expect(mailService.sendTemplated).toHaveBeenLastCalledWith(
      expect.objectContaining({ key: 'T1', to: 'bob@gmail.com' }),
    )

    await service.sendEmailVerificationEmail(fixed)
    await service.sendEmailVerificationEmail(fixed)
    await expect(service.sendEmailVerificationEmail(fixed)).rejects.toMatchObject(
      TOO_MANY,
    )
    expect(rows.filter((row) => row.email === 'bob@gmail.com')).toHaveLength(3)
  })
})
