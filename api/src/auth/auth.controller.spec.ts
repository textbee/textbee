import { HttpStatus, RequestMethod } from '@nestjs/common'
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants'
import { AuthController } from './auth.controller'

describe('AuthController correct-email routes', () => {
  const emailCorrectionService = {
    eligibility: jest.fn().mockResolvedValue({ eligible: true }),
    correctEmail: jest.fn().mockResolvedValue({
      message: 'We sent a verification link to bob@gmail.com.',
      email: 'bob@gmail.com',
      sent: true,
    }),
  }
  const controller = new AuthController(
    {} as any,
    {} as any,
    emailCorrectionService as any,
    {} as any,
  )
  const handler = (name: keyof AuthController) =>
    AuthController.prototype[name] as (...args: any[]) => unknown

  it('serves GET /correct-email with the eligibility as the body', async () => {
    const req = { user: { _id: 'user_1' } }

    await expect(controller.correctEmailEligibility(req)).resolves.toEqual({
      eligible: true,
    })
    expect(emailCorrectionService.eligibility).toHaveBeenCalledWith(req)
    expect(Reflect.getMetadata(PATH_METADATA, handler('correctEmailEligibility'))).toBe(
      '/correct-email',
    )
    expect(
      Reflect.getMetadata(METHOD_METADATA, handler('correctEmailEligibility')),
    ).toBe(RequestMethod.GET)
  })

  it('serves POST /correct-email with 200 and the service result as the body', async () => {
    const req = { user: { _id: 'user_1' } }
    const input = { newEmail: 'bob@gmail.com', currentPassword: 'secret' }

    await expect(controller.correctEmail(input, req)).resolves.toEqual({
      message: 'We sent a verification link to bob@gmail.com.',
      email: 'bob@gmail.com',
      sent: true,
    })
    expect(emailCorrectionService.correctEmail).toHaveBeenCalledWith(req, input)
    expect(Reflect.getMetadata(METHOD_METADATA, handler('correctEmail'))).toBe(
      RequestMethod.POST,
    )
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('correctEmail'))).toBe(
      HttpStatus.OK,
    )
  })

  it('limits POST /correct-email to 10 requests per hour per IP', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler('correctEmail'))).toBe(
      10,
    )
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler('correctEmail'))).toBe(
      60 * 60 * 1000,
    )
  })
})

describe('AuthController who-am-i', () => {
  const controller = new AuthController({} as any, {} as any, {} as any, {} as any)
  const user = {
    _id: 'user_1',
    name: 'Sam',
    email: 'sam@example.com',
    phone: '+15555550123',
    role: 'regular',
    signupLocation: { city: 'Toronto' },
  }

  it('answers the whole account for a login session, as before', async () => {
    const answer = await controller.whoAmI({ user })
    expect(answer.data).toBe(user)
  })

  it('answers the whole account and the account label for a hand-made key', async () => {
    const handMade = { user, apiKey: { _id: 'key_1', user: 'user_1' } }
    await expect(controller.whoAmI(handMade)).resolves.toEqual({
      data: { ...user, accountLabel: 'sam@example.com' },
    })
  })

  it('leaves the account label out for an account without an email', async () => {
    const noEmail = { _id: 'user_2', name: 'Sam' }
    const handMade = await controller.whoAmI({ user: noEmail, apiKey: { _id: 'key_1' } })
    expect(handMade.data).not.toHaveProperty('accountLabel')
    const signIn = await controller.whoAmI({
      user: noEmail,
      apiKey: { _id: 'key_2', source: 'device-link', linkedDevice: 'd1' },
    })
    expect(signIn.data).not.toHaveProperty('accountLabel')
  })

  it('answers only the name, the email and the account label for a phone sign-in key', async () => {
    const req = { user, apiKey: { _id: 'key_2', source: 'device-link', linkedDevice: 'd1' } }
    await expect(controller.whoAmI(req)).resolves.toEqual({
      data: { name: 'Sam', email: 'sam@example.com', accountLabel: 'sam@example.com' },
    })
  })
})

describe('AuthController revoke', () => {
  const disconnectRevokedSignInKey = jest.fn()
  const moduleRef = { get: jest.fn().mockReturnValue({ disconnectRevokedSignInKey }) }
  const revokeApiKey = jest.fn()
  const controller = new AuthController(
    { revokeApiKey } as any,
    {} as any,
    {} as any,
    moduleRef as any,
  )
  const signIn = { _id: 'key_2', source: 'device-link', linkedDevice: 'd1' }

  beforeEach(() => {
    disconnectRevokedSignInKey.mockReset().mockResolvedValue(undefined)
    revokeApiKey.mockReset()
  })

  it('disconnects the device of a sign-in key', async () => {
    revokeApiKey.mockResolvedValue(signIn)

    await expect(controller.revokeApiKey({ id: 'key_2' })).resolves.toEqual({
      message: 'API Key Revoked',
    })
    expect(disconnectRevokedSignInKey).toHaveBeenCalledWith(signIn)
  })

  it('touches no device for a hand-made key, as before', async () => {
    revokeApiKey.mockResolvedValue({ _id: 'key_1' })
    await controller.revokeApiKey({ id: 'key_1' })
    expect(disconnectRevokedSignInKey).not.toHaveBeenCalled()
  })

  it('runs the disconnect again for a sign-in key that was revoked already, so a retry heals a failed one', async () => {
    revokeApiKey.mockResolvedValue({ ...signIn, revokedAt: new Date() })
    await controller.revokeApiKey({ id: 'key_2' })
    expect(disconnectRevokedSignInKey).toHaveBeenCalledTimes(1)
  })

  it('answers 200 and logs when the disconnect fails after the revoke', async () => {
    revokeApiKey.mockResolvedValue(signIn)
    disconnectRevokedSignInKey.mockRejectedValue(new Error('database down'))
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(controller.revokeApiKey({ id: 'key_2' })).resolves.toEqual({
      message: 'API Key Revoked',
    })
    expect(log).toHaveBeenCalledWith(
      'failed to disconnect the device of a revoked sign-in key',
      expect.any(Error),
    )
    log.mockRestore()
  })
})
