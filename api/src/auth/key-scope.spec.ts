import { INestApplication, RequestMethod } from '@nestjs/common'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import { Types } from 'mongoose'
import request from 'supertest'
import { BillingController } from '../billing/billing.controller'
import { DeviceLinksController } from '../device-links/device-links.controller'
import { GatewayController } from '../gateway/gateway.controller'
import { GatewayService } from '../gateway/gateway.service'
import { NotificationsController } from '../notifications/notifications.controller'
import { applyApiConventions } from '../openapi/swagger-config'
import { SupportController } from '../support/support.controller'
import { UsersService } from '../users/users.service'
import { WebhookController } from '../webhook/webhook.controller'
import { WebhookService } from '../webhook/webhook.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AuthGuard } from './guards/auth.guard'
import { LoginSessionGuard } from './guards/login-session.guard'
import { KEY_SCOPE_ERROR, assertKeyScope, signInKeyAllows } from './key-scope'

const LINKED = '665f1c2ab3d4e5f6a7b8c9d0'
const OTHER = '665f1c2ab3d4e5f6a7b8c9d1'

describe('signInKeyAllows', () => {
  const req = (method: string, path: string, id?: string) => ({
    method,
    route: { path },
    params: id ? { id } : {},
  })

  it('allows the account routes the app calls', () => {
    expect(signInKeyAllows(req('GET', '/api/v1/auth/who-am-i'), LINKED)).toBe(true)
    expect(signInKeyAllows(req('GET', '/api/v1/gateway/stats'), LINKED)).toBe(true)
    expect(signInKeyAllows(req('GET', '/api/v1/billing/current-subscription'), LINKED)).toBe(true)
  })

  it('allows read and update of its own device and every route under it', () => {
    const device = '/api/v1/gateway/devices/:id'
    expect(signInKeyAllows(req('GET', device, LINKED), LINKED)).toBe(true)
    expect(signInKeyAllows(req('PATCH', device, LINKED.toUpperCase()), LINKED)).toBe(true)
    expect(signInKeyAllows(req('POST', `${device}/heartbeat`, LINKED), LINKED)).toBe(true)
    expect(signInKeyAllows(req('GET', `${device}/sms/:smsId`, LINKED), LINKED)).toBe(true)
  })

  it('refuses deleting the device, other devices and every other route', () => {
    const device = '/api/v1/gateway/devices/:id'
    expect(signInKeyAllows(req('DELETE', device, LINKED), LINKED)).toBe(false)
    expect(signInKeyAllows(req('POST', `${device}/set-default`, LINKED), LINKED)).toBe(false)
    expect(signInKeyAllows(req('GET', device, OTHER), LINKED)).toBe(false)
    expect(signInKeyAllows(req('POST', `${device}/heartbeat`, OTHER), LINKED)).toBe(false)
    expect(signInKeyAllows(req('POST', '/api/v1/gateway/devices'), LINKED)).toBe(false)
    expect(signInKeyAllows(req('POST', '/api/v1/auth/api-keys'), LINKED)).toBe(false)
    expect(signInKeyAllows(req('POST', '/api/v1/auth/who-am-i'), LINKED)).toBe(false)
    expect(signInKeyAllows(req('GET', device, LINKED), undefined)).toBe(false)
  })

  it('refuses a request whose matched route is unknown', () => {
    expect(signInKeyAllows({ method: 'GET', params: { id: LINKED } }, LINKED)).toBe(false)
  })

  it('leaves a key without a source alone', () => {
    expect(() => assertKeyScope({ method: 'DELETE' }, {})).not.toThrow()
    expect(() => assertKeyScope({ method: 'DELETE' }, { source: 'device-link' })).toThrow()
  })
})

// Every route of every controller that takes an API key, called with a sign-in
// key and with a hand-made key through the real router and the real AuthGuard.
describe('sign-in key scope on every route', () => {
  const CONTROLLERS = [
    AuthController,
    BillingController,
    DeviceLinksController,
    GatewayController,
    NotificationsController,
    SupportController,
    WebhookController,
  ]
  const ALLOWED = new Set([
    'GET /auth/who-am-i',
    'GET /gateway/stats',
    'GET /billing/current-subscription',
    'GET /gateway/devices/:id',
    'PATCH /gateway/devices/:id',
  ])
  const userId = new Types.ObjectId()
  const keys: Record<string, Record<string, unknown>> = {
    'txb_signin': {
      _id: new Types.ObjectId(),
      user: userId,
      source: 'device-link',
      linkedDevice: new Types.ObjectId(LINKED),
    },
    'txb_handmade': { _id: new Types.ObjectId(), user: userId },
  }
  // Any service call answers with an empty object, so a handler runs past the guards
  const anyService = () =>
    new Proxy(
      {},
      {
        get: (target, name) =>
          name in target
            ? target[name]
            : name === 'then'
              ? undefined
              : jest.fn().mockResolvedValue({}),
      },
    )

  type Route = { method: string; path: string; session: boolean }
  const routes: Route[] = []
  for (const controller of CONTROLLERS) {
    const base = Reflect.getMetadata(PATH_METADATA, controller)
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = controller.prototype[name]
      if (name === 'constructor' || typeof handler !== 'function') continue
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? []
      if (!guards.includes(AuthGuard)) continue
      const paths = Reflect.getMetadata(PATH_METADATA, handler)
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]
      for (const path of [paths].flat()) {
        const joined = `/${base}/${path}`.replace(/\/+/g, '/').replace(/\/$/, '')
        routes.push({ method, path: joined, session: guards.includes(LoginSessionGuard) })
      }
    }
  }

  let app: INestApplication

  beforeAll(async () => {
    const providers = new Map<unknown, unknown>()
    for (const controller of CONTROLLERS) {
      for (const type of Reflect.getMetadata('design:paramtypes', controller) ?? []) {
        providers.set(type, anyService())
      }
    }
    // Every other service call answers like the rest of the doubles
    const withDefaults = (overrides: Record<string, unknown>) =>
      new Proxy(overrides, {
        get: (target, name) =>
          name in target
            ? target[name as string]
            : name === 'then'
              ? undefined
              : jest.fn().mockResolvedValue({}),
      })
    providers.set(AuthService, withDefaults({
      findApiKeyById: jest.fn(async () => ({ user: userId })),
      verifyApiKey: jest.fn(async (key: string) => keys[key] ?? null),
      trackAccessLog: jest.fn(),
      getUserApiKeysWithDevices: jest.fn().mockResolvedValue([]),
      generateApiKey: jest.fn().mockResolvedValue({ apiKey: 'x', message: '' }),
    }))
    providers.set(UsersService, withDefaults({
      findOne: jest.fn(async () => ({ _id: userId, id: String(userId) })),
      updateOnboarding: jest.fn().mockResolvedValue({}),
    }))
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100_000 }])],
      controllers: CONTROLLERS,
      providers: [
        ...[...providers].map(([provide, useValue]) => ({ provide: provide as any, useValue })),
        { provide: JwtService, useValue: { verify: jest.fn(() => { throw new Error('no') }) } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useFactory({
        factory: (jwt, users, auth) => new AuthGuard(jwt, users, auth),
        inject: [JwtService, UsersService, AuthService],
      })
      .compile()
    // CanModifyDevice asks the gateway service whether the device is the user's
    const gatewayService = moduleRef.get(GatewayService)
    gatewayService.getDeviceById = jest.fn(async () => ({ _id: LINKED }))
    // The routes a hand-made key reaches read these answers further
    gatewayService.resolveSenderDevice = jest.fn(async () => ({ _id: LINKED }))
    moduleRef.get(WebhookService).findWebhooksForUser = jest.fn(async () => [])

    app = moduleRef.createNestApplication({ logger: false })
    applyApiConventions(app)
    await app.init()
  })

  afterAll(async () => {
    await app?.close()
  })

  const fill = (path: string, id: string) =>
    path
      .replace(':id', id)
      .replace(/:(smsId|smsBatchId|webhookId)/g, '665f1c2ab3d4e5f6a7b8c9ff')
      .replace(':code', 'K7QX2M9P')

  const call = (method: string, path: string, key: string) =>
    (request(app.getHttpServer()) as any)
      [method.toLowerCase()](`/api/v1${path}`)
      .set('x-api-key', key)
      .send({})

  it('finds the routes of the app contract', () => {
    const keysOf = new Set(routes.map((route) => `${route.method} ${route.path}`))
    for (const allowed of ALLOWED) expect(keysOf).toContain(allowed)
    expect(routes.length).toBeGreaterThan(40)
  })

  it('answers 403 KEY_SCOPE outside the list and lets the list through', async () => {
    const results: string[] = []
    for (const route of routes) {
      const own = route.path.startsWith('/gateway/devices/:id')
      const allowed =
        ALLOWED.has(`${route.method} ${route.path}`) ||
        (own &&
          route.path !== '/gateway/devices/:id' &&
          route.path !== '/gateway/devices/:id/set-default')
      const res = await call(route.method, fill(route.path, LINKED), 'txb_signin')
      const scoped = res.status === 403 && res.body?.code === 'KEY_SCOPE'
      // A server error on an allowed route would hide a handler that fails for this key
      const outcome =
        res.status === 401 ? 'session' : scoped ? 'scope' : res.status >= 500 ? 'error' : 'pass'
      const expected = route.session ? 'session' : allowed ? 'pass' : 'scope'
      if (outcome !== expected) results.push(`${route.method} ${route.path}: ${res.status}`)
      if (scoped) expect(res.body).toEqual(KEY_SCOPE_ERROR)
    }
    expect(results).toEqual([])
  })

  it('refuses every device route for another device', async () => {
    const results: string[] = []
    for (const route of routes.filter((r) => r.path.startsWith('/gateway/devices/:id'))) {
      const res = await call(route.method, fill(route.path, OTHER), 'txb_signin')
      if (!(res.status === 403 && res.body?.code === 'KEY_SCOPE')) {
        results.push(`${route.method} ${route.path}: ${res.status}`)
      }
    }
    expect(results).toEqual([])
  })

  it('refuses another device id in another spelling of the path', async () => {
    for (const path of [
      `/API/V1/GATEWAY/DEVICES/${OTHER}`,
      `/api/v1/gateway/devices/${OTHER}/`,
      `/api/v1/gateway/devices/${OTHER.toUpperCase()}/heartbeat`,
    ]) {
      const res = await (request(app.getHttpServer()) as any)
        .get(path)
        .set('x-api-key', 'txb_signin')
      expect(res.status === 404 || res.body?.code === 'KEY_SCOPE').toBe(true)
    }
  })

  it('lets a hand-made key through every route as before', async () => {
    const results: string[] = []
    for (const route of routes) {
      const res = await call(route.method, fill(route.path, LINKED), 'txb_handmade')
      // A server error would hide a route that fails for this key
      const outcome =
        res.status === 401
          ? 'session'
          : res.body?.code === 'KEY_SCOPE'
            ? 'scope'
            : res.status >= 500
              ? 'error'
              : 'pass'
      // Only the new login-session routes refuse a key
      if (outcome !== (route.session ? 'session' : 'pass')) {
        results.push(`${route.method} ${route.path}: ${res.status}`)
      }
    }
    expect(results).toEqual([])
  })
})
