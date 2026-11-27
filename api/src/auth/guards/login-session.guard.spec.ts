import { ExecutionContext, HttpException } from '@nestjs/common'
import { LoginSessionGuard } from './login-session.guard'

const contextFor = (request: any): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext

describe('LoginSessionGuard', () => {
  const guard = new LoginSessionGuard()

  it('lets a dashboard login through', () => {
    expect(guard.canActivate(contextFor({ headers: { authorization: 'Bearer t' }, query: {} }))).toBe(true)
  })

  it.each([
    ['an API key header', { headers: { 'x-api-key': 'k' }, query: {} }],
    ['an API key query', { headers: {}, query: { apiKey: 'k' } }],
    ['a login and an API key', { headers: { authorization: 'Bearer t', 'x-api-key': 'k' }, query: {} }],
    ['a login and an empty API key', { headers: { authorization: 'Bearer t' }, query: { apiKey: '' } }],
    ['nothing', { headers: {}, query: {} }],
    ['another scheme', { headers: { authorization: 'Basic x' }, query: {} }],
  ])('refuses %s with 401', (_name, request) => {
    try {
      guard.canActivate(contextFor(request))
      throw new Error('not refused')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException)
      expect((error as HttpException).getStatus()).toBe(401)
      expect((error as HttpException).getResponse()).toEqual({
        error: 'Unauthorized',
        code: 'AUTH_INVALID',
      })
    }
  })
})
