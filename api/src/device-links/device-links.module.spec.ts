import { ConfigModule } from '@nestjs/config'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { MongooseModule } from '@nestjs/mongoose'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { BullModule, getQueueToken } from '@nestjs/bull'
import { DeviceLinksController } from './device-links.controller'
import { DeviceLinksModule } from './device-links.module'
import { DeviceLinksService } from './device-links.service'
import { GatewayService } from '../gateway/gateway.service'
import { AnalyticsModule } from '../analytics/analytics.module'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({ sendEach: jest.fn() }),
}))

// Builds the module with its real imports, so a provider that is missing or
// not exported fails here and not at boot. Nothing connects: the database
// connection is lazy and the queues are stand-ins.
describe('DeviceLinksModule wiring', () => {
  jest.setTimeout(60_000)

  const jwtSecret = process.env.JWT_SECRET
  beforeAll(() => {
    process.env.JWT_SECRET = 'wiring-test'
  })
  afterAll(() => {
    if (jwtSecret === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = jwtSecret
  })

  it('resolves the controller, the service and the device routes it touches', async () => {
    const queue = () => ({
      process: jest.fn(),
      on: jest.fn(),
      add: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockResolvedValue(undefined),
    })
    const builder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        EventEmitterModule.forRoot(),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
        MongooseModule.forRoot('mongodb://127.0.0.1:9/wiring-test', { lazyConnection: true }),
        BullModule.forRoot({ redis: { host: '127.0.0.1', port: 9 } }),
        // Global in the app, as in app.module.ts
        AnalyticsModule,
        DeviceLinksModule,
      ],
    })
    for (const name of ['sms', 'billing-notifications', 'webhook-delivery']) {
      builder.overrideProvider(getQueueToken(name)).useValue(queue())
    }
    const moduleRef = await builder.compile()
    try {
      expect(moduleRef.get(DeviceLinksController)).toBeInstanceOf(DeviceLinksController)
      expect(moduleRef.get(DeviceLinksService)).toBeInstanceOf(DeviceLinksService)
      expect(moduleRef.get(GatewayService, { strict: false })).toBeInstanceOf(GatewayService)
    } finally {
      await moduleRef.close()
    }
  })
})
