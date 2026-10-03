import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import SupportHQWidget from './support-hq-widget'

const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return { ...actual, useSession: useSessionMock }
})

const init = vi.fn()
const destroy = vi.fn()

// A fresh object every call, the way SessionProvider hands one back after a
// refetch even when the underlying user has not changed.
const sessionWith = (overrides: Record<string, unknown> = {}) => ({
  data: {
    user: {
      id: 'user_1',
      name: 'Test User',
      email: 'test@example.com',
      phone: '',
      ...overrides,
    },
  },
})

const scripts = () =>
  document.querySelectorAll('script[src*="supporthq-widget.js"]')

// jsdom does not fetch external scripts, so loading is simulated.
const fireLoad = () =>
  scripts().forEach((s) => (s as HTMLScriptElement).onload?.(new Event('load')))

beforeEach(() => {
  // The widget is gated on this: with no project id it loads nothing, which is
  // the self-hosted default and is covered in analytics-gating.test.tsx.
  vi.stubEnv('NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID', 'test-project')
  init.mockClear()
  destroy.mockClear()
  // @ts-ignore
  window.SupportHQWidget = { init, destroy }
})

afterEach(() => {
  vi.unstubAllEnvs()
  document
    .querySelectorAll('script[src*="supporthq-widget.js"]')
    .forEach((s) => s.remove())
})

describe('SupportHQWidget', () => {
  it('injects the widget script once and initialises with the user metadata', () => {
    useSessionMock.mockReturnValue(sessionWith())
    render(<SupportHQWidget />)

    expect(scripts()).toHaveLength(1)

    fireLoad()
    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][0].metadata).toEqual({
      userId: 'user_1',
      name: 'Test User',
      email: 'test@example.com',
      phone: '',
    })
  })

  // The reported defect: the effect depended on the session object, so a
  // refetch that returned identical data still destroyed and re-injected the
  // widget, closing any chat the user had open.
  it('does not reinitialise when a refetch returns identical data', () => {
    useSessionMock.mockReturnValue(sessionWith())
    const { rerender } = render(<SupportHQWidget />)
    fireLoad()

    useSessionMock.mockReturnValue(sessionWith())
    rerender(<SupportHQWidget />)

    expect(scripts()).toHaveLength(1)
    expect(destroy).not.toHaveBeenCalled()
    expect(init).toHaveBeenCalledTimes(1)
  })

  it('reinitialises when the user metadata actually changes', () => {
    useSessionMock.mockReturnValue(sessionWith())
    const { rerender } = render(<SupportHQWidget />)
    fireLoad()

    useSessionMock.mockReturnValue(sessionWith({ email: 'new@example.com' }))
    rerender(<SupportHQWidget />)
    fireLoad()

    expect(destroy).toHaveBeenCalledTimes(1)
    expect(init).toHaveBeenCalledTimes(2)
    expect(init.mock.calls[1][0].metadata.email).toBe('new@example.com')
  })

  // destroy() tears down the widget but leaves the tag, so without an explicit
  // removal every re-run left another one behind.
  it('leaves no script tags behind when it unmounts', () => {
    useSessionMock.mockReturnValue(sessionWith())
    const { unmount } = render(<SupportHQWidget />)
    fireLoad()

    unmount()

    expect(scripts()).toHaveLength(0)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('does not initialise if the script loads after cleanup', () => {
    useSessionMock.mockReturnValue(sessionWith())
    const { unmount } = render(<SupportHQWidget />)

    const pending = scripts()[0] as HTMLScriptElement
    unmount()
    // A cached src can resolve after the effect was torn down; initialising
    // then would leave a widget that nothing destroys.
    pending.onload?.(new Event('load'))

    expect(init).not.toHaveBeenCalled()
  })

  it('omits metadata when nobody is signed in', () => {
    useSessionMock.mockReturnValue({ data: null })
    render(<SupportHQWidget />)
    fireLoad()

    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0][0]).not.toHaveProperty('metadata')
  })
})

describe('SupportHQWidget mobile launcher', () => {
  afterEach(() => document.getElementById('supporthq-widget-host')?.remove())

  it('adds a mobile-only rule that hides the floating launcher', () => {
    const host = document.createElement('div')
    host.id = 'supporthq-widget-host'
    const shadow = host.attachShadow({ mode: 'open' })
    document.body.appendChild(host)
    useSessionMock.mockReturnValue(sessionWith())
    render(<SupportHQWidget />)
    fireLoad()

    const css = shadow.querySelector('style')?.textContent ?? ''
    expect(css).toContain('max-width: 767.98px')
    expect(css).toContain('.shq-bubble')
  })

  it('keeps the launcher for signed-out visitors, who have no account menu', () => {
    init.mockImplementation(() => {
      const host = document.createElement('div')
      host.id = 'supporthq-widget-host'
      host.attachShadow({ mode: 'open' })
      document.body.appendChild(host)
    })
    useSessionMock.mockReturnValue({ data: null })
    render(<SupportHQWidget />)
    fireLoad()

    const shadow = document.getElementById('supporthq-widget-host')?.shadowRoot
    expect(shadow).toBeTruthy()
    expect(shadow?.querySelector('style')).toBeNull()
    init.mockReset()
  })
})
