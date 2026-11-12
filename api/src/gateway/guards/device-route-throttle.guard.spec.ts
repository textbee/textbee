import { INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import {
  ThrottlerModule,
  ThrottlerStorage,
  getStorageToken,
} from '@nestjs/throttler'
import { Types } from 'mongoose'
import request from 'supertest'
import { AuthService } from '../../auth/auth.service'
import {
  IP_THROTTLE_LIMIT,
  IP_THROTTLE_TTL_MS,
  ThrottlerByIpGuard,
} from '../../auth/guards/throttle-by-ip.guard'
import { UsersService } from '../../users/users.service'
import { setPlatformValues } from '../app-settings'
import { GatewayController } from '../gateway.controller'
import { GatewayService } from '../gateway.service'
import {
  DEVICE_ROUTE_IP_LIMIT,
  DEVICE_ROUTE_LIMIT,
  DeviceRouteThrottleGuard,
  deviceRouteLimits,
} from './device-route-throttle.guard'

// Small limits keep the spec fast; the production values are checked below
const PER_DEVICE = 5
const PER_IP = 20
const PER_IP_DEFAULT = 10

describe('device route limit values', () => {
  it('are 600 per device, 3000 per IP on these routes and 500 per IP elsewhere', () => {
    expect(DEVICE_ROUTE_LIMIT).toBe(600)
    expect(DEVICE_ROUTE_IP_LIMIT).toBe(3000)
    expect(IP_THROTTLE_LIMIT).toBe(500)
    expect(deviceRouteLimits).toEqual({
      perDevice: 600,
      perIp: 3000,
      perIpWhenOff: 500,
    })
  })
})

describe('DeviceRouteThrottleGuard keys', () => {
  const contextFor = (classRef: Function, handler: Function, id: unknown) =>
    ({
      getClass: () => classRef,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ params: { id } }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    }) as any

  const storage = {
    increment: jest.fn().mockResolvedValue({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  }
  const guard = new DeviceRouteThrottleGuard(storage as any)

  beforeEach(() => {
    storage.increment.mockClear()
    delete process.env.DEVICE_ROUTE_THROTTLE_ENABLED
    setPlatformValues({})
  })

  it('keeps the same handler name on two controllers apart', async () => {
    class FirstController {
      report() {}
    }
    class SecondController {
      report() {}
    }
    const id = new Types.ObjectId().toHexString()

    await guard.canActivate(
      contextFor(FirstController, FirstController.prototype.report, id),
    )
    await guard.canActivate(
      contextFor(SecondController, SecondController.prototype.report, id),
    )

    expect(storage.increment.mock.calls.map(([key]) => key)).toEqual([
      `device:FirstController:report:${id}`,
      `device:SecondController:report:${id}`,
    ])
  })

  it.each([
    ['missing', undefined],
    ['not an ObjectId', 'not-a-device'],
    ['too long', 'a'.repeat(25)],
  ])(
    'lets a request with an id that is %s through without counting it',
    async (_name, id) => {
      await expect(
        guard.canActivate(
          contextFor(
            GatewayController,
            GatewayController.prototype.updateSMSStatus,
            id,
          ),
        ),
      ).resolves.toBe(true)
      expect(storage.increment).not.toHaveBeenCalled()
    },
  )
})

// The real controller with the real guard order: global IP guard, then
// AuthGuard, CanModifyDevice and DeviceRouteThrottleGuard
describe('device route request limits', () => {
  const owner = new Types.ObjectId()
  const otherUser = new Types.ObjectId()
  const deviceA = new Types.ObjectId().toHexString()
  const deviceB = new Types.ObjectId().toHexString()
  const otherUsersDevice = new Types.ObjectId().toHexString()
  const deviceOwners: Record<string, string> = {
    [deviceA]: String(owner),
    [deviceB]: String(owner),
    [otherUsersDevice]: String(otherUser),
  }
  const apiKeys: Record<string, Types.ObjectId> = {
    'key-owner': owner,
    'key-other': otherUser,
  }
  const ORIGINAL_SWITCH = process.env.DEVICE_ROUTE_THROTTLE_ENABLED
  const ORIGINAL_PROXY = process.env.TRUSTED_PROXY
  const ORIGINAL_LIMITS = { ...deviceRouteLimits }

  let app: INestApplication
  let increment: jest.SpyInstance

  beforeEach(async () => {
    delete process.env.DEVICE_ROUTE_THROTTLE_ENABLED
    process.env.TRUSTED_PROXY = 'cloudflare'
    setPlatformValues({})
    Object.assign(deviceRouteLimits, {
      perDevice: PER_DEVICE,
      perIp: PER_IP,
      perIpWhenOff: PER_IP_DEFAULT,
    })

    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { ttl: IP_THROTTLE_TTL_MS, limit: PER_IP_DEFAULT },
        ]),
      ],
      controllers: [GatewayController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerByIpGuard },
        {
          provide: GatewayService,
          useValue: {
            getDeviceById: jest.fn(async (id: string, userId: string) =>
              deviceOwners[new Types.ObjectId(id).toHexString()] ===
              String(userId)
                ? { _id: id }
                : null,
            ),
            updateSMSStatus: jest.fn().mockResolvedValue({ success: true }),
            receiveSMS: jest.fn().mockResolvedValue({ success: true }),
            heartbeat: jest.fn().mockResolvedValue({ success: true }),
          },
        },
        {
          provide: AuthService,
          useValue: {
            verifyApiKey: jest.fn(async (key: string) =>
              apiKeys[key]
                ? { _id: new Types.ObjectId(), user: apiKeys[key] }
                : null,
            ),
            trackAccessLog: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn(async ({ _id }) => ({ _id, id: String(_id) })),
          },
        },
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(() => {
              throw new Error('invalid')
            }),
          },
        },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    await app.listen(0)
    increment = jest.spyOn(
      moduleRef.get<ThrottlerStorage>(getStorageToken()),
      'increment',
    )
  })

  afterEach(async () => {
    await app.close()
    setPlatformValues({})
    Object.assign(deviceRouteLimits, ORIGINAL_LIMITS)
    if (ORIGINAL_SWITCH === undefined)
      delete process.env.DEVICE_ROUTE_THROTTLE_ENABLED
    else process.env.DEVICE_ROUTE_THROTTLE_ENABLED = ORIGINAL_SWITCH
    if (ORIGINAL_PROXY === undefined) delete process.env.TRUSTED_PROXY
    else process.env.TRUSTED_PROXY = ORIGINAL_PROXY
  })

  const statusReport = (
    deviceId: string,
    { key, ip = '203.0.113.1' }: { key?: string; ip?: string } = {},
  ) => {
    const req = request(app.getHttpServer())
      .patch(`/gateway/devices/${deviceId}/sms-status`)
      .set('cf-connecting-ip', ip)
      .send({})
    return key ? req.set('x-api-key', key) : req
  }
  const receivedSms = (deviceId: string, key = 'key-owner') =>
    request(app.getHttpServer())
      .post(`/gateway/devices/${deviceId}/receive-sms`)
      .set('cf-connecting-ip', '203.0.113.1')
      .set('x-api-key', key)
      .send({})
  const repeat = async (times: number, send: () => request.Test) => {
    for (let i = 0; i < times; i++) await send()
  }
  const deviceCounts = () =>
    increment.mock.calls.filter(([, , , , name]) => name === 'device')
  const ipCounts = () =>
    increment.mock.calls.filter(([, , , , name]) => name === 'default')

  it.each([
    ['no key', undefined, 401],
    ['a wrong key', 'key-wrong', 401],
    ["another account's valid key", 'key-other', 404],
  ])(
    'does not spend the device budget for a request with %s, but counts it per IP',
    async (_name, key, status) => {
      const res = await statusReport(deviceA, { key })

      expect(res.status).toBe(status)
      expect(deviceCounts()).toHaveLength(0)
      expect(ipCounts()).toHaveLength(1)
      expect(res.headers['x-ratelimit-limit']).toBe(String(PER_IP))
      expect(res.headers).not.toHaveProperty('x-ratelimit-limit-device')
      expect(res.headers).not.toHaveProperty('x-ratelimit-remaining-device')
    },
  )

  it('caps requests from one IP at the route limit, whatever device id they name', async () => {
    await repeat(PER_IP, () => statusReport(new Types.ObjectId().toHexString()))

    const res = await statusReport(new Types.ObjectId().toHexString())
    expect(res.status).toBe(429)
    expect(deviceCounts()).toHaveLength(0)
    // Every id shared one IP key
    expect(new Set(ipCounts().map(([key]) => key)).size).toBe(1)
  })

  it('lets the owner reach the per-device limit, and stops the next report', async () => {
    await repeat(PER_DEVICE - 1, () =>
      statusReport(deviceA, { key: 'key-owner' }),
    )
    const last = await statusReport(deviceA, { key: 'key-owner' })
    expect(last.status).toBe(200)
    expect(last.headers['x-ratelimit-limit-device']).toBe(String(PER_DEVICE))
    expect(last.headers['x-ratelimit-remaining-device']).toBe('0')

    const blocked = await statusReport(deviceA, { key: 'key-owner' })
    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    })
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('gives each device of the owner, and each route, its own budget', async () => {
    await repeat(PER_DEVICE, () => statusReport(deviceA, { key: 'key-owner' }))
    expect((await statusReport(deviceA, { key: 'key-owner' })).status).toBe(429)

    expect((await statusReport(deviceB, { key: 'key-owner' })).status).toBe(200)
    const received = await receivedSms(deviceA)
    expect(received.status).toBe(200)
    expect(received.headers['x-ratelimit-remaining-device']).toBe(
      String(PER_DEVICE - 1),
    )
  })

  it('counts one device once, whatever the case of its id', async () => {
    await statusReport(deviceA, { key: 'key-owner' })
    await statusReport(deviceA.toUpperCase(), { key: 'key-owner' })

    const keys = deviceCounts().map(([key]) => key)
    expect(keys).toEqual([
      `device:GatewayController:updateSMSStatus:${deviceA}`,
      `device:GatewayController:updateSMSStatus:${deviceA}`,
    ])
  })

  it('keeps other routes at the usual per-IP limit', async () => {
    const res = await request(app.getHttpServer())
      .post(`/gateway/devices/${deviceA}/heartbeat`)
      .set('cf-connecting-ip', '203.0.113.1')
      .set('x-api-key', 'key-owner')
      .send({})

    expect(res.status).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe(String(PER_IP_DEFAULT))
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit-device')
  })

  it('restores the usual per-IP limit and no device count when switched off', async () => {
    process.env.DEVICE_ROUTE_THROTTLE_ENABLED = 'false'

    await repeat(PER_IP_DEFAULT, () =>
      statusReport(deviceA, { key: 'key-owner' }),
    )
    const blocked = await statusReport(deviceB, { key: 'key-owner' })

    expect(blocked.status).toBe(429)
    expect(blocked.body).toEqual({
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    })
    expect(deviceCounts()).toHaveLength(0)
  })

  it('follows the platform document switch', async () => {
    setPlatformValues({ deviceRouteThrottleEnabled: false })

    const res = await receivedSms(deviceA)

    expect(res.status).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe(String(PER_IP_DEFAULT))
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit-device')
    expect(deviceCounts()).toHaveLength(0)
  })
})
