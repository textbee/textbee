import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants'

type Config = { env?: Record<string, string> }
const loadConfig = async () =>
  (await import('./next.config.js')).default as (phase: string) => Config

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('build id', () => {
  it('is the Vercel deployment id when there is one', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', undefined)
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_abc123')
    const config = (await loadConfig())(PHASE_PRODUCTION_BUILD)
    expect(config.env).toEqual({ NEXT_PUBLIC_BUILD_ID: 'dpl_abc123' })
  })

  it('is the short commit and the build time otherwise', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', undefined)
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef0123')
    const config = (await loadConfig())(PHASE_PRODUCTION_BUILD)
    expect(config.env?.NEXT_PUBLIC_BUILD_ID).toMatch(/^0123456789ab\.[0-9a-z]+$/)
  })

  it('stays the same when the config loads again in the same build', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', undefined)
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', '')
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc')
    vi.useFakeTimers()
    const load = await loadConfig()
    const first = load(PHASE_PRODUCTION_BUILD).env?.NEXT_PUBLIC_BUILD_ID
    vi.setSystemTime(Date.now() + 60_000)
    expect(load(PHASE_PRODUCTION_BUILD).env?.NEXT_PUBLIC_BUILD_ID).toBe(first)
  })

  it('is absent in next dev', async () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', undefined)
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_abc123')
    const config = (await loadConfig())(PHASE_DEVELOPMENT_SERVER)
    expect(config.env).toBeUndefined()
    expect(process.env.NEXT_PUBLIC_BUILD_ID).toBeUndefined()
  })
})
