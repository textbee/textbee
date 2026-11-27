import { describe, expect, it } from 'vitest'
// Next's own matcher compiler, the one the build uses for config.matcher
import * as staticInfo from 'next/dist/build/analysis/get-page-static-info'
import { config } from './proxy'

const { getMiddlewareMatchers } = staticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: string | string[],
    nextConfig: Record<string, unknown>
  ) => Array<{ regexp: string }>
}

const matchers = getMiddlewareMatchers(config.matcher, {}).map(
  ({ regexp }) => new RegExp(regexp)
)
const runsProxy = (pathname: string) => matchers.some((re) => re.test(pathname))

describe('proxy matcher', () => {
  it('skips /version, so the build id answer stays public and cheap', () => {
    expect(runsProxy('/version')).toBe(false)
  })

  it.each([
    '/version/',
    '/versions',
    '/version/x',
    '/versionx',
    '/version.json',
    '/dashboard/version',
    '/api/version',
    '/dashboard',
    '/',
  ])('still runs for %s', (pathname) => {
    expect(runsProxy(pathname)).toBe(true)
  })
})
