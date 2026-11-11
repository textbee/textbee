import { beforeEach, describe, expect, it, vi } from 'vitest'

const post = vi.hoisted(() => vi.fn())
vi.mock('@/lib/httpServerClient', () => ({ httpServerClient: { post } }))

import { authOptions } from '@/lib/auth'

function credentialsProvider(id: string) {
  const provider = authOptions.providers.find(
    (entry: any) => entry.options?.id === id
  ) as any
  return provider.options
}

describe('email-password-login', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({
      data: { data: { user: { _id: 'user_1' }, accessToken: 'token' } },
    })
  })

  it("forwards the visitor's browser details to the API", async () => {
    await credentialsProvider('email-password-login').authorize(
      {
        email: 'ada@example.com',
        password: 'a-valid-password',
        turnstileToken: 'turnstile',
      },
      {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'cf-connecting-ip': '203.0.113.4',
          'cf-ipcountry': 'US',
        },
      }
    )

    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        email: 'ada@example.com',
        client: {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          ip: '203.0.113.4',
          country: 'US',
        },
      })
    )
  })
})

describe('google-id-token-login', () => {
  const MESSAGE =
    'This email is linked to another Google account. Sign in with your password or reset it.'

  const apiError = (status: number, data: unknown) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data },
    })

  const authorize = () =>
    credentialsProvider('google-id-token-login').authorize(
      { idToken: 'token' },
      { headers: {} }
    )

  beforeEach(() => {
    post.mockReset()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('returns the user with the new-account flag', async () => {
    post.mockResolvedValue({
      data: {
        data: { user: { _id: 'user_1' }, accessToken: 'token', isNewUser: true },
      },
    })

    await expect(authorize()).resolves.toEqual({
      _id: 'user_1',
      accessToken: 'token',
      isNewUser: true,
    })
  })

  it('passes the API message on for a 409', async () => {
    post.mockRejectedValue(apiError(409, { error: MESSAGE }))

    await expect(authorize()).rejects.toThrow(MESSAGE)
  })

  it('returns null for other failures', async () => {
    post.mockRejectedValue(apiError(401, { error: 'Unauthorized' }))
    await expect(authorize()).resolves.toBeNull()

    post.mockRejectedValue(apiError(409, {}))
    await expect(authorize()).resolves.toBeNull()

    post.mockRejectedValue(new Error('Network Error'))
    await expect(authorize()).resolves.toBeNull()
  })
})
