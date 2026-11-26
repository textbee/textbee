import { HttpException, HttpStatus, INestApplication } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { AuthService } from '../auth/auth.service'
import { ThrottlerByIpGuard } from '../auth/guards/throttle-by-ip.guard'
import { applyApiConventions } from '../openapi/swagger-config'
import { UsersService } from '../users/users.service'
import { DeviceLinksController } from './device-links.controller'
import { DeviceLinksService } from './device-links.service'

// What the app and the link page read: a sentence in error, on every answer
describe('device link error texts', () => {
  let app: INestApplication
  const service = {
    create: jest.fn(),
    poll: jest.fn(),
    lookup: jest.fn(),
    approve: jest.fn(),
    deny: jest.fn(),
    settings: jest.fn(),
  }

  beforeEach(async () => {
    for (const fn of Object.values(service)) fn.mockReset()
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 3 }])],
      controllers: [DeviceLinksController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerByIpGuard },
        { provide: DeviceLinksService, useValue: service },
        { provide: AuthService, useValue: { verifyApiKey: jest.fn(), trackAccessLog: jest.fn() } },
        { provide: UsersService, useValue: { findOne: jest.fn() } },
        { provide: JwtService, useValue: { verify: jest.fn(() => ({ sub: 'u1' })) } },
      ],
    }).compile()
    app = moduleRef.createNestApplication({ logger: false })
    applyApiConventions(app)
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const server = () => request(app.getHttpServer())

  it('keeps a sentence the service wrote, with its code', async () => {
    service.create.mockRejectedValue(
      new HttpException(
        { error: 'Sign-in is not available right now. Use an API key instead.', code: 'DEVICE_LINKS_OFF' },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
    )
    const res = await server().post('/api/v1/auth/device-links').send({})
    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: 'Sign-in is not available right now. Use an API key instead.',
      code: 'DEVICE_LINKS_OFF',
    })
  })

  it('writes a sentence for an unexpected failure', async () => {
    service.poll.mockRejectedValue(new Error('database down'))
    const res = await server().post('/api/v1/auth/device-links/poll').send({ pollToken: 'x' })
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Something went wrong. Try again.')
  })

  it('writes a sentence for the IP limit', async () => {
    service.poll.mockResolvedValue({ status: 'pending', pollIntervalSeconds: 3 })
    for (let i = 0; i < 3; i++) await server().post('/api/v1/auth/device-links/poll').send({})
    const res = await server().post('/api/v1/auth/device-links/poll').send({})
    expect(res.status).toBe(429)
    expect(res.body.error).toBe('Too many requests. Try again later.')
  })

  it('writes a sentence when the login is missing, and keeps the code', async () => {
    const res = await server().get('/api/v1/auth/device-links/K7QX2M9P')
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ error: 'Log in to continue.', code: 'AUTH_INVALID' })
  })

  // The JSON parser runs before the route, so its answer keeps the default
  // body. The app always sends JSON it built itself.
  it('answers 400 to a body that is not JSON', async () => {
    const res = await server()
      .post('/api/v1/auth/device-links/poll')
      .set('Content-Type', 'application/json')
      .send('{"pollToken":')
    expect(res.status).toBe(400)
    expect(service.poll).not.toHaveBeenCalled()
  })
})
