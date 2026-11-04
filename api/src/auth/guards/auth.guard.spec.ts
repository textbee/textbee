import { HttpException } from '@nestjs/common'
import { ExecutionContext } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuthGuard } from './auth.guard'
import { AuthService } from '../auth.service'
import { UsersService } from '../../users/users.service'
import * as bcrypt from 'bcryptjs'

// bcryptjs is ESM, so jest.spyOn cannot patch it. Wrap the real calls instead.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual('bcryptjs')
  return {
    ...actual,
    compare: jest.fn(actual.compare),
    compareSync: jest.fn(actual.compareSync),
  }
})

// Build a minimal ExecutionContext whose HTTP request is `request`.
const contextFor = (request: any): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext

describe('AuthGuard', () => {
  let guard: AuthGuard
  let jwtService: { verify: jest.Mock }
  let usersService: { findOne: jest.Mock }
  let authService: {
    verifyApiKey: jest.Mock
    trackAccessLog: jest.Mock
  }

  const user = { _id: 'user_1', id: 'user_1' }

  beforeEach(() => {
    jwtService = { verify: jest.fn() }
    usersService = { findOne: jest.fn() }
    authService = {
      verifyApiKey: jest.fn(),
      trackAccessLog: jest.fn(),
    }
    guard = new AuthGuard(
      jwtService as unknown as JwtService,
      usersService as unknown as UsersService,
      authService as unknown as AuthService,
    )
  })

  describe('bearer token', () => {
    it('resolves the user for a valid bearer token', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user_1' })
      usersService.findOne.mockResolvedValue(user)
      const request: any = { headers: { authorization: 'Bearer good' }, query: {} }

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
      expect(usersService.findOne).toHaveBeenCalledWith({ _id: 'user_1' })
      expect(request.user).toBe(user)
    })

    it('throws 401 when the bearer token is invalid or expired', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired')
      })
      const request: any = { headers: { authorization: 'Bearer bad' }, query: {} }

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        HttpException,
      )
      expect(usersService.findOne).not.toHaveBeenCalled()
    })
  })

  describe('api key', () => {
    it('resolves via x-api-key and attaches request.apiKey when the key verifies', async () => {
      const apiKey = { user: 'user_1' }
      authService.verifyApiKey.mockResolvedValue(apiKey)
      usersService.findOne.mockResolvedValue(user)
      const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
      expect(authService.verifyApiKey).toHaveBeenCalledWith('raw-key')
      expect(request.apiKey).toBe(apiKey)
      expect(request.user).toBe(user)
    })

    it('resolves via the apiKey query param', async () => {
      const apiKey = { user: 'user_1' }
      authService.verifyApiKey.mockResolvedValue(apiKey)
      usersService.findOne.mockResolvedValue(user)
      const request: any = { headers: {}, query: { apiKey: 'raw-key' } }

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
      expect(authService.verifyApiKey).toHaveBeenCalledWith('raw-key')
      expect(request.user).toBe(user)
    })

    it('rejects when the key does not verify', async () => {
      authService.verifyApiKey.mockResolvedValue(null)
      const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        HttpException,
      )
      expect(usersService.findOne).not.toHaveBeenCalled()
    })

    it('never runs bcrypt in the guard itself', async () => {
      const compareSync = jest.mocked(bcrypt.compareSync)
      compareSync.mockClear()
      authService.verifyApiKey.mockResolvedValue({ user: 'user_1' })
      usersService.findOne.mockResolvedValue(user)
      const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

      await guard.canActivate(contextFor(request))
      expect(compareSync).not.toHaveBeenCalled()
    })

    it('prefers the bearer token when both credentials are present', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user_1' })
      usersService.findOne.mockResolvedValue(user)
      const request: any = {
        headers: { authorization: 'Bearer good', 'x-api-key': 'raw-key' },
        query: {},
      }

      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
      expect(authService.verifyApiKey).not.toHaveBeenCalled()
    })

    it('throws 401 when the key verifies but the user no longer exists', async () => {
      authService.verifyApiKey.mockResolvedValue({ user: 'ghost' })
      usersService.findOne.mockResolvedValue(null)
      const request: any = { headers: { 'x-api-key': 'raw-key' }, query: {} }

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        HttpException,
      )
    })
  })

  it('throws 401 when no credentials are present', async () => {
    const request: any = { headers: {}, query: {} }
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      HttpException,
    )
  })

  it('throws 401 when the token resolves a user id but the user no longer exists', async () => {
    jwtService.verify.mockReturnValue({ sub: 'ghost' })
    usersService.findOne.mockResolvedValue(null)
    const request: any = { headers: { authorization: 'Bearer good' }, query: {} }

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      HttpException,
    )
  })

  afterEach(() => jest.restoreAllMocks())
})
