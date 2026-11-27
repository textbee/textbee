import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { ThrottlerModule } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import request from 'supertest'
import { Types } from 'mongoose'
import { AuthService } from '../auth/auth.service'
import { BillingService } from '../billing/billing.service'
import { applyApiConventions } from '../openapi/swagger-config'
import { UserRollupService } from '../users/user-rollup.service'
import { UsersService } from '../users/users.service'
import { WebhookService } from '../webhook/webhook.service'
import { APP_SETTINGS, SETTING_KEYS, setPlatformValues } from './app-settings'
import { GatewayController } from './gateway.controller'
import { GatewayService } from './gateway.service'
import { SmsQueueService } from './queue/sms-queue.service'
import { Device } from './schemas/device.schema'
import { DeviceTombstone } from './schemas/device-tombstone.schema'
import { SMS } from './schemas/sms.schema'
import { SMSBatch } from './schemas/sms-batch.schema'
import { SMSPartReport } from './schemas/sms-part-report.schema'
import { SmsBatchStatusService } from './sms-batch-status.service'
import { DeviceLink } from '../device-links/schemas/device-link.schema'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({ sendEach: jest.fn() }),
}))

// What an app build before phone sign-in sends with a hand-made key, and what
// the server writes and answers for it. The snapshots were taken before phone
// sign-in changed these routes; they must stay as they are.

const NOW = new Date('2026-11-20T10:00:00.000Z')
const USER_ID = '665f1c2ab3d4e5f6a7b8c9a1'
const DEVICE_ID = '665f1c2ab3d4e5f6a7b8c9d0'
const KEY_ID = '665f1c2ab3d4e5f6a7b8c9e1'
const WRITES = new Set([
  'create',
  'updateOne',
  'updateMany',
  'findByIdAndUpdate',
  'findOneAndUpdate',
  'findByIdAndDelete',
  'deleteOne',
  'deleteMany',
  'bulkWrite',
])

type Handler = (...args: any[]) => unknown

class Query implements PromiseLike<unknown> {
  constructor(private readonly value: () => unknown) {}
  lean() {
    return this
  }
  select() {
    return this
  }
  sort() {
    return this
  }
  limit() {
    return this
  }
  populate() {
    return this
  }
  setOptions() {
    return this
  }
  exec() {
    return Promise.resolve(this.value())
  }
  then<A, B>(ok?: (value: unknown) => A | PromiseLike<A>, ko?: (reason: any) => B | PromiseLike<B>) {
    return Promise.resolve(this.value()).then(ok, ko)
  }
}

// A model that answers from handlers and records every write it is asked for
function recordingModel(name: string, writes: unknown[], handlers: Record<string, Handler> = {}) {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'then') return undefined
        return (...args: unknown[]) => {
          if (WRITES.has(method)) writes.push(JSON.parse(JSON.stringify([name, method, ...args])))
          const value = () => (handlers[method] ? handlers[method](...args) : null)
          return new Query(value)
        }
      },
    },
  )
}

const storedDevice = () => ({
  _id: new Types.ObjectId(DEVICE_ID),
  user: new Types.ObjectId(USER_ID),
  enabled: true,
  isDefault: true,
  name: 'Office phone',
  brand: 'Google',
  manufacturer: 'Google',
  model: 'Pixel 7',
  fcmToken: 'push-token-old',
  buildId: 'TQ3A.230805.001',
  appVersionCode: 22,
  appVersionName: '2.10.0',
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 30,
  receiveSMSEnabled: true,
  smsSendDelaySeconds: 5,
  installId: 'install-1',
  pushInstallId: 'install-1',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  apiKey: new Types.ObjectId(KEY_ID),
})

describe('requests of app builds before phone sign-in, with a hand-made key', () => {
  let app: INestApplication
  let writes: unknown[]
  const env = { ...process.env }

  beforeAll(() => {
    jest.useFakeTimers({
      now: NOW,
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
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  beforeEach(async () => {
    for (const key of SETTING_KEYS) delete process.env[APP_SETTINGS[key].env]
    delete process.env.USE_SMS_QUEUE
    setPlatformValues({})
    writes = []
    const device = recordingModel('devices', writes, {
      findOne: (filter) => (filter?.model ? null : storedDevice()),
      findById: () => storedDevice(),
      findByIdAndUpdate: () => storedDevice(),
      countDocuments: () => 1,
      create: (doc) => ({ _id: new Types.ObjectId(DEVICE_ID), ...doc }),
      updateOne: () => ({ matchedCount: 1, modifiedCount: 1 }),
      exists: () => null,
    })
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }])],
      controllers: [GatewayController],
      providers: [
        GatewayService,
        { provide: getModelToken(Device.name), useValue: device },
        {
          provide: getModelToken(DeviceTombstone.name),
          useValue: recordingModel('devicetombstones', writes, {
            updateOne: () => ({ upsertedCount: 1 }),
          }),
        },
        {
          provide: getModelToken(SMS.name),
          useValue: recordingModel('sms', writes, { countDocuments: () => 0 }),
        },
        { provide: getModelToken(SMSBatch.name), useValue: recordingModel('smsbatches', writes) },
        {
          provide: getModelToken(SMSPartReport.name),
          useValue: recordingModel('smspartreports', writes),
        },
        {
          provide: AuthService,
          useValue: {
            verifyApiKey: jest.fn(async () => ({
              _id: new Types.ObjectId(KEY_ID),
              user: new Types.ObjectId(USER_ID),
            })),
            trackAccessLog: jest.fn(),
            findActiveApiKeyIds: jest.fn(async () => new Set([KEY_ID])),
            revokeSignInKeysOfDevice: jest.fn(),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn(async () => ({ _id: new Types.ObjectId(USER_ID), id: USER_ID })),
            markMilestone: jest.fn().mockResolvedValue(false),
          },
        },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: WebhookService, useValue: {} },
        {
          provide: BillingService,
          useValue: { getUserLimits: jest.fn(async () => ({ deviceLimit: -1 })) },
        },
        { provide: SmsQueueService, useValue: { isQueueEnabled: () => false } },
        { provide: UserRollupService, useValue: { refreshQuietly: jest.fn() } },
        { provide: SmsBatchStatusService, useValue: { refresh: jest.fn() } },
        { provide: getModelToken(DeviceLink.name), useValue: recordingModel('devicelinks', writes) },
      ],
    }).compile()
    app = moduleRef.createNestApplication({ logger: false })
    applyApiConventions(app)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    process.env = { ...env }
    setPlatformValues({})
  })

  const send = (method: 'post' | 'patch' | 'delete', path: string, body?: object) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('x-api-key', 'txb_handmade')
      .send(body)

  const appBody = {
    fcmToken: 'push-token-new',
    brand: 'Google',
    manufacturer: 'Google',
    model: 'Pixel 7',
    buildId: 'TQ3A.230805.001',
    os: 'Android',
    osVersion: '14',
    osApiLevel: 34,
    appVersionName: '2.10.0',
    appVersionCode: 22,
    installId: 'install-1',
    installerPackage: '',
    simInfo: { lastUpdated: NOW.getTime(), sims: [{ subscriptionId: 1, simSlotIndex: 0 }] },
  }

  it('update', async () => {
    const res = await send('patch', `/gateway/devices/${DEVICE_ID}`, appBody)
    expect({ status: res.status, body: res.body, writes }).toMatchSnapshot()
  })

  it('heartbeat', async () => {
    const res = await send('post', `/gateway/devices/${DEVICE_ID}/heartbeat`, {
      fcmToken: 'push-token-new',
      batteryPercentage: 80,
      isCharging: false,
      networkType: 'wifi',
      appVersionName: '2.10.0',
      appVersionCode: 22,
      installId: 'install-1',
      receiveSMSEnabled: true,
      pullCapable: true,
    })
    expect({ status: res.status, body: res.body, writes }).toMatchSnapshot()
  })

  it('register', async () => {
    const res = await send('post', '/gateway/devices', { ...appBody, model: 'Pixel 8' })
    expect({ status: res.status, body: res.body, writes }).toMatchSnapshot()
  })

  it('delete', async () => {
    const res = await send('delete', `/gateway/devices/${DEVICE_ID}`)
    expect({ status: res.status, body: res.body, writes }).toMatchSnapshot()
  })
})
