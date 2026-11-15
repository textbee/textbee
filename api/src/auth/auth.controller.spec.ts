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
