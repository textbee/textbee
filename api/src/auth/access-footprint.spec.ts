import {
  RecentKeys,
  classifyChannel,
  classifyClient,
  requestPath,
} from './access-footprint'

describe('classifyChannel', () => {
  it('treats a bearer token as the dashboard', () => {
    expect(
      classifyChannel({ hasBearer: true, path: '/api/v1/auth/who-am-i' }),
    ).toBe('web')
  })

  it('treats a key on an ordinary route as someone calling the API', () => {
    expect(
      classifyChannel({ hasBearer: false, path: '/api/v1/gateway/devices' }),
    ).toBe('api')
  })

  it.each([
    '/api/v1/gateway/devices/652f1a/heartbeat',
    '/api/v1/gateway/devices/652f1a/receive-sms',
    '/api/v1/gateway/devices/652f1a/receiveSMS',
    '/api/v1/gateway/devices/652f1a/sms-status',
  ])('recognises the phone app by the route %s', (path) => {
    expect(classifyChannel({ hasBearer: false, path })).toBe('device')
  })

  it('recognises the phone app by the client it declares', () => {
    expect(
      classifyChannel({
        hasBearer: false,
        path: '/api/v1/gateway/devices/652f1a/messages',
        sdkClient: 'textbee-android/2.9.0',
      }),
    ).toBe('device')
  })

  it('ignores the query string when matching a route', () => {
    expect(
      classifyChannel({
        hasBearer: false,
        path: '/api/v1/gateway/devices/652f1a/heartbeat?apiKey=abc',
      }),
    ).toBe('device')
  })

  it('does not let a declared client claim the dashboard', () => {
    expect(
      classifyChannel({
        hasBearer: true,
        path: '/api/v1/gateway/devices',
        sdkClient: 'textbee-android/2.9.0',
      }),
    ).toBe('web')
  })

  it('places a request with no path at all', () => {
    expect(classifyChannel({ hasBearer: false })).toBe('api')
  })
})

describe('classifyClient', () => {
  it('prefers the client a caller declares', () => {
    expect(
      classifyClient({
        sdkClient: 'textbee-js/1.4.0',
        userAgent: 'axios/1.7.2',
      }),
    ).toBe('textbee-js')
    expect(classifyClient({ sdkClient: 'textbee-android/2.9.0' })).toBe(
      'textbee-android',
    )
    expect(
      classifyClient({
        sdkClient: 'textbee-python/0.1.0',
        userAgent: 'textbee-python/0.1.0',
      }),
    ).toBe('textbee-python')
  })

  it.each([
    ['textbee-mcp-remote/1.4.0 textbee-mcp/0.2.2 textbee-js/0.6.1', 'textbee-mcp-remote'],
    ['textbee-mcp/0.2.2 textbee-js/0.6.1', 'textbee-mcp'],
    ['textbee-n8n/1.3.0', 'textbee-n8n'],
  ])('names %s', (sdkClient, label) => {
    expect(classifyClient({ sdkClient })).toBe(label)
  })

  it.each([
    ['Mozilla/5.0 (Macintosh) Chrome/127', 'browser'],
    ['curl/8.4.0', 'curl'],
    ['PostmanRuntime/7.37.0', 'postman'],
    ['python-requests/2.31.0', 'python'],
    ['axios/1.7.2', 'node'],
    ['GuzzleHttp/7', 'php'],
    ['Go-http-client/2.0', 'go'],
    ['okhttp/4.12.0', 'java'],
    ['.NET/8.0', 'dotnet'],
  ])('reads %s as %s', (agent, label) => {
    expect(classifyClient({ userAgent: agent })).toBe(label)
  })

  it('falls back to a single label rather than storing the agent', () => {
    expect(classifyClient({ userAgent: 'SomeInternalTool/9 (build 12)' })).toBe(
      'other',
    )
    expect(classifyClient({})).toBe('unknown')
  })

  it('ignores a declared client it does not know', () => {
    expect(
      classifyClient({ sdkClient: 'made-up/1.0', userAgent: 'curl/8.4.0' }),
    ).toBe('curl')
  })
})

describe('requestPath', () => {
  it('drops the query string, where a key can appear', () => {
    expect(requestPath('/api/v1/gateway/devices?apiKey=secret')).toBe(
      '/api/v1/gateway/devices',
    )
    expect(requestPath(undefined)).toBe('')
  })
})

describe('RecentKeys', () => {
  it('remembers a key for the window and forgets it after', () => {
    jest.useFakeTimers()
    try {
      const keys = new RecentKeys<true>(1000, 10)
      keys.remember('a')
      expect(keys.has('a')).toBe(true)

      jest.advanceTimersByTime(1001)
      expect(keys.has('a')).toBe(false)
    } finally {
      jest.useRealTimers()
    }
  })

  it('stores a value, not only the fact of a key', () => {
    const counts = new RecentKeys<number>(1000, 10)
    counts.remember('user|api', 7)
    expect(counts.get('user|api')).toBe(7)
    counts.forget('user|api')
    expect(counts.get('user|api')).toBeUndefined()
  })

  it('never grows past its ceiling', () => {
    const keys = new RecentKeys<true>(60_000, 3)
    for (const key of ['a', 'b', 'c', 'd', 'e']) keys.remember(key)
    expect(keys.size).toBe(3)
    expect(keys.has('a')).toBe(false)
    expect(keys.has('e')).toBe(true)
  })

  it('keeps a key that is still being used', () => {
    const keys = new RecentKeys<true>(60_000, 3)
    keys.remember('hot')
    keys.remember('b')
    keys.remember('c')
    // Reading it moves it away from the eviction end.
    expect(keys.has('hot')).toBe(true)
    keys.remember('d')
    expect(keys.has('hot')).toBe(true)
    expect(keys.has('b')).toBe(false)
  })
})
