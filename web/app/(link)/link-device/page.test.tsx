import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import LinkDevicePanel from './link-device-panel'
import SignedOutPanel from './signed-out-panel'

const getServerSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

async function renderPage(params: Record<string, string | string[]>) {
  const { default: LinkDevicePage } = await import('./page')
  return (await LinkDevicePage({
    searchParams: Promise.resolve(params),
  })) as ReactElement<Record<string, unknown>>
}

beforeEach(() => getServerSession.mockReset())

describe('link page on the server', () => {
  it('shows the signed-out state with the way back to this page', async () => {
    getServerSession.mockResolvedValue(null)
    const page = await renderPage({ code: 'K7QX-2M9P' })
    expect(page.type).toBe(SignedOutPanel)
    expect(page.props.returnTo).toBe('/link-device?code=K7QX-2M9P')
  })

  it('keeps every query value in the way back', async () => {
    getServerSession.mockResolvedValue(null)
    const page = await renderPage({ code: 'K7QX-2M9P', utm: ['a', 'b'] })
    expect(page.props.returnTo).toBe('/link-device?code=K7QX-2M9P&utm=a&utm=b')
  })

  it('hands the address code and the session email to the panel', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
    const page = await renderPage({ code: 'K7QX-2M9P' })
    expect(page.type).toBe(LinkDevicePanel)
    expect(page.props).toEqual({
      addressCode: 'K7QX-2M9P',
      sessionEmail: 'jane@example.com',
      sessionName: '',
    })
  })

  it('passes no code when the address has none', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
    const page = await renderPage({})
    expect(page.props.addressCode).toBeUndefined()
    // The panel builds the way back from the address when it is needed
    expect(page.props.returnTo).toBeUndefined()
  })
})

describe('link page headers', () => {
  it('sends no referrer and refuses frames on the link page only', async () => {
    const loadConfig = (await import('../../../next.config.js')).default as (
      phase: string
    ) => { headers: () => Promise<Array<{ source: string; headers: unknown[] }>> }
    const config = loadConfig('phase-development-server')
    const rules = await config.headers()
    expect(rules).toEqual([
      {
        source: '/link-device',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
    ])
  })
})
