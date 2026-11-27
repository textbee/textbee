import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { OptionalAuthGuard } from './optional-auth.guard'
import { AuthService } from '../auth.service'
import { UsersService } from '../../users/users.service'

// Build a minimal ExecutionContext whose HTTP request is `request`.
const contextFor = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext

describe('OptionalAuthGuard', () => {
  let guard: OptionalAuthGuard
  let jwtService: { verify: jest.Mock }
  let usersService: { findOne: jest.Mock }
  let authService: { verifyApiKey: jest.Mock; trackAccessLog: jest.Mock }

  const user = { _id: 'user_1', id: 'user_1' }

  beforeEach(() => {
    jwtService = { verify: jest.fn() }
    usersService = { findOne: jest.fn() }
    authService = { verifyApiKey: jest.fn(), trackAccessLog: jest.fn() }
    guard = new OptionalAuthGuard(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
      authService as unknown as AuthService,
    )
  })

  it('attaches the user when the api key verifies', async () => {
    authService.verifyApiKey.mockResolvedValue({ user: 'user_1' })
    usersService.findOne.mockResolvedValue(user)
    const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toBe(user)
  })

  it('refuses a sign-in key outside its routes with 403 KEY_SCOPE', async () => {
    authService.verifyApiKey.mockResolvedValue({
      user: 'user_1',
      source: 'device-link',
      linkedDevice: '665f1c2ab3d4e5f6a7b8c9d0',
    })
    const request: any = {
      method: 'GET',
      route: { path: '/api/v1/webhooks' },
      params: {},
      headers: { 'x-api-key': 'raw-key' },
      query: {},
    }

    await expect(guard.canActivate(contextFor(request))).rejects.toMatchObject({ status: 403 })
    expect(request.user).toBeUndefined()
  })

  it('allows the request through anonymously when the key does not verify', async () => {
    authService.verifyApiKey.mockResolvedValue(null)
    const request: any = { headers: { 'x-api-key': 'bad-key' }, query: {} }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    // The key failed, so no identity may be attached to the request.
    expect(request.user).toBeUndefined()
    expect(request.apiKey).toBeUndefined()
    expect(usersService.findOne).not.toHaveBeenCalled()
  })

  it('allows the request through anonymously when no credentials are present', async () => {
    const request: any = { headers: {}, query: {} }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toBeUndefined()
    expect(authService.verifyApiKey).not.toHaveBeenCalled()
  })

  it('does not attach a user when the key verifies but the user is gone', async () => {
    authService.verifyApiKey.mockResolvedValue({ user: 'ghost' })
    usersService.findOne.mockResolvedValue(null)
    const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toBeUndefined()
  })

  it('ignores an invalid bearer token without consulting the api key path', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired')
    })
    const request: any = { headers: { authorization: 'Bearer bad' }, query: {} }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request.user).toBeUndefined()
    expect(authService.verifyApiKey).not.toHaveBeenCalled()
  })
})
