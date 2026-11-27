import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { ThrottlerModule } from '@nestjs/throttler'
import { JwtService } from '@nestjs/jwt'
import { createHash } from 'crypto'
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

// Every read, write and service call the server makes when an older app
// build calls its device routes with a hand-made key and none of the new
// headers. The key checks run through the real AuthService, so its own
// writes show here too.

const NOW = new Date('2026-11-20T10:00:00.000Z')
const USER_ID = '665f1c2ab3d4e5f6a7b8c9a1'
const DEVICE_ID = '665f1c2ab3d4e5f6a7b8c9d0'
const KEY_ID = '665f1c2ab3d4e5f6a7b8c9e1'
const SMS_ID = '665f1c2ab3d4e5f6a7b8c9b1'
const BATCH_ID = '665f1c2ab3d4e5f6a7b8c9b2'
const KEY = 'txb_handmade0000000000000000000000'
const KNOWN_IDS = new Set([USER_ID, DEVICE_ID, KEY_ID, SMS_ID, BATCH_ID])

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
  skip() {
    return this
  }
  populate() {
    return this
  }
  setOptions() {
    return this
  }
  session() {
    return this
  }
  exec() {
    return Promise.resolve(this.value())
  }
  then<A, B>(ok?: (value: unknown) => A | PromiseLike<A>, ko?: (reason: any) => B | PromiseLike<B>) {
    return Promise.resolve(this.value()).then(ok, ko)
  }
}

type Handlers = Record<string, (...args: any[]) => unknown>

// Answers from handlers and records every call with its arguments
function recorder(name: string, trace: unknown[], handlers: Handlers = {}, query = true) {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'then') return undefined
        return (...args: unknown[]) => {
          trace.push([name, method, ...args])
          const value = () => (handlers[method] ? handlers[method](...args) : null)
          return query ? new Query(value) : Promise.resolve(value())
        }
      },
    },
  )
}

// A stable form for the snapshot: ids made during the request become <new id>,
// and the HTTP request object handed to a service is named, not copied
function stable(value: unknown): unknown {
  const text = JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && 'socket' in entry && 'headers' in entry
      ? '<http request>'
      : entry,
  )
  return JSON.parse(text, (_key, entry) =>
    typeof entry === 'string' && /^[0-9a-f]{24}$/.test(entry) && !KNOWN_IDS.has(entry)
      ? '<new id>'
      : entry,
  )
}

const storedDevice = (extra: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(DEVICE_ID),
  user: new Types.ObjectId(USER_ID),
  enabled: true,
  isDefault: true,
  name: 'Office phone',
  brand: 'Google',
  model: 'Pixel 7',
  fcmToken: 'push-token-old',
  buildId: 'TQ3A.230805.001',
  appVersionCode: 22,
  appVersionName: '2.10.0',
  heartbeatIntervalMinutes: 30,
  receiveSMSEnabled: true,
  smsSendDelaySeconds: 5,
  installId: 'install-1',
  pushInstallId: 'install-1',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  apiKey: new Types.ObjectId(KEY_ID),
  ...extra,
})

const storedSms = () => ({
  _id: new Types.ObjectId(SMS_ID),
  device: new Types.ObjectId(DEVICE_ID),
  user: new Types.ObjectId(USER_ID),
  smsBatch: new Types.ObjectId(BATCH_ID),
  message: 'Hello',
  recipient: '+15555550123',
  status: 'dispatched',
  type: 'SENT',
  createdAt: new Date('2026-11-20T09:59:00.000Z'),
})

describe('full trace of older app builds with a hand-made key', () => {
  let app: INestApplication
  let trace: unknown[]
  let device: () => Record<string, unknown>
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

  const start = async (deviceFields: Record<string, unknown> = {}) => {
    for (const key of SETTING_KEYS) delete process.env[APP_SETTINGS[key].env]
    delete process.env.USE_SMS_QUEUE
    delete process.env.RECOVERABLE_PUSH_FAILURES_ENABLED
    process.env.DEVICE_LINK_SECRET = 'trace-secret'
    setPlatformValues({})
    trace = []
    device = () => storedDevice(deviceFields)
    const apiKeys = recorder('apikeys', trace, {
      findOne: (filter) =>
        filter?.hashedApiKeySha256 === createHash('sha256').update(KEY).digest('hex')
          ? { _id: new Types.ObjectId(KEY_ID), user: new Types.ObjectId(USER_ID), name: 'Server key' }
          : null,
      find: () => [],
      updateOne: () => ({ matchedCount: 1 }),
      updateMany: () => ({ matchedCount: 0 }),
      findByIdAndUpdate: () => null,
    })
    const devices = recorder('devices', trace, {
      findOne: (filter) => (filter?.model ? null : device()),
      findById: () => device(),
      findByIdAndUpdate: () => device(),
      findOneAndUpdate: () => device(),
      find: () => [],
      countDocuments: () => 1,
      create: (doc) => ({ _id: new Types.ObjectId(DEVICE_ID), ...doc }),
      updateOne: () => ({ matchedCount: 1, modifiedCount: 1 }),
      exists: () => null,
    })
    const sms = recorder('sms', trace, {
      findOne: () => storedSms(),
      findById: () => storedSms(),
      find: () => [],
      countDocuments: () => 0,
      create: (doc) => ({ _id: new Types.ObjectId(SMS_ID), ...doc }),
      updateOne: () => ({ matchedCount: 1, modifiedCount: 1 }),
      findOneAndUpdate: () => storedSms(),
      updateMany: () => ({ matchedCount: 0 }),
      aggregate: () => [],
      distinct: () => [],
    })
    const service = (name: string, handlers: Handlers = {}) => recorder(name, trace, handlers, false)
    const authService = new AuthService(
      service('UsersService') as any,
      service('UserRollupService') as any,
      service('JwtService') as any,
      apiKeys as any,
      recorder('apikeytombstones', trace) as any,
      recorder('passwordresets', trace) as any,
      service('AccessFootprintService') as any,
      recorder('emailverifications', trace) as any,
      service('MailService') as any,
      service('TurnstileService') as any,
      service('AnalyticsService') as any,
      recorder('emailhistories', trace) as any,
      devices as any,
    )
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10_000 }])],
      controllers: [GatewayController],
      providers: [
        GatewayService,
        { provide: getModelToken(Device.name), useValue: devices },
        {
          provide: getModelToken(DeviceTombstone.name),
          useValue: recorder('devicetombstones', trace, { updateOne: () => ({ upsertedCount: 1 }) }),
        },
        { provide: getModelToken(SMS.name), useValue: sms },
        { provide: getModelToken(SMSBatch.name), useValue: recorder('smsbatches', trace) },
        { provide: getModelToken(SMSPartReport.name), useValue: recorder('smspartreports', trace) },
        { provide: getModelToken(DeviceLink.name), useValue: recorder('devicelinks', trace) },
        { provide: AuthService, useValue: authService },
        {
          provide: UsersService,
          useValue: service('UsersService', {
            findOne: () => ({ _id: new Types.ObjectId(USER_ID), id: USER_ID, emailVerifiedAt: NOW }),
            markMilestone: () => false,
          }),
        },
        { provide: JwtService, useValue: service('JwtService') },
        { provide: WebhookService, useValue: service('WebhookService') },
        {
          provide: BillingService,
          useValue: service('BillingService', {
            getUserLimits: () => ({ deviceLimit: -1 }),
            canPerformAction: () => true,
          }),
        },
        { provide: SmsQueueService, useValue: service('SmsQueueService', { isQueueEnabled: () => false }) },
        { provide: UserRollupService, useValue: service('UserRollupService') },
        { provide: SmsBatchStatusService, useValue: service('SmsBatchStatusService') },
      ],
    }).compile()
    app = moduleRef.createNestApplication({ logger: false })
    applyApiConventions(app)
    await app.init()
  }

  afterEach(async () => {
    await app?.close()
    process.env = { ...env }
    setPlatformValues({})
  })

  const send = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('x-api-key', KEY)
      .send(body)

  const snapshot = (res: request.Response) =>
    expect(stable({ status: res.status, body: res.body, trace })).toMatchSnapshot()

  const appBody = {
    fcmToken: 'push-token-new',
    brand: 'Google',
    model: 'Pixel 7',
    buildId: 'TQ3A.230805.001',
    os: 'Android',
    osVersion: '14',
    osApiLevel: 34,
    appVersionName: '2.10.0',
    appVersionCode: 22,
    installId: 'install-1',
  }

  it('update', async () => {
    await start()
    snapshot(await send('patch', `/gateway/devices/${DEVICE_ID}`, appBody))
  })

  it('heartbeat', async () => {
    await start()
    snapshot(
      await send('post', `/gateway/devices/${DEVICE_ID}/heartbeat`, {
        fcmToken: 'push-token-new',
        batteryPercentage: 80,
        appVersionCode: 22,
        installId: 'install-1',
      }),
    )
  })

  it('register', async () => {
    await start()
    snapshot(await send('post', '/gateway/devices', { ...appBody, model: 'Pixel 8' }))
  })

  it('delete', async () => {
    await start()
    snapshot(await send('delete', `/gateway/devices/${DEVICE_ID}`))
  })

  it('receive-sms', async () => {
    await start()
    snapshot(
      await send('post', `/gateway/devices/${DEVICE_ID}/receive-sms`, {
        message: 'Your code is 482913',
        sender: '+15555550123',
        receivedAtInMillis: NOW.getTime() - 1000,
      }),
    )
  })

  it('sms-status', async () => {
    await start()
    snapshot(
      await send('patch', `/gateway/devices/${DEVICE_ID}/sms-status`, {
        smsId: SMS_ID,
        smsBatchId: BATCH_ID,
        status: 'delivered',
        deliveredAtInMillis: NOW.getTime() - 500,
      }),
    )
  })

  it('messages pending', async () => {
    await start()
    setPlatformValues({ recoveryPollEnabled: true })
    snapshot(await send('get', `/gateway/devices/${DEVICE_ID}/messages/pending`))
  })

  it('messages claim', async () => {
    await start({ pullInfo: { pullCapable: true, lastUpdated: NOW } })
    setPlatformValues({ pullEnabled: true })
    snapshot(
      await send('post', `/gateway/devices/${DEVICE_ID}/messages/claim`, { installId: 'install-1' }),
    )
  })

  // A 2.11.0 phone connected the device; an older build still calls with a hand-made key
  it('heartbeat of an older build on a device a newer phone owns', async () => {
    await start({
      ownerInstallId: 'install-new',
      phoneId: 'stored-phone-hash',
      phoneSigner: 'stored-signer',
      phoneIdSource: 'sign-in',
    })
    snapshot(
      await send('post', `/gateway/devices/${DEVICE_ID}/heartbeat`, {
        fcmToken: 'push-token-old',
        appVersionCode: 22,
        installId: 'install-1',
      }),
    )
  })
})
