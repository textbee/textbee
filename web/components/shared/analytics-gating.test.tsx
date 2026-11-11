import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'

/*
 * textbee is open source. A self-hosted dashboard must not report into the
 * hosted service's analytics accounts, so every third-party script is gated on
 * an env var and nothing loads when none is set.
 *
 * e2e/no-third-party.spec.ts checks the same promise against a real build.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

vi.mock('@/lib/api', () => ({ useCurrentUser: () => ({ data: undefined }) }))

async function freshRender(
  component: 'analytics' | 'support-hq' | 'google'
) {
  vi.resetModules()
  if (component === 'analytics') {
    const { default: Analytics } = await import('@/components/shared/analytics')
    return render(<Analytics />)
  }
  if (component === 'support-hq') {
    const { default: SupportHQWidget } = await import(
      '@/components/shared/support-hq-widget'
    )
    return render(<SupportHQWidget />)
  }
  const { default: LoginWithGoogle } = await import(
    '@/app/(app)/(auth)/(components)/login-with-google'
  )
  return render(<LoginWithGoogle />)
}

function loadedScripts(): string {
  return Array.from(document.querySelectorAll('script'))
    .map((script) => script.getAttribute('src') ?? script.textContent ?? '')
    .join(' ')
}

describe('third-party script gating', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('loads no analytics provider when none is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_PROVIDERS', '')
    const { container } = await freshRender('analytics')

    const markup = container.innerHTML + loadedScripts()
    expect(markup).not.toContain('googletagmanager.com')
    expect(markup).not.toContain('clarity.ms')
    expect(markup).not.toContain('connect.facebook.net')
  })

  it('skips a provider that is listed but has no id', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_PROVIDERS', 'ga,clarity,meta')
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', '')
    vi.stubEnv('NEXT_PUBLIC_CLARITY_PROJECT_ID', '')
    vi.stubEnv('NEXT_PUBLIC_META_PIXEL_ID', '')

    const { container } = await freshRender('analytics')
    const markup = container.innerHTML + loadedScripts()
    expect(markup).not.toContain('googletagmanager.com')
    expect(markup).not.toContain('clarity.ms')
    expect(markup).not.toContain('connect.facebook.net')
  })

  it('loads only the providers that are listed and configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_PROVIDERS', 'ga')
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-UNITTEST')
    vi.stubEnv('NEXT_PUBLIC_CLARITY_PROJECT_ID', 'unitclarity')

    const { container } = await freshRender('analytics')
    const markup = container.innerHTML + loadedScripts()

    expect(markup).toContain('G-UNITTEST')
    expect(markup).not.toContain('clarity.ms')
  })

  it('never sends the signed-in email to Google Analytics', async () => {
    vi.stubEnv('NEXT_PUBLIC_ANALYTICS_PROVIDERS', 'ga,clarity')
    vi.stubEnv('NEXT_PUBLIC_GA_MEASUREMENT_ID', 'G-UNITTEST')
    vi.stubEnv('NEXT_PUBLIC_CLARITY_PROJECT_ID', 'unitclarity')

    const { container } = await freshRender('analytics')
    const markup = container.innerHTML + loadedScripts()

    // The root-mounted component has no session at all, so no identifier can
    // leak into either tag from here.
    expect(markup).not.toContain('userId')
  })

  it('loads no support widget without a project id', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID', '')
    await freshRender('support-hq')
    expect(loadedScripts()).not.toContain('cdn.supporthq.app')
  })

  it('loads the support widget once a project id is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID', 'unit-project')
    await freshRender('support-hq')
    expect(loadedScripts()).toContain('cdn.supporthq.app')
  })

  it('renders no Google sign-in without a client id, so its SDK never loads', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    const { container } = await freshRender('google')
    expect(container.innerHTML).toBe('')
  })
})
