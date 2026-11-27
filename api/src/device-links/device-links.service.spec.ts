import { Logger } from '@nestjs/common'
import { ThrottlerStorageService } from '@nestjs/throttler'
import { Types } from 'mongoose'
import { setPlatformValues } from '../gateway/app-settings'
import { TEXTS, m2Text } from './device-link-choices'
import * as input from './device-link-input'
import {
  DeviceLinksService,
  ERRORS,
  MAX_PENDING,
  POLL_TEXTS,
} from './device-links.service'

// An in-memory collection with the filter and update operators the service
// uses. Each call runs to its end before it returns, like one database write.
type Row = Record<string, any>

const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date
    ? new Date(a as any).getTime() === new Date(b as any).getTime()
    : String(a) === String(b)

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return (condition as Row[]).some((part) => matches(row, part))
    const value = row[key]
    const isOperator =
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Date) &&
      !(condition instanceof Types.ObjectId) &&
      Object.keys(condition).some((name) => name.startsWith('$'))
    if (!isOperator) {
      if (condition === null) return value === null || value === undefined
      return value !== undefined && same(value, condition)
    }
    return Object.entries(condition).every(([op, arg]: [string, any]) => {
      switch (op) {
        case '$exists':
          return arg ? value !== undefined : value === undefined
        case '$ne':
          return value === undefined || !same(value, arg)
        case '$in':
          return (arg as unknown[]).some((entry) => same(value, entry))
        case '$gt':
          return value !== undefined && value !== null && value > arg
        case '$gte':
          return value !== undefined && value !== null && value >= arg
        case '$lt':
          return value !== undefined && value !== null && value < arg
        case '$lte':
          return value !== undefined && value !== null && value <= arg
        default:
          throw new Error(`operator ${op} not supported`)
      }
    })
  })
}

function applyUpdate(row: Row, update: Row, inserting: boolean) {
  const ops = Object.keys(update).some((key) => key.startsWith('$')) ? update : { $set: update }
  for (const [key, value] of Object.entries(ops.$set ?? {})) row[key] = value
  for (const [key, value] of Object.entries(ops.$inc ?? {})) row[key] = (row[key] ?? 0) + value
  if (inserting) for (const [key, value] of Object.entries(ops.$setOnInsert ?? {})) row[key] = value
  row.updatedAt = new Date()
}

class Query<T> implements PromiseLike<T> {
  constructor(private readonly run: () => T) {}
  lean() {
    return Promise.resolve(this.run())
  }
  then<A, B>(ok?: (value: T) => A | PromiseLike<A>, ko?: (reason: any) => B | PromiseLike<B>) {
    return Promise.resolve(this.run()).then(ok, ko)
  }
}

class FakeModel {
  rows: Row[] = []
  constructor(private readonly unique: string[] = []) {}

  private copy = (row: Row | undefined) => (row ? { ...row } : null)

  seed(...rows: Row[]) {
    for (const row of rows) {
      this.rows.push({ _id: new Types.ObjectId(), createdAt: new Date(), ...row })
    }
    return this.rows[this.rows.length - 1]
  }

  async create(doc: Row) {
    for (const field of this.unique) {
      if (this.rows.some((row) => doc[field] !== undefined && row[field] === doc[field])) {
        throw Object.assign(new Error(`E11000 duplicate key ${field}_1`), {
          code: 11000,
          keyPattern: { [field]: 1 },
        })
      }
    }
    const row = { _id: new Types.ObjectId(), createdAt: new Date(), updatedAt: new Date(), ...doc }
    this.rows.push(row)
    return { ...row }
  }

  findOne(filter: Row) {
    return new Query(() => this.copy(this.rows.find((row) => matches(row, filter))))
  }

  find(filter: Row) {
    return new Query(() => this.rows.filter((row) => matches(row, filter)).map((row) => ({ ...row })))
  }

  findOneAndUpdate(filter: Row, update: Row, options: Row = {}) {
    return new Query(() => {
      const row = this.rows.find((entry) => matches(entry, filter))
      if (!row) return null
      const before = { ...row }
      applyUpdate(row, update, false)
      return options.returnDocument === 'after' ? { ...row } : before
    })
  }

  async updateOne(filter: Row, update: Row, options: Row = {}) {
    const row = this.rows.find((entry) => matches(entry, filter))
    if (row) {
      applyUpdate(row, update, false)
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }
    }
    if (options.upsert) {
      const created: Row = { createdAt: new Date() }
      for (const [key, value] of Object.entries(filter)) {
        if (!key.startsWith('$')) created[key] = value
      }
      applyUpdate(created, update, true)
      this.rows.push(created)
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
  }

  findByIdAndUpdate(id: unknown, update: Row, options: Row = {}) {
    return this.findOneAndUpdate({ _id: id }, update, options)
  }

  async updateMany(filter: Row, update: Row) {
    const rows = this.rows.filter((entry) => matches(entry, filter))
    for (const row of rows) applyUpdate(row, update, false)
    return { matchedCount: rows.length, modifiedCount: rows.length }
  }

  async countDocuments(filter: Row) {
    return this.rows.filter((row) => matches(row, filter)).length
  }

  async distinct(field: string, filter: Row) {
    return [...new Set(this.rows.filter((row) => matches(row, filter)).map((row) => row[field]))]
  }

  async exists(filter: Row) {
    const row = this.rows.find((entry) => matches(entry, filter))
    return row ? { _id: row._id } : null
  }
}

const PHONE_IP = '203.0.113.5'
const OTHER_IP = '198.51.100.7'
const createBody = {
  deviceName: 'Google Pixel 8',
  brand: 'Google',
  manufacturer: 'Google',
  model: 'Pixel 8',
  appVersionCode: 23,
  appVersionName: '2.11.0',
  osApiLevel: 36,
}
const phoneRequest = (ip = PHONE_IP, headers: Row = {}): { ip: string; headers: Row } => ({
  ip,
  headers: { 'x-phone-id': 'raw-phone-id', 'x-app-signer': 'S1', 'x-install-id': 'i1', ...headers },
})
const browser = (ip = PHONE_IP) => ({ ip, headers: {} })

describe('DeviceLinksService', () => {
  let links: FakeModel
  let devices: FakeModel
  let apiKeys: FakeModel
  let storage: ThrottlerStorageService
  let limit: number
  let sendTemplated: jest.Mock
  let users: Map<string, Row>
  let service: DeviceLinksService
  let authService: {
    createSignInKey: jest.Mock
    revokeApiKeyIfLive: jest.Mock
    revokeOtherLinkKeys: jest.Mock
    isKeyLive: jest.Mock
  }
  let alice: Row
  let bob: Row

  const env = { ...process.env }

  // Freezes Date at a set time; timers and promises keep running
  const freezeClock = (at: Date) =>
    jest.useFakeTimers({
      now: at,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    })

  // Runs a test body without both hash secrets and puts back what was there
  const withoutSecrets = async (body: () => Promise<void>) => {
    const saved = {
      DEVICE_LINK_SECRET: process.env.DEVICE_LINK_SECRET,
      JWT_SECRET: process.env.JWT_SECRET,
    }
    delete process.env.DEVICE_LINK_SECRET
    delete process.env.JWT_SECRET
    try {
      await body()
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  }

  beforeEach(() => {
    jest.useRealTimers()
    process.env = { ...env }
    delete process.env.TRUSTED_PROXY
    delete process.env.APP_PUBLIC_URL
    process.env.DEVICE_LINK_SECRET = 'test-secret'
    setPlatformValues({ deviceLinksEnabled: true })
    links = new FakeModel(['code', 'pollTokenHash'])
    devices = new FakeModel()
    apiKeys = new FakeModel()
    storage = new ThrottlerStorageService()
    limit = -1
    sendTemplated = jest.fn().mockResolvedValue('sent')
    alice = { _id: new Types.ObjectId(), email: 'alice@example.com', emailVerifiedAt: new Date() }
    bob = { _id: new Types.ObjectId(), email: 'bob@example.com' }
    users = new Map([alice, bob].map((user) => [String(user._id), user]))
    let keyNumber = 0
    authService = {
      createSignInKey: jest.fn(async (userId, deviceId, name, deviceLink) => {
        const apiKey = `txb_key${++keyNumber}`
        const row = await apiKeys.create({
          apiKey,
          name,
          user: userId,
          source: 'device-link',
          linkedDevice: deviceId,
          deviceLink,
          // Keys are made one after another, never in the same instant
          createdAt: new Date(Date.UTC(2026, 0, 1) + keyNumber),
        })
        return { apiKey, id: row._id }
      }),
      // As in AuthService: only keys made before the kept one are revoked
      revokeOtherLinkKeys: jest.fn(async (deviceLink, keepId) => {
        const kept = apiKeys.rows.find((row) => same(row._id, keepId))
        if (!kept) return
        for (const row of apiKeys.rows) {
          if (
            same(row.deviceLink, deviceLink) &&
            !same(row._id, keepId) &&
            (row.createdAt < kept.createdAt ||
              (row.createdAt.getTime() === kept.createdAt.getTime() &&
                String(row._id) < String(kept._id))) &&
            !row.revokedAt
          ) {
            row.revokedAt = new Date()
          }
        }
      }),
      isKeyLive: jest.fn(async (id) =>
        apiKeys.rows.some((row) => same(row._id, id) && !row.revokedAt),
      ),
      revokeApiKeyIfLive: jest.fn(async (id) => {
        await apiKeys.updateOne({ _id: id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
      }),
    }
    service = new DeviceLinksService(
      links as any,
      devices as any,
      apiKeys as any,
      storage,
      authService as any,
      { getUserLimits: jest.fn(async () => ({ deviceLimit: limit })) } as any,
      {
        findOne: jest.fn(async ({ _id }) => users.get(String(_id)) ?? null),
        markMilestone: jest.fn().mockResolvedValue(true),
      } as any,
      { refreshQuietly: jest.fn() } as any,
      { sendTemplated } as any,
    )
  })

  afterEach(() => {
    storage.onApplicationShutdown()
    setPlatformValues({})
    process.env = { ...env }
    jest.restoreAllMocks()
  })

  const start = async (body: Row = createBody, req = phoneRequest()) => service.create(body, req)
  const linkOf = (code: string) => links.rows.find((row) => row.code === code.replace('-', ''))
  const liveKeys = () => apiKeys.rows.filter((row) => !row.revokedAt)
  const backdate = (row: Row, field: string, ms: number) => {
    row[field] = new Date(row[field].getTime() - ms)
  }
  const poll = async (pollToken: string, gapMs = 2000) => {
    // Each poll comes after the minimum gap unless a test says otherwise
    for (const row of links.rows) if (row.lastPolledAt) backdate(row, 'lastPolledAt', gapMs)
    return service.poll({ pollToken })
  }
  const status = (error: any) => ({ status: error.getStatus(), body: error.getResponse() })
  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise
    } catch (error) {
      return status(error)
    }
    throw new Error('expected a failure')
  }

  describe('switches', () => {
    it('refuses create while sign-in is off and the tester list is empty', async () => {
      setPlatformValues({})
      expect(await failure(start())).toEqual({
        status: 503,
        body: { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' },
      })
      expect(links.rows).toHaveLength(0)
    })

    it('lets testers use every route while sign-in is off', async () => {
      setPlatformValues({ deviceLinksTesters: `${alice._id},not-an-id` })
      const created = await start()
      expect((await service.lookup(alice as any, created.displayCode, browser())).status).toBe(
        'pending',
      )
      expect(await failure(service.lookup(bob as any, created.displayCode, browser()))).toEqual({
        status: 503,
        body: { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' },
      })
      expect(
        await failure(service.approve(bob as any, created.displayCode, { action: 'new' }, browser())),
      ).toMatchObject({ status: 503 })
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      expect((await poll(created.pollToken)).status).toBe('approved')
    })

    it('stays off without a secret for the server hashes', async () => {
      const created = await start()
      await withoutSecrets(async () => {
        const off = { status: 503, body: { error: ERRORS.off, code: 'DEVICE_LINKS_OFF' } }
        expect(await failure(start())).toEqual(off)
        expect(await failure(service.lookup(alice as any, created.displayCode, browser()))).toEqual(off)
        setPlatformValues({ deviceLinksTesters: String(alice._id) })
        expect(await failure(start())).toEqual(off)
        process.env.JWT_SECRET = 'jwt-secret'
        await expect(start()).resolves.toBeDefined()
      })
      expect(process.env.DEVICE_LINK_SECRET).toBe('test-secret')
    })

    it('tells the dashboard that sign-in is off without a secret', async () => {
      setPlatformValues({ deviceLinksEnabled: true, deviceLinksInDashboard: true, deviceLinksTesters: String(alice._id) })
      expect((await service.settings(alice as any)).enabled).toBe(true)
      await withoutSecrets(async () => {
        expect((await service.settings(alice as any)).enabled).toBe(false)
      })
    })

    it('refuses an app below the minimum version', async () => {
      setPlatformValues({ deviceLinksEnabled: true, deviceLinksMinVersionCode: 24 })
      expect(await failure(start())).toMatchObject({ status: 503, body: { code: 'DEVICE_LINKS_OFF' } })
    })

    it('lets poll and deny finish a sign-in after the switch goes off', async () => {
      const first = await start()
      const second = await start()
      setPlatformValues({})
      expect((await poll(first.pollToken)).status).toBe('pending')
      expect(await service.deny(alice as any, second.displayCode)).toEqual({ status: 'denied' })
    })

    it.each([
      [false, false, '', false],
      [true, false, '', false],
      [false, true, '', false],
      [true, true, '', true],
      [false, false, 'alice', true],
      [false, false, 'bob', false],
    ])(
      'settings with enabled %p, in dashboard %p, testers %p: enabled %p',
      async (enabled, inDashboard, tester, expected) => {
        setPlatformValues({
          deviceLinksEnabled: enabled,
          deviceLinksInDashboard: inDashboard,
          ...(tester && { deviceLinksTesters: String((tester === 'alice' ? alice : bob)._id) }),
        })
        expect((await service.settings(alice as any)).enabled).toBe(expected)
      },
    )
  })

  describe('create', () => {
    it('answers the documented shape and stores only hashes', async () => {
      setPlatformValues({ deviceLinksEnabled: true, deviceLinksAutoOpenBrowser: true })
      const before = Date.now()
      const created = await start()
      expect(created).toEqual({
        displayCode: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
        linkUrl: `https://app.textbee.dev/link-device?code=${created.displayCode}`,
        manualUrl: 'app.textbee.dev/link-device',
        pollToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        expiresAt: expect.any(String),
        pollIntervalSeconds: 3,
        autoOpenBrowser: true,
      })
      const expires = new Date(created.expiresAt).getTime()
      expect(expires - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 50)
      expect(expires - before).toBeLessThanOrEqual(10 * 60 * 1000 + 1000)

      const row = linkOf(created.displayCode)
      const stored = JSON.stringify(row)
      expect(stored).not.toContain(created.pollToken)
      expect(stored).not.toContain(PHONE_IP)
      expect(stored).not.toContain('raw-phone-id')
      expect(row).toMatchObject({
        status: 'pending',
        pollTokenHash: input.sha256(created.pollToken),
        netKind: 'v4',
        phoneSigner: 'S1',
        installId: 'i1',
        appVersionCode: 23,
      })
      expect(row.deleteAt.getTime() - row.expiresAt.getTime()).toBe(24 * 60 * 60 * 1000)
    })

    it('answers autoOpenBrowser false by default', async () => {
      expect((await start()).autoOpenBrowser).toBe(false)
    })

    it('stores the Device ID the phone sends', async () => {
      const created = await start({ ...createBody, deviceId: '665f1c2ab3d4e5f6a7b8c9d0' })
      expect(String(linkOf(created.displayCode).requestDeviceId)).toBe('665f1c2ab3d4e5f6a7b8c9d0')
    })

    it('answers 400 for bad phone details', async () => {
      expect(await failure(start({ ...createBody, model: '' }))).toEqual({
        status: 400,
        body: { error: ERRORS.invalidPhone },
      })
    })

    it('allows 60 a hour per address, counting IPv6 by its first 48 bits', async () => {
      for (let i = 0; i < 60; i++) await start(createBody, phoneRequest(`2001:db8:1:${i}::1`))
      expect(await failure(start(createBody, phoneRequest('2001:db8:1:ffff::9')))).toEqual({
        status: 429,
        body: { error: ERRORS.tooManyRequests },
      })
      await expect(start(createBody, phoneRequest('2001:db8:2::1'))).resolves.toBeDefined()
    })

    it('answers busy only above the pending limit', async () => {
      const future = new Date(Date.now() + 60_000)
      for (let i = 0; i < MAX_PENDING; i++) {
        links.rows.push({ _id: new Types.ObjectId(), status: 'pending', expiresAt: future })
      }
      await expect(start()).resolves.toBeDefined()
      expect(await failure(start())).toEqual({
        status: 503,
        body: { error: ERRORS.off, code: 'DEVICE_LINKS_BUSY' },
      })
    })

    it('makes another code on a collision, up to 5 times', async () => {
      links.seed({ code: 'AAAAAAAA', pollTokenHash: 'x' })
      const spy = jest.spyOn(input, 'newCode')
      spy.mockReturnValueOnce('AAAAAAAA').mockReturnValueOnce('BBBBBBBB')
      expect((await start()).displayCode).toBe('BBBB-BBBB')
      spy.mockReturnValue('AAAAAAAA')
      expect(await failure(start())).toMatchObject({ status: 503, body: { code: 'DEVICE_LINKS_BUSY' } })
      expect(spy).toHaveBeenCalledTimes(2 + 5)
    })
  })

  describe('poll table', () => {
    const approveNew = async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      return { created, row: linkOf(created.displayCode) }
    }

    it('answers 404 for an unknown token', async () => {
      expect(await failure(service.poll({ pollToken: 'x'.repeat(43) }))).toEqual({
        status: 404,
        body: { error: ERRORS.pollNotFound },
      })
      expect(await failure(service.poll({}))).toMatchObject({ status: 404 })
    })

    it('pending before expiresAt: pending', async () => {
      const created = await start()
      expect(await poll(created.pollToken)).toEqual({ status: 'pending', pollIntervalSeconds: 3 })
    })

    it('a poll faster than 1.5 seconds: pending with the normal interval, and no delivery', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      await service.poll({ pollToken: created.pollToken })
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      jest.setSystemTime(new Date(t0.getTime() + 1499))
      expect(await service.poll({ pollToken: created.pollToken })).toEqual({
        status: 'pending',
        pollIntervalSeconds: 3,
      })
      expect(apiKeys.rows).toHaveLength(0)
      expect(linkOf(created.displayCode).status).toBe('approved')
      jest.setSystemTime(new Date(t0.getTime() + 1500))
      expect((await service.poll({ pollToken: created.pollToken })).status).toBe('approved')
    })

    it('pending after expiresAt: expired, and stored as expired', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      jest.setSystemTime(new Date(t0.getTime() + 10 * 60 * 1000 - 1))
      expect((await service.poll({ pollToken: created.pollToken })).status).toBe('pending')
      jest.setSystemTime(new Date(t0.getTime() + 10 * 60 * 1000 + 2000))
      expect(await service.poll({ pollToken: created.pollToken })).toEqual({
        status: 'expired',
        message: POLL_TEXTS.expired,
      })
      expect(linkOf(created.displayCode).status).toBe('expired')
    })

    it('a poll that loses the expiry to an approval answers from the approved state', async () => {
      const created = await start()
      const row = linkOf(created.displayCode)
      backdate(row, 'expiresAt', 11 * 60 * 1000)
      // The poll read the request as pending; the approval landed before its expiry write
      const read = { ...row }
      Object.assign(row, {
        status: 'approved',
        user: alice._id,
        action: 'new',
        mode: 'choose',
        chosenName: 'Google Pixel 8',
        approvedAt: new Date(),
      })
      const answer = await (service as any).answerFor(read, new Date())
      expect(answer.status).toBe('approved')
      expect(row.status).toBe('delivered')
    })

    it('denied: denied', async () => {
      const created = await start()
      await service.deny(alice as any, created.displayCode)
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: POLL_TEXTS.denied })
    })

    it('approved within 30 minutes: makes the device and the key, sends the email', async () => {
      const { created, row } = await approveNew()
      backdate(row, 'approvedAt', 29 * 60 * 1000)
      const answer = await poll(created.pollToken)
      const device = devices.rows[0]
      expect(answer).toEqual({
        status: 'approved',
        apiKey: 'txb_key1',
        deviceId: String(device._id),
        deviceName: 'Google Pixel 8',
        accountEmail: 'a***@example.com',
        reconnected: false,
        enable: true,
      })
      expect(device).toMatchObject({
        user: alice._id,
        enabled: true,
        isDefault: true,
        name: 'Google Pixel 8',
        brand: 'Google',
        model: 'Pixel 8',
        appVersionCode: 23,
      })
      expect(device.fcmToken).toBeUndefined()
      expect(apiKeys.rows[0]).toMatchObject({
        source: 'device-link',
        name: 'Phone sign-in: Google Pixel 8',
        user: alice._id,
      })
      expect(String(apiKeys.rows[0].linkedDevice)).toBe(String(device._id))
      expect(row).toMatchObject({ status: 'delivered', apiKeyId: apiKeys.rows[0]._id })
      expect(sendTemplated).toHaveBeenCalledTimes(1)
      expect(sendTemplated.mock.calls[0][0]).toMatchObject({
        key: 'T4',
        userId: alice._id,
        vars: {
          deviceName: 'Google Pixel 8',
          requestedFrom: 'Unknown place',
          action: 'added as a new device',
          keyName: 'Phone sign-in: Google Pixel 8',
          connectedAt: expect.stringMatching(/ UTC$/),
        },
      })
    })

    it('approved more than 30 minutes ago: expired, and no key', async () => {
      const { created, row } = await approveNew()
      backdate(row, 'approvedAt', 31 * 60 * 1000)
      expect((await poll(created.pollToken)).status).toBe('expired')
      expect(apiKeys.rows).toHaveLength(0)
      expect(sendTemplated).not.toHaveBeenCalled()
    })

    it('delivering past the 30 minute collect window: expired, and no key', async () => {
      const { created, row } = await approveNew()
      backdate(row, 'approvedAt', 31 * 60 * 1000)
      Object.assign(row, { status: 'delivering', deliveringAt: new Date(Date.now() - 60_000) })
      expect((await poll(created.pollToken)).status).toBe('expired')
      // A stale read that reaches the claim cannot take it over either
      expect((await (service as any).deliver({ ...row }, new Date())).status).toBe('pending')
      expect(apiKeys.rows).toHaveLength(0)
      expect(devices.rows).toHaveLength(0)
    })

    it('delivering younger than 30 seconds: pending', async () => {
      const { created, row } = await approveNew()
      Object.assign(row, { status: 'delivering', deliveringAt: new Date(Date.now() - 10_000) })
      expect((await poll(created.pollToken)).status).toBe('pending')
    })

    it('delivering older: repeats the steps without a second device', async () => {
      const { created, row } = await approveNew()
      // A delivery that stopped after the device was made and before the key was saved
      const deviceId = new Types.ObjectId()
      devices.seed({ _id: deviceId, user: alice._id, name: 'Google Pixel 8', enabled: true })
      Object.assign(row, {
        status: 'delivering',
        deliveringAt: new Date(Date.now() - 31_000),
        deviceId,
      })
      const answer = await poll(created.pollToken)
      expect(answer).toMatchObject({ status: 'approved', deviceId: String(deviceId) })
      expect(devices.rows).toHaveLength(1)
      expect(liveKeys()).toHaveLength(1)
    })

    it('delivered within 2 minutes: a fresh key, the old one revoked, at most 3 times', async () => {
      const { created } = await approveNew()
      const first = await poll(created.pollToken)
      const answers = []
      for (let i = 0; i < 4; i++) answers.push(await poll(created.pollToken))
      expect(answers.map((answer) => answer.status)).toEqual([
        'approved',
        'approved',
        'approved',
        'expired',
      ])
      expect(new Set([first, ...answers.slice(0, 3)].map((answer) => answer.apiKey)).size).toBe(4)
      expect(answers.slice(0, 3).every((answer) => answer.deviceId === first.deviceId)).toBe(true)
      expect(liveKeys().map((key) => key.apiKey)).toEqual([answers[2].apiKey])
      expect(devices.rows).toHaveLength(1)
      expect(sendTemplated).toHaveBeenCalledTimes(1)
    })

    it('delivered more than 2 minutes ago, and completed: expired', async () => {
      const { created, row } = await approveNew()
      await poll(created.pollToken)
      backdate(row, 'deliveredAt', 2 * 60 * 1000 + 1000)
      expect((await poll(created.pollToken)).status).toBe('expired')
      row.deliveredAt = new Date()
      row.status = 'completed'
      expect((await poll(created.pollToken)).status).toBe('expired')
      expect(liveKeys()).toHaveLength(1)
    })

    it('a request stored as expired: expired', async () => {
      const created = await start()
      linkOf(created.displayCode).status = 'expired'
      expect((await poll(created.pollToken)).status).toBe('expired')
    })
  })

  describe('key delivery', () => {
    it('denies a new device when the limit was reached after approval', async () => {
      limit = 1
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      devices.seed({ user: alice._id, enabled: true, brand: 'x', model: 'y' })
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: m2Text(1) })
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: m2Text(1) })
      expect(apiKeys.rows).toHaveLength(0)
      expect(devices.rows).toHaveLength(1)
    })

    // A copy of the fields delivery must never change on an existing device
    const flags = (row: Row) => ({ isDefault: row.isDefault, enabled: row.enabled })

    it('makes a second device not the default and leaves a default device as it was', async () => {
      const old = devices.seed({ user: alice._id, enabled: true, isDefault: true, brand: 'x', model: 'y' })
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const answer = await poll(created.pollToken)
      const added = devices.rows.find((row) => String(row._id) === answer.deviceId)
      expect(added.isDefault).toBe(false)
      expect(flags(old)).toEqual({ isDefault: true, enabled: true })
    })

    it('touches no existing device when the account has no default', async () => {
      const now = Date.now()
      const older = devices.seed({ user: alice._id, enabled: true, lastHeartbeat: new Date(now - 60_000) })
      const newer = devices.seed({ user: alice._id, enabled: true, lastHeartbeat: new Date(now - 1_000) })
      const off = devices.seed({ user: alice._id, enabled: false, lastHeartbeat: new Date(now) })
      const before = [older, newer, off].map(flags)
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const answer = await poll(created.pollToken)
      const added = devices.rows.find((row) => String(row._id) === answer.deviceId)
      expect(added.isDefault).toBe(false)
      expect([older, newer, off].map(flags)).toEqual(before)
    })

    it('touches no existing device when the only default is turned off', async () => {
      const offDefault = devices.seed({ user: alice._id, enabled: false, isDefault: true })
      const sending = devices.seed({ user: alice._id, enabled: true, lastHeartbeat: new Date() })
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      await poll(created.pollToken)
      expect(flags(offDefault)).toEqual({ isDefault: true, enabled: false })
      expect(flags(sending)).toEqual({ isDefault: undefined, enabled: true })
    })

    it('reconnects a chosen device and keeps its enabled state in mode reconnect-only', async () => {
      const deviceId = new Types.ObjectId()
      devices.seed({
        _id: deviceId,
        user: alice._id,
        name: 'Shop phone',
        brand: 'Google',
        model: 'Pixel 8',
        enabled: false,
        phoneId: input.serverHash('phone', 'raw-phone-id'),
        phoneSigner: 'S1',
        phoneIdSource: 'sign-in',
      })
      const created = await start({ ...createBody, deviceId: String(deviceId) })
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup).toMatchObject({ mode: 'reconnect-only', suggested: String(deviceId) })
      await service.approve(
        alice as any,
        created.displayCode,
        { action: 'reconnect', deviceId: String(deviceId) },
        browser(),
      )
      const answer = await poll(created.pollToken)
      expect(answer).toMatchObject({
        status: 'approved',
        deviceId: String(deviceId),
        deviceName: 'Shop phone',
        reconnected: true,
        enable: false,
      })
      expect(devices.rows).toHaveLength(1)
      expect(devices.rows[0].enabled).toBe(false)
      expect(sendTemplated.mock.calls[0][0].vars.action).toBe('took the place of Shop phone')
    })

    it('denies a reconnect whose device was deleted after approval', async () => {
      const device = devices.seed({ user: alice._id, brand: 'Google', model: 'Pixel 8', enabled: true })
      const created = await start()
      await service.approve(
        alice as any,
        created.displayCode,
        { action: 'reconnect', deviceId: String(device._id) },
        browser(),
      )
      devices.rows = []
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: POLL_TEXTS.denied })
      expect(apiKeys.rows).toHaveLength(0)
    })

    it('keeps a limit text for a limit denial when the limit can no longer be read', async () => {
      limit = 1
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      devices.seed({ user: alice._id, enabled: true, brand: 'x', model: 'y' })
      expect((await poll(created.pollToken)).message).toBe(m2Text(1))
      limit = -1
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: POLL_TEXTS.limit })
    })

    it.each([
      ['banned', { isBanned: true }],
      ['marked for deletion', { accountDeletionRequestedAt: new Date() }],
    ])('refuses delivery to an account %s after approval', async (_name, change) => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      Object.assign(alice, change)
      const denied = { status: 'denied', message: ERRORS.cannotConnect }
      expect(await poll(created.pollToken)).toEqual(denied)
      expect(await poll(created.pollToken)).toEqual(denied)
      expect(apiKeys.rows).toHaveLength(0)
      expect(devices.rows).toHaveLength(0)
    })

    it('refuses a repeat to an account banned after delivery', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      await poll(created.pollToken)
      alice.isBanned = true
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: ERRORS.cannotConnect })
      expect(liveKeys()).toHaveLength(0)
    })

    it('ties each key to its request and revokes keys a stopped delivery left behind', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const row = linkOf(created.displayCode)
      // Left by a stopped delivery, so made before the key handed out now
      const before = new Date(Date.UTC(2025, 0, 1))
      const stray = apiKeys.seed({ user: alice._id, source: 'device-link', deviceLink: row._id, createdAt: before })
      const other = apiKeys.seed({
        user: alice._id,
        source: 'device-link',
        deviceLink: new Types.ObjectId(),
        createdAt: before,
      })
      const answer = await poll(created.pollToken)
      expect(String(apiKeys.rows.find((key) => key.apiKey === answer.apiKey).deviceLink)).toBe(
        String(row._id),
      )
      expect(stray.revokedAt).toBeInstanceOf(Date)
      expect(other.revokedAt).toBeUndefined()

      const again = apiKeys.seed({ user: alice._id, source: 'device-link', deviceLink: row._id, createdAt: before })
      const repeated = await poll(created.pollToken)
      expect(again.revokedAt).toBeInstanceOf(Date)
      expect(liveKeys()).toHaveLength(2)
      expect(liveKeys()).toContain(other)
      expect(liveKeys().some((key) => key.apiKey === repeated.apiKey)).toBe(true)
    })

    it('starts the repeat window when the key is stored', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      // The key takes 5 seconds to make
      const real = authService.createSignInKey.getMockImplementation()!
      authService.createSignInKey.mockImplementationOnce(async (...args: unknown[]) => {
        jest.setSystemTime(new Date(t0.getTime() + 5000))
        return real(...args)
      })
      jest.setSystemTime(new Date(t0.getTime() + 2000))
      await service.poll({ pollToken: created.pollToken })
      expect(linkOf(created.displayCode).deliveredAt).toEqual(new Date(t0.getTime() + 5000))
    })

    it('sends the email and hands the key over when the cleanup of other keys fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      authService.revokeOtherLinkKeys.mockRejectedValue(new Error('down'))
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const answer = await poll(created.pollToken)
      expect(answer.status).toBe('approved')
      expect(sendTemplated).toHaveBeenCalledTimes(1)
    })

    it('hands nothing out when another key is current, even if the cleanup fails', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const first = await poll(created.pollToken)
      const row = linkOf(created.displayCode)
      const mine = apiKeys.rows.find((key) => key.apiKey === first.apiKey)._id
      row.apiKeyId = new Types.ObjectId()
      authService.revokeOtherLinkKeys.mockRejectedValueOnce(new Error('down'))
      await expect((service as any).keepCurrentKey(row._id, mine)).resolves.toBe(false)
    })

    it('hands nothing out when the request cannot be read', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const first = await poll(created.pollToken)
      const realFindOne = links.findOne.bind(links)
      jest.spyOn(links, 'findOne').mockImplementation((filter: Row, projection?: unknown) =>
        projection === 'apiKeyId'
          ? ({ lean: () => Promise.reject(new Error('down')) } as any)
          : realFindOne(filter),
      )
      expect(await poll(created.pollToken)).toEqual({ status: 'pending', pollIntervalSeconds: 3 })
      // The new key of that repeat is never handed out; the old one was revoked by the repeat
      expect(liveKeys().map((key) => key.apiKey)).not.toContain(first.apiKey)
    })

    it('checks the limit again when a retry finds a saved id but no device', async () => {
      limit = 1
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const row = linkOf(created.displayCode)
      // A delivery that stopped after saving the id and before making the device
      Object.assign(row, {
        status: 'delivering',
        deliveringAt: new Date(Date.now() - 31_000),
        deviceId: new Types.ObjectId(),
      })
      devices.seed({ user: alice._id, enabled: true, brand: 'x', model: 'y' })
      expect(await poll(created.pollToken)).toEqual({ status: 'denied', message: m2Text(1) })
      expect(devices.rows).toHaveLength(1)
      expect(apiKeys.rows).toHaveLength(0)
    })

    it('hands the key over when the email fails', async () => {
      sendTemplated.mockRejectedValue(new Error('smtp down'))
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      expect((await poll(created.pollToken)).status).toBe('approved')
    })

    it('names the place in the email', async () => {
      process.env.TRUSTED_PROXY = 'cloudflare'
      const created = await start(createBody, {
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': PHONE_IP, 'cf-ipcountry': 'CA', 'x-client-asn': '64500' },
      })
      const lookup = await service.lookup(alice as any, created.displayCode, {
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': PHONE_IP, 'cf-ipcountry': 'CA' },
      })
      expect(lookup).toMatchObject({
        requestedFrom: 'Canada (approximate)',
        browserFrom: 'Canada (approximate)',
        sameNetwork: true,
      })
      await service.approve(alice as any, created.displayCode, { action: 'new' }, {
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': PHONE_IP, 'cf-ipcountry': 'CA' },
      })
      await poll(created.pollToken)
      expect(sendTemplated.mock.calls[0][0].vars.requestedFrom).toBe('Canada (approximate)')
    })
  })

  describe('races', () => {
    it('approve and deny at once: exactly one wins', async () => {
      const created = await start()
      const results = await Promise.allSettled([
        service.approve(alice as any, created.displayCode, { action: 'new' }, browser()),
        service.deny(bob as any, created.displayCode),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(['approved', 'denied']).toContain(linkOf(created.displayCode).status)
    })

    it('two approvals at once: exactly one wins', async () => {
      const created = await start()
      const results = await Promise.allSettled([
        service.approve(alice as any, created.displayCode, { action: 'new' }, browser()),
        service.approve(bob as any, created.displayCode, { action: 'new' }, browser()),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    })

    // Holds the next key creation until release() is called
    const holdNextKey = () => {
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const real = authService.createSignInKey.getMockImplementation()!
      authService.createSignInKey.mockImplementationOnce(async (...args: unknown[]) => {
        await gate
        return real(...args)
      })
      return () => release()
    }

    it('two polls of one token at once: the second waits for the pace limit', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const answers = await Promise.all([
        service.poll({ pollToken: created.pollToken }),
        service.poll({ pollToken: created.pollToken }),
      ])
      expect(answers.map((answer) => answer.status).sort()).toEqual(['approved', 'pending'])
      expect(devices.rows).toHaveLength(1)
      expect(liveKeys()).toHaveLength(1)
    })

    it('two deliveries from one stale read: one device and one live key', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const stale = { ...linkOf(created.displayCode) }
      const now = new Date()
      const answers = await Promise.all([
        (service as any).deliver(stale, now),
        (service as any).deliver(stale, now),
      ])
      expect(answers.map((answer: Row) => answer.status).sort()).toEqual(['approved', 'pending'])
      expect(devices.rows).toHaveLength(1)
      expect(liveKeys()).toHaveLength(1)
    })

    it('a stopped delivery taken over after 30 seconds: only the newer key stays live', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      const release = holdNextKey()
      const slow = poll(created.pollToken)
      await new Promise((resolve) => setImmediate(resolve))
      const row = linkOf(created.displayCode)
      expect(row.status).toBe('delivering')
      backdate(row, 'deliveringAt', 31_000)
      const taken = await poll(created.pollToken)
      release()
      expect(taken.status).toBe('approved')
      expect((await slow).status).toBe('pending')
      expect(liveKeys().map((key) => key.apiKey)).toEqual([taken.apiKey])
      expect(String(row.apiKeyId)).toBe(String(liveKeys()[0]._id))
      expect(devices.rows).toHaveLength(1)
    })

    it('a repeat that saved and paused does not revoke the key a later repeat handed out', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      await poll(created.pollToken)
      const row = linkOf(created.displayCode)
      // Repeat A pauses right after it saved its key, before its cleanup reads the request
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const realFindOne = links.findOne.bind(links)
      let paused = false
      jest.spyOn(links, 'findOne').mockImplementation((filter: Row, projection?: unknown) => {
        if (projection === 'apiKeyId' && !paused) {
          paused = true
          return { lean: () => gate.then(() => realFindOne(filter).lean()) } as any
        }
        return realFindOne(filter)
      })
      const first = (service as any).repeat({ ...row })
      while (!paused) await new Promise((resolve) => setImmediate(resolve))
      const second = await (service as any).repeat({ ...row, repeatCount: 1 })
      release()
      expect(second.status).toBe('approved')
      expect((await first).status).toBe('pending')
      expect(liveKeys().map((key) => key.apiKey)).toEqual([second.apiKey])
      expect(String(row.apiKeyId)).toBe(String(liveKeys()[0]._id))
    })

    it('a repeat that read itself as current and then stalled never revokes the newer key', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      await poll(created.pollToken)
      const row = linkOf(created.displayCode)
      // Repeat A stalls in its cleanup, after it read its own key as current
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const realRevoke = authService.revokeOtherLinkKeys.getMockImplementation()!
      authService.revokeOtherLinkKeys.mockImplementationOnce(async (...args: unknown[]) => {
        await gate
        return realRevoke(...args)
      })
      const callsBefore = authService.revokeOtherLinkKeys.mock.calls.length
      const first = (service as any).repeat({ ...row })
      while (authService.revokeOtherLinkKeys.mock.calls.length === callsBefore) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const second = await (service as any).repeat({ ...row, repeatCount: 1 })
      release()
      expect(second.status).toBe('approved')
      // A's key was revoked by B's claim, so A hands nothing out
      expect((await first).status).toBe('pending')
      expect(liveKeys().map((key) => key.apiKey)).toEqual([second.apiKey])
    })

    it('two repeats that both claimed: only the key of the last claim stays live', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      await poll(created.pollToken)
      const row = linkOf(created.displayCode)
      const release = holdNextKey()
      const first = (service as any).repeat({ ...row })
      await new Promise((resolve) => setImmediate(resolve))
      const second = await (service as any).repeat({ ...row, repeatCount: 1 })
      release()
      expect(second.status).toBe('approved')
      expect((await first).status).toBe('pending')
      expect(liveKeys().map((key) => key.apiKey)).toEqual([second.apiKey])
      expect(String(row.apiKeyId)).toBe(String(liveKeys()[0]._id))
    })

    it('deny after approve: 404, and the approval stays', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      expect(await failure(service.deny(alice as any, created.displayCode))).toMatchObject({
        status: 404,
      })
      expect(linkOf(created.displayCode).status).toBe('approved')
    })
  })

  describe('lookup and approve', () => {
    it('counts the seconds left on the server, rounded down and never below zero', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      const left = async () =>
        (await service.lookup(alice as any, created.displayCode, browser())).secondsLeft
      expect(await left()).toBe(600)
      jest.setSystemTime(new Date(t0.getTime() + 1500))
      expect(await left()).toBe(598)
      jest.setSystemTime(new Date(t0.getTime() + 10 * 60 * 1000 - 1))
      expect(await left()).toBe(0)
      // A user who approved still sees the request after its deadline
      jest.setSystemTime(new Date(t0.getTime() + 5 * 60 * 1000))
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      jest.setSystemTime(new Date(t0.getTime() + 20 * 60 * 1000))
      const after = await service.lookup(alice as any, created.displayCode, browser())
      expect(after).toMatchObject({ status: 'approved', secondsLeft: 0, expiresAt: created.expiresAt })
    })

    it('answers the documented lookup shape with no hidden value', async () => {
      devices.seed({
        user: alice._id,
        name: 'Pixel 8',
        brand: 'Google',
        model: 'Pixel 8',
        enabled: true,
        lastHeartbeat: new Date(),
        phoneId: input.serverHash('phone', 'raw-phone-id'),
        phoneSigner: 'S1',
        phoneIdSource: 'sign-in',
        fcmToken: 'push-secret',
      })
      limit = 2
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode.toLowerCase(), browser())
      expect(lookup).toEqual({
        mode: 'choose',
        status: 'pending',
        phone: { name: 'Google Pixel 8', brand: 'Google', model: 'Pixel 8' },
        requestedFrom: 'Unknown place',
        browserFrom: 'Unknown place',
        sameNetwork: true,
        strongSameNetwork: true,
        mustTypeCode: false,
        accountEmail: 'alice@example.com',
        emailVerified: true,
        expiresAt: created.expiresAt,
        secondsLeft: expect.any(Number),
        defaultName: 'Google Pixel 8',
        deviceLimit: { limit: 2, active: 1, reached: false },
        suggested: String(devices.rows[0]._id),
        message: null,
        options: [
          expect.objectContaining({ type: 'reconnect', match: 'same-phone', warning: null }),
          { type: 'new', allowed: true, warning: null, group: 'main' },
        ],
        // The device above is not the default
        defaultChoice: { currentDefaultName: null },
      })
      const text = JSON.stringify(lookup)
      for (const hidden of ['push-secret', devices.rows[0].phoneId, 'S1', linkOf(created.displayCode).netHash]) {
        expect(text).not.toContain(hidden)
      }
    })

    it('asks for the typed code on another network', async () => {
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser(OTHER_IP))
      expect(lookup).toMatchObject({ sameNetwork: false, mustTypeCode: true })
      const mismatch = { status: 400, body: { error: ERRORS.codeMismatch, code: 'TYPED_CODE' } }
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'new' }, browser(OTHER_IP))),
      ).toEqual(mismatch)
      expect(
        await failure(
          service.approve(alice as any, created.displayCode, { action: 'new', typedCode: 'AAAA-AAAA' }, browser(OTHER_IP)),
        ),
      ).toEqual(mismatch)
      await expect(
        service.approve(
          alice as any,
          created.displayCode,
          { action: 'new', typedCode: created.displayCode.toLowerCase() },
          browser(OTHER_IP),
        ),
      ).resolves.toEqual({ status: 'approved' })
    })

    it('checks a typed code that was not asked for', async () => {
      const created = await start()
      expect(
        await failure(
          service.approve(alice as any, created.displayCode, { action: 'new', typedCode: 'AAAAAAAA' }, browser()),
        ),
      ).toEqual({ status: 400, body: { error: ERRORS.codeMismatch, code: 'TYPED_CODE' } })
      await expect(
        service.approve(alice as any, created.displayCode, { action: 'new', typedCode: created.displayCode }, browser()),
      ).resolves.toEqual({ status: 'approved' })
    })

    it('a loose network match spares the typed code but selects no reconnect', async () => {
      process.env.TRUSTED_PROXY = 'cloudflare'
      devices.seed({ user: alice._id, brand: 'Google', model: 'Pixel 8', enabled: true })
      const created = await start(createBody, {
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': PHONE_IP, 'cf-ipcountry': 'CA', 'x-client-asn': '64500' },
      })
      const fromBrowser = {
        ip: '10.0.0.1',
        headers: { 'cf-connecting-ip': '2001:db8::1', 'cf-ipcountry': 'CA', 'x-client-asn': '64500' },
      }
      const lookup = await service.lookup(alice as any, created.displayCode, fromBrowser)
      expect(lookup).toMatchObject({
        sameNetwork: true,
        strongSameNetwork: false,
        mustTypeCode: false,
        suggested: null,
        message: TEXTS.differentNetwork,
      })
      expect(lookup.options[0]).toMatchObject({ warning: { code: 'W1' } })
      await expect(
        service.approve(alice as any, created.displayCode, { action: 'new' }, fromBrowser),
      ).resolves.toEqual({ status: 'approved' })
    })

    it('different network with a reconnect due: nothing selected, with the message', async () => {
      devices.seed({ user: alice._id, brand: 'Google', model: 'Pixel 8', enabled: true })
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser(OTHER_IP))
      expect(lookup).toMatchObject({ suggested: null, message: TEXTS.differentNetwork })
    })

    it('a second tab of the same user sees approved, another user gets a counted 404', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new', name: 'Shop phone' }, browser())
      expect((await service.lookup(alice as any, created.displayCode, browser())).status).toBe('approved')
      expect(await failure(service.lookup(bob as any, created.displayCode, browser()))).toEqual({
        status: 404,
        body: { error: ERRORS.codeNotFound },
      })
      expect(linkOf(created.displayCode)).toMatchObject({
        user: alice._id,
        action: 'new',
        chosenName: 'Shop phone',
        mode: 'choose',
        changedSuggestion: false,
      })
    })

    it('the user who cancelled sees denied', async () => {
      const created = await start()
      await service.deny(alice as any, created.displayCode)
      expect((await service.lookup(alice as any, created.displayCode, browser())).status).toBe('denied')
    })

    it('approves against the time right before the write, not the time of the reads', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      // The reads end after the code expired
      const realFind = devices.find.bind(devices)
      jest.spyOn(devices, 'find').mockImplementation((filter: Row) => {
        jest.setSystemTime(new Date(t0.getTime() + 10 * 60 * 1000 + 1))
        return realFind(filter)
      })
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'new' }, browser())),
      ).toEqual({ status: 404, body: { error: ERRORS.codeNotFound } })
      expect(linkOf(created.displayCode).status).toBe('pending')
    })

    it('stores the approval time taken right before the write', async () => {
      const t0 = new Date('2026-11-26T12:00:00.000Z')
      freezeClock(t0)
      const created = await start()
      const realFind = devices.find.bind(devices)
      jest.spyOn(devices, 'find').mockImplementation((filter: Row) => {
        jest.setSystemTime(new Date(t0.getTime() + 3000))
        return realFind(filter)
      })
      await service.approve(alice as any, created.displayCode, { action: 'new' }, browser())
      expect(linkOf(created.displayCode).approvedAt).toEqual(new Date(t0.getTime() + 3000))
    })

    it('refuses a banned account and an account being deleted', async () => {
      const created = await start()
      const cannot = { status: 403, body: { error: ERRORS.cannotConnect } }
      expect(
        await failure(service.approve({ ...alice, isBanned: true } as any, created.displayCode, { action: 'new' }, browser())),
      ).toEqual(cannot)
      expect(
        await failure(
          service.approve(
            { ...alice, accountDeletionRequestedAt: new Date() } as any,
            created.displayCode,
            { action: 'new' },
            browser(),
          ),
        ),
      ).toEqual(cannot)
      expect(linkOf(created.displayCode).status).toBe('pending')
    })

    it('answers 409 DEVICE_LIMIT for a new device at the limit and 400 for a choice not listed', async () => {
      limit = 1
      devices.seed({ user: alice._id, brand: 'x', model: 'y', enabled: true })
      const created = await start()
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'new' }, browser())),
      ).toEqual({ status: 409, body: { error: m2Text(1), code: 'DEVICE_LIMIT' } })
      expect(
        await failure(
          service.approve(
            alice as any,
            created.displayCode,
            { action: 'reconnect', deviceId: '665f1c2ab3d4e5f6a7b8c9d0' },
            browser(),
          ),
        ),
      ).toEqual({ status: 400, body: { error: ERRORS.choice } })
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'x' }, browser())),
      ).toEqual({ status: 400, body: { error: ERRORS.choice } })
    })

    it('refuses approval of the same phone in another account with M1', async () => {
      const device = devices.seed({
        user: bob._id,
        brand: 'Google',
        model: 'Pixel 8',
        phoneId: input.serverHash('phone', 'raw-phone-id'),
        phoneSigner: 'S1',
        phoneIdSource: 'sign-in',
      })
      const created = await start({ ...createBody, deviceId: String(device._id) })
      expect(await service.lookup(alice as any, created.displayCode, browser())).toMatchObject({
        mode: 'blocked',
        message: TEXTS.M1,
        options: [],
      })
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'new' }, browser())),
      ).toMatchObject({ status: 400 })
    })
  })

  describe('default device choice', () => {
    const defaults = () => devices.rows.filter((row) => row.isDefault === true)
    const addedOf = (answer: Row) => devices.rows.find((row) => String(row._id) === answer.deviceId)
    const sameAsOwn = () => {
      const deviceId = new Types.ObjectId()
      devices.seed({
        _id: deviceId,
        user: alice._id,
        name: 'Shop phone',
        brand: 'Google',
        model: 'Pixel 8',
        enabled: false,
        phoneId: input.serverHash('phone', 'raw-phone-id'),
        phoneSigner: 'S1',
        phoneIdSource: 'sign-in',
      })
      return deviceId
    }

    it('is null for an account without a device', async () => {
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.mode).toBe('choose')
      expect(lookup.defaultChoice).toBeNull()
    })

    it('names the enabled default device', async () => {
      devices.seed({ user: alice._id, enabled: true, name: 'Office' })
      devices.seed({ user: alice._id, enabled: true, isDefault: true, name: 'Pixel 8' })
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.defaultChoice).toEqual({ currentDefaultName: 'Pixel 8' })
    })

    it('names an unnamed default device by brand and model', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true, brand: 'Google', model: 'Pixel 7' })
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.defaultChoice).toEqual({ currentDefaultName: 'Google Pixel 7' })
    })

    it.each([
      ['no default', { enabled: true }],
      ['a default that is turned off', { enabled: false, isDefault: true }],
    ])('gives no name for an account with %s', async (_label, fields) => {
      devices.seed({ user: alice._id, name: 'Office', ...fields })
      const created = await start()
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.defaultChoice).toEqual({ currentDefaultName: null })
    })

    it('is null in mode reconnect-only', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true, name: 'Office' })
      const deviceId = sameAsOwn()
      const created = await start({ ...createBody, deviceId: String(deviceId) })
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.mode).toBe('reconnect-only')
      expect(lookup.defaultChoice).toBeNull()
    })

    it('is null in mode blocked', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true, name: 'Office' })
      const device = devices.seed({
        user: bob._id,
        brand: 'Google',
        model: 'Pixel 8',
        phoneId: input.serverHash('phone', 'raw-phone-id'),
        phoneSigner: 'S1',
        phoneIdSource: 'sign-in',
      })
      const created = await start({ ...createBody, deviceId: String(device._id) })
      const lookup = await service.lookup(alice as any, created.displayCode, browser())
      expect(lookup.mode).toBe('blocked')
      expect(lookup.defaultChoice).toBeNull()
    })

    it('stores the flag at approval of a new device only', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true })
      const asked = await start()
      await service.approve(alice as any, asked.displayCode, { action: 'new', makeDefault: true }, browser())
      expect(linkOf(asked.displayCode).makeDefault).toBe(true)

      for (const body of [{ action: 'new', makeDefault: false }, { action: 'new' }]) {
        const created = await start()
        await service.approve(alice as any, created.displayCode, body, browser())
        expect(linkOf(created.displayCode).status).toBe('approved')
        expect(linkOf(created.displayCode)).not.toHaveProperty('makeDefault')
      }
    })

    it('answers 400 for a flag that is not a boolean', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true })
      const created = await start()
      for (const value of ['true', 1, {}]) {
        expect(
          await failure(
            service.approve(alice as any, created.displayCode, { action: 'new', makeDefault: value }, browser()),
          ),
        ).toEqual({ status: 400, body: { error: ERRORS.choice } })
      }
      expect(linkOf(created.displayCode).status).toBe('pending')
    })

    it('makes the new device the default with the writes of the set-default route', async () => {
      const old = devices.seed({ user: alice._id, enabled: true, isDefault: true })
      const other = devices.seed({ user: alice._id, enabled: false })
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new', makeDefault: true }, browser())
      const clear = jest.spyOn(devices, 'updateMany')
      const set = jest.spyOn(devices, 'findByIdAndUpdate')
      const answer = await poll(created.pollToken)
      const added = addedOf(answer)
      // The same calls the route makes for this device
      expect(clear.mock.calls).toEqual([
        [{ user: alice._id, _id: { $ne: added._id }, isDefault: true }, { $set: { isDefault: false } }],
      ])
      expect(set.mock.calls).toEqual([
        [added._id, { $set: { isDefault: true } }, { returnDocument: 'after' }],
      ])
      expect(defaults().map((row) => String(row._id))).toEqual([String(added._id)])
      expect(old.isDefault).toBe(false)
      expect(other.isDefault).toBeUndefined()
      expect(answer).not.toHaveProperty('makeDefault')
    })

    it('ignores the flag for the first device of an account', async () => {
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new', makeDefault: true }, browser())
      const clear = jest.spyOn(devices, 'updateMany')
      const answer = await poll(created.pollToken)
      expect(addedOf(answer).isDefault).toBe(true)
      expect(clear).not.toHaveBeenCalled()
    })

    it('ignores the flag for a reconnect', async () => {
      const office = devices.seed({ user: alice._id, enabled: true, isDefault: true, name: 'Office' })
      const deviceId = sameAsOwn()
      const created = await start({ ...createBody, deviceId: String(deviceId) })
      await service.approve(
        alice as any,
        created.displayCode,
        { action: 'reconnect', deviceId: String(deviceId), makeDefault: true },
        browser(),
      )
      expect(linkOf(created.displayCode)).not.toHaveProperty('makeDefault')
      const answer = await poll(created.pollToken)
      expect(answer).toMatchObject({ status: 'approved', deviceId: String(deviceId) })
      expect(office.isDefault).toBe(true)
      expect(defaults()).toHaveLength(1)
    })

    it('a stopped delivery taken over and then repeated ends with one default', async () => {
      devices.seed({ user: alice._id, enabled: true, isDefault: true })
      const created = await start()
      await service.approve(alice as any, created.displayCode, { action: 'new', makeDefault: true }, browser())
      // The first delivery makes the device and its default, then stops before its key
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const real = authService.createSignInKey.getMockImplementation()!
      authService.createSignInKey.mockImplementationOnce(async (...args: unknown[]) => {
        await gate
        return real(...args)
      })
      const slow = poll(created.pollToken)
      const row = linkOf(created.displayCode)
      while (row.status !== 'delivering' || !authService.createSignInKey.mock.calls.length) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      backdate(row, 'deliveringAt', 31_000)
      const taken = await poll(created.pollToken)
      release()
      expect(taken.status).toBe('approved')
      expect((await slow).status).toBe('pending')
      const repeated = await poll(created.pollToken)
      expect(repeated.status).toBe('approved')
      expect(devices.rows).toHaveLength(2)
      expect(defaults().map((device) => String(device._id))).toEqual([taken.deviceId])
    })
  })

  describe('code attempts', () => {
    it('lets ten full sign-ins in a row through', async () => {
      for (let i = 0; i < 10; i++) {
        const created = await start(createBody, phoneRequest(`203.0.113.${i + 10}`))
        const phone = browser(`203.0.113.${i + 10}`)
        await service.lookup(alice as any, created.displayCode, phone)
        await service.lookup(alice as any, created.displayCode, phone)
        await expect(
          service.approve(alice as any, created.displayCode, { action: 'new' }, phone),
        ).resolves.toEqual({ status: 'approved' })
      }
    })

    it('refuses the call after 20 wrong codes, even with a right code', async () => {
      const created = await start()
      for (let i = 0; i < 10; i++) {
        await failure(service.lookup(alice as any, 'AAAA-AAAA', browser()))
        await failure(service.deny(alice as any, 'BBBB-BBBB'))
      }
      expect(await failure(service.lookup(alice as any, created.displayCode, browser()))).toEqual({
        status: 429,
        body: { error: ERRORS.tooManyCodes },
      })
      expect(
        await failure(service.approve(alice as any, created.displayCode, { action: 'new' }, browser())),
      ).toMatchObject({ status: 429 })
      // Another user is not affected, and the settings route still answers
      expect((await service.lookup(bob as any, created.displayCode, browser())).status).toBe('pending')
      await expect(service.settings(alice as any)).resolves.toBeDefined()
    })

    it('counts a code that someone else used as a wrong code', async () => {
      const created = await start()
      await service.approve(bob as any, created.displayCode, { action: 'new' }, browser())
      for (let i = 0; i < 20; i++) await failure(service.lookup(alice as any, created.displayCode, browser()))
      const fresh = await start()
      expect(await failure(service.lookup(alice as any, fresh.displayCode, browser()))).toMatchObject({
        status: 429,
      })
    })

    it('caps all calls at 120 a hour, right codes included', async () => {
      const created = await start()
      for (let i = 0; i < 120; i++) await service.lookup(alice as any, created.displayCode, browser())
      expect(await failure(service.lookup(alice as any, created.displayCode, browser()))).toMatchObject({
        status: 429,
      })
    })

    it('lets at most 120 of a parallel burst of 200 wrong codes past the limits', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 200 }, () => service.lookup(alice as any, 'AAAA-AAAA', browser())),
      )
      const statuses = results.map((result) =>
        result.status === 'rejected' ? (result.reason as any).getStatus() : 200,
      )
      expect(statuses.filter((code) => code !== 429).length).toBeLessThanOrEqual(120)
      expect(statuses.filter((code) => code !== 429).length).toBeGreaterThanOrEqual(20)
    })

    it('forgets wrong codes an hour after the first one', async () => {
      const start0 = Date.now()
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start0)
      for (let i = 0; i < 20; i++) (service as any).wrongCode(alice)
      expect((service as any).wrongCodeCount(alice, start0)).toBe(20)
      clock.mockReturnValue(start0 + 60 * 60 * 1000 - 1)
      expect((service as any).wrongCodeCount(alice, Date.now())).toBe(20)
      clock.mockReturnValue(start0 + 60 * 60 * 1000)
      expect((service as any).wrongCodeCount(alice, Date.now())).toBe(0)
      ;(service as any).wrongCode(alice)
      expect((service as any).wrongCodeCount(alice, Date.now())).toBe(1)
    })

    it('keeps at most 10000 users, dropping expired entries first and then the oldest', async () => {
      const start0 = Date.now()
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start0)
      const map: Map<string, unknown> = (service as any).wrongCodes
      const user = (n: number) => ({ _id: `user-${n}` })
      for (let i = 0; i < 10_000; i++) (service as any).wrongCode(user(i))
      expect(map.size).toBe(10_000)

      // One more live user: the oldest entry goes
      ;(service as any).wrongCode(user(10_000))
      expect(map.size).toBe(10_000)
      expect(map.has('user-0')).toBe(false)
      expect(map.has('user-10000')).toBe(true)

      // Once the entries expire, a new one clears them all instead
      clock.mockReturnValue(start0 + 60 * 60 * 1000 + 1)
      ;(service as any).wrongCode(user(1))
      ;(service as any).wrongCode(user(20_000))
      expect([...map.keys()]).toEqual(['user-1', 'user-20000'])
      expect(map.has('user-20000')).toBe(true)
    })

    it('does not count the settings route', async () => {
      for (let i = 0; i < 130; i++) await service.settings(alice as any)
      const created = await start()
      expect((await service.lookup(alice as any, created.displayCode, browser())).status).toBe('pending')
    })
  })

  describe('defaultTab', () => {
    const day = 24 * 60 * 60 * 1000

    it('row 1: no device opens the code tab', async () => {
      expect(await service.defaultTab(alice._id as any, new Date())).toBe('code')
    })

    it('row 2: a sign-in key, live or revoked, opens the code tab', async () => {
      devices.seed({ user: alice._id, appVersionCode: 20 })
      apiKeys.seed({ user: alice._id, source: 'device-link', revokedAt: new Date() })
      expect(await service.defaultTab(alice._id as any, new Date())).toBe('code')
    })

    it('row 3: a recent heartbeat from build 23 or newer opens the code tab, just inside 30 days', async () => {
      const now = new Date()
      devices.seed({
        user: alice._id,
        appVersionInfo: { versionCode: 23 },
        lastHeartbeat: new Date(now.getTime() - 30 * day + 60_000),
      })
      expect(await service.defaultTab(alice._id as any, now)).toBe('code')
    })

    it('row 4: a heartbeat just outside 30 days, or an older build, opens the key tab', async () => {
      const now = new Date()
      devices.seed({
        user: alice._id,
        appVersionCode: 23,
        lastHeartbeat: new Date(now.getTime() - 30 * day - 60_000),
      })
      devices.seed({ user: alice._id, appVersionCode: 22, lastHeartbeat: now })
      apiKeys.seed({ user: alice._id })
      expect(await service.defaultTab(alice._id as any, now)).toBe('key')
    })

    it('is part of the settings answer', async () => {
      expect(await service.settings(alice as any)).toEqual({ enabled: false, defaultTab: 'code' })
    })
  })
})
