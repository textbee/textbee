import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('API guide deployment URL', () => {
  it.each([
    'https://sms.example.test/api/v1',
    'https://sms.example.test/api/v1/',
    'https://sms.example.test/api/v1///',
  ])('uses %s for every REST and SDK example', async (configuredUrl) => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', configuredUrl)
    vi.resetModules()
    const { API_BASE_URL, buildEndpoints } = await import('./snippets')
    expect(API_BASE_URL).toBe('https://sms.example.test/api/v1')
    for (const endpoint of buildEndpoints('device-test-123')) {
      for (const sample of Object.values(endpoint.samples)) {
        expect(sample).toContain(API_BASE_URL)
        expect(sample).not.toContain('api.textbee.dev')
        expect(sample).not.toContain('/api/v1//')
      }
    }
    const send = buildEndpoints('device-test-123')[0]
    expect(send.samples.sdk).toContain("baseUrl: 'https://sms.example.test/api/v1'")
    expect(send.samples['python-sdk']).toContain("base_url='https://sms.example.test/api/v1'")
  })

  it.each([undefined, ''])('keeps the hosted default when unset (%s)', async (value) => {
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', value)
    vi.resetModules()
    const { API_BASE_URL } = await import('./snippets')
    expect(API_BASE_URL).toBe('https://api.textbee.dev/api/v1')
  })
})
