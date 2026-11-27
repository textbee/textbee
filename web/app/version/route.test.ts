import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, dynamic } from './route'

afterEach(() => vi.unstubAllEnvs())

describe('GET /version', () => {
  it('answers with the build id and is never cached', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'abc123def456.m1x2y3')
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0')
    expect(await res.json()).toEqual({ id: 'abc123def456.m1x2y3' })
  })

  it('is 404 for a build without an id', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '')
    const res = GET()
    expect(res.status).toBe(404)
    expect(res.headers.get('Cache-Control')).toBe('no-store, max-age=0')
  })

  it('is rendered on every request', () => {
    expect(dynamic).toBe('force-dynamic')
  })
})
