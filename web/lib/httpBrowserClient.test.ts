import { afterEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'

// Own getSession mock (overriding the global one in test/setup.ts) so calls
// can be counted and resolved per test.
const getSessionMock = vi.hoisted(() => vi.fn())
const signOutMock = vi.hoisted(() => vi.fn())
const loadPageMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', () => ({ loadPage: loadPageMock }))
vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return { ...actual, getSession: getSessionMock, signOut: signOutMock }
})

// The token lives in module state, so each test loads a fresh module copy.
async function loadClient() {
  vi.resetModules()
  return import('@/lib/httpBrowserClient')
}

function captureAuthHeaders() {
  const headers: (string | null)[] = []
  server.use(
    http.get(`${API_BASE_URL}/ping`, ({ request }) => {
      headers.push(request.headers.get('authorization'))
      return HttpResponse.json({ ok: true })
    })
  )
  return headers
}

afterEach(() => {
  getSessionMock.mockReset()
  signOutMock.mockReset()
  loadPageMock.mockReset()
})

describe('httpBrowserClient auth interceptor', () => {
  it('attaches a seeded token without calling getSession', async () => {
    const { default: client, setSessionToken } = await loadClient()
    setSessionToken('abc')
    const headers = captureAuthHeaders()

    await client.get('/ping')

    expect(headers).toEqual(['Bearer abc'])
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('dedupes concurrent session fetches when the token is not seeded', async () => {
    getSessionMock.mockResolvedValue({ user: { accessToken: 'tok1' } })
    const { default: client } = await loadClient()
    const headers = captureAuthHeaders()

    await Promise.all([client.get('/ping'), client.get('/ping')])

    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(headers).toEqual(['Bearer tok1', 'Bearer tok1'])
  })

  it('sends no header and no session fetch when seeded signed out', async () => {
    const { default: client, setSessionToken } = await loadClient()
    // null means known signed out (the 401 handler and the auth pages), so
    // requests must not fall back to a /api/auth/session round trip.
    setSessionToken(null)
    const headers = captureAuthHeaders()

    await client.get('/ping')

    expect(headers).toEqual([null])
    expect(getSessionMock).not.toHaveBeenCalled()
  })

  it('recovers with a fresh fetch after a failed session lookup', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('network down'))
    getSessionMock.mockResolvedValueOnce({ user: { accessToken: 'tok2' } })
    const { default: client } = await loadClient()
    const headers = captureAuthHeaders()

    await expect(client.get('/ping')).rejects.toThrow('network down')
    await client.get('/ping')

    expect(getSessionMock).toHaveBeenCalledTimes(2)
    expect(headers).toEqual(['Bearer tok2'])
  })
})

describe('httpBrowserClient session-expiry interceptor', () => {
  // Set up initial pathname for the interceptor's window.location.pathname check.
  function setInitialPathname(pathname = '/dashboard') {
    window.history.pushState({}, '', pathname)
  }

  function respond401(body: Record<string, unknown>) {
    server.use(
      http.get(`${API_BASE_URL}/ping`, () =>
        HttpResponse.json(body, { status: 401 })
      )
    )
  }

  it('redirects to logout on a 401 carrying the auth-failure code', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/dashboard')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized', code: 'AUTH_INVALID' })

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(navigateMock).toHaveBeenCalledWith('/logout')
  })

  it('leaves a 401 without the auth-failure code to the caller', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/dashboard')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized' })

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('sends the link page to log in and come back to it', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/link-device?code=K7QX-2M9P')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized', code: 'AUTH_INVALID' })
    // In production the login library answers with an address on its own
    // site setting, which is another site than the app
    signOutMock.mockResolvedValue({ url: 'https://textbee.dev/login' })

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(signOutMock).toHaveBeenCalledWith({ redirect: false })
    await vi.waitFor(() =>
      expect(loadPageMock).toHaveBeenCalledWith(
        '/login?redirect=%2Flink-device%3Fcode%3DK7QX-2M9P'
      )
    )
    expect(loadPageMock).toHaveBeenCalledTimes(1)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('still goes to login from the link page when signing out fails', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/link-device')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized', code: 'AUTH_INVALID' })
    signOutMock.mockRejectedValue(new Error('network down'))

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })
    await vi.waitFor(() =>
      expect(loadPageMock).toHaveBeenCalledWith('/login?redirect=%2Flink-device')
    )
  })

  it('does not redirect from the login page, so a normal page cannot loop', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/login')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized', code: 'AUTH_INVALID' })

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(navigateMock).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
    expect(loadPageMock).not.toHaveBeenCalled()
  })

  it('does not redirect again from the logout page itself', async () => {
    const { default: client, setSessionToken, setNavigate } = await loadClient()
    setSessionToken('abc')
    setInitialPathname('/logout')
    const navigateMock = vi.fn()
    setNavigate(navigateMock)
    respond401({ error: 'Unauthorized', code: 'AUTH_INVALID' })

    await expect(client.get('/ping')).rejects.toMatchObject({
      response: { status: 401 },
    })

    expect(navigateMock).not.toHaveBeenCalled()
  })
})
