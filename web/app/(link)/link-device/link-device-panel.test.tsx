import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/test/render'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { DeviceLinkLookup } from '@/lib/api/types'
import { AxiosError } from 'axios'
import httpBrowserClient from '@/lib/httpBrowserClient'
import LinkDevicePanel, {
  TEXT,
  disconnectedText,
  turnOnLimitText,
} from './link-device-panel'

const signOutMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>()
  return {
    ...actual,
    signOut: signOutMock,
    getSession: async () => ({ user: { accessToken: 'test-access-token' } }),
  }
})

const loadPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/device-link')>()),
  loadPage,
}))

const STORE_KEY = 'textbee.linkDevice.typedCode'
const DEVICE_ID = '665f1c2ab3d4e5f6a7b8c9d0'
const OTHER_ID = '664a1c2ab3d4e5f6a7b8c9d1'

function lookupData(over: Partial<DeviceLinkLookup> = {}): DeviceLinkLookup {
  return {
    mode: 'choose',
    status: 'pending',
    phone: { name: 'Google Pixel 8', brand: 'Google', model: 'Pixel 8' },
    requestedFrom: 'Canada (approximate)',
    browserFrom: 'Canada (approximate)',
    sameNetwork: true,
    strongSameNetwork: true,
    mustTypeCode: false,
    accountEmail: 'jane@example.com',
    emailVerified: true,
    expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
    defaultName: 'Google Pixel 8',
    deviceLimit: { limit: 2, active: 1, reached: false },
    suggested: DEVICE_ID,
    message: null,
    options: [
      {
        type: 'reconnect',
        deviceId: DEVICE_ID,
        name: 'Pixel 8',
        brand: 'Google',
        model: 'Pixel 8',
        lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        enabled: true,
        match: 'same-phone',
        warning: null,
        allowed: true,
        group: 'main',
      },
      { type: 'new', allowed: true, warning: null, group: 'main' },
      {
        type: 'reconnect',
        deviceId: OTHER_ID,
        name: 'Shop phone',
        brand: 'samsung',
        model: 'SM-A346E',
        lastSeenAt: null,
        enabled: true,
        match: 'other',
        warning: {
          code: 'W2',
          text: 'This device is in use on another phone. That phone stops sending and receiving SMS if you continue.',
        },
        allowed: true,
        group: 'replace',
      },
    ],
    ...over,
  }
}

type Calls = { lookups: string[]; approvals: unknown[]; denials: string[] }

function mockApi({
  lookup = () => HttpResponse.json({ data: lookupData() }),
  approve = () => HttpResponse.json({ data: { status: 'approved' } }),
  deny = () => HttpResponse.json({ data: { status: 'denied' } }),
}: {
  lookup?: () => Response | Promise<Response>
  approve?: () => Response | Promise<Response>
  deny?: () => Response | Promise<Response>
} = {}): Calls {
  const calls: Calls = { lookups: [], approvals: [], denials: [] }
  server.use(
    http.get(`${API_BASE_URL}/auth/device-links/:code`, ({ params }) => {
      calls.lookups.push(String(params.code))
      return lookup()
    }),
    http.post(
      `${API_BASE_URL}/auth/device-links/:code/approve`,
      async ({ request }) => {
        calls.approvals.push(await request.json())
        return approve()
      }
    ),
    http.post(`${API_BASE_URL}/auth/device-links/:code/deny`, ({ params }) => {
      calls.denials.push(String(params.code))
      return deny()
    })
  )
  return calls
}

// "Switch account", then the confirm button of its dialog
async function switchAndConfirm() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Switch account' })
  )
  await userEvent.click(
    await screen.findByRole('button', { name: 'Log out and switch' })
  )
}

function renderPanel(addressCode?: string) {
  return renderWithProviders(
    <LinkDevicePanel
      addressCode={addressCode}
      sessionEmail='session@example.com'
    />
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  signOutMock.mockReset()
  loadPage.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('link page without a code', () => {
  it('asks for the code and checks it before any request', async () => {
    const calls = mockApi()
    renderPanel()

    const field = await screen.findByLabelText('Enter the code shown in the app')
    await userEvent.type(field, 'abc')
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button).toBeDisabled()
    // Enter on a code that is not complete explains, and sends nothing
    await userEvent.type(field, '{Enter}')

    expect(
      screen.getByText('Check the code. It has 8 letters and numbers.')
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(calls.lookups).toEqual([])
  })

  it('treats a code typed on the page as typed and sends it with the approval', async () => {
    const calls = mockApi()
    renderPanel()

    await userEvent.type(
      await screen.findByLabelText('Enter the code shown in the app'),
      'k7qx2m9p'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', {
      name: 'Connect this device?',
    })
    expect(calls.lookups).toEqual(['K7QX2M9P'])

    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, typedCode: 'K7QX2M9P' },
    ])
    expect(
      screen.queryByRole('link', { name: 'Back to devices' })
    ).not.toBeInTheDocument()
  })
})

describe('link page with a code in the address', () => {
  it('shows the request, the server choices and selects the suggestion', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')

    expect(
      await screen.findByRole('heading', {
        name: 'Connect this device?',
      })
    ).toBeInTheDocument()
    // The account row shows the email of the account the server names
    expect(screen.getByTitle('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('Google Pixel 8')).toBeInTheDocument()
    expect(screen.getByText('(name sent by the device)')).toBeInTheDocument()
    expect(screen.getByText('Canada (approximate)')).toBeInTheDocument()
    expect(screen.getByText('K7QX-2M9P')).toBeInTheDocument()

    const reconnect = screen.getByRole('radio', { name: /Reconnect Pixel 8/ })
    expect(reconnect).toBeChecked()
    expect(screen.getByText('Google Pixel 8. Last active 2 hours ago.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Add as a new device' })).not.toBeChecked()
    // The replace group starts closed while something is suggested
    expect(
      screen.getByText('Use this device in place of an older one').closest('details')
    ).not.toHaveAttribute('open')
    expect(screen.getByText(TEXT.safety)).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/^\d:\d\d$/)
  })

  it('approves a reconnect without a typed code', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect device' })
    )
    expect(await screen.findByText(TEXT.done)).toBeInTheDocument()
    expect(calls.approvals).toEqual([{ action: 'reconnect', deviceId: DEVICE_ID }])
  })

  it('sends the name for a new device', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    await userEvent.click(
      await screen.findByRole('radio', { name: 'Add as a new device' })
    )
    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Google Pixel 8')
    await userEvent.clear(name)
    await userEvent.type(name, 'Shop phone')
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))

    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'new', name: 'Shop phone' }])
  })

  it('shows warnings and keeps a choice that is not allowed off', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            suggested: null,
            deviceLimit: { limit: 1, active: 1, reached: true },
            options: [
              {
                type: 'new',
                allowed: false,
                warning: {
                  code: 'M2',
                  text: 'Your plan allows 1 active device. To connect this phone, choose a device below. This phone takes its place.',
                },
                group: 'main',
              },
              {
                type: 'reconnect',
                deviceId: OTHER_ID,
                name: 'Shop phone',
                brand: 'samsung',
                model: 'SM-A346E',
                lastSeenAt: null,
                enabled: true,
                warning: {
                  code: 'W2',
                  text: 'This device is in use on another phone. That phone stops sending and receiving SMS if you continue.',
                },
                allowed: true,
                group: 'replace',
              },
            ],
          }),
        }),
    })
    renderPanel('K7QX-2M9P')

    const addNew = await screen.findByRole('radio', { name: 'Add as a new device' })
    expect(addNew).toBeDisabled()
    expect(
      screen.getByText(/Your plan allows 1 active device/)
    ).toBeInTheDocument()
    // Nothing suggested and adding is off: the group is open
    expect(
      screen.getByText('Use this device in place of an older one').closest('details')
    ).toHaveAttribute('open')
    const shop = screen.getByRole('radio', { name: /Reconnect Shop phone/ })
    expect(shop).toHaveAccessibleDescription(
      'This device is in use on another phone. That phone stops sending and receiving SMS if you continue.'
    )
    const connect = screen.getByRole('button', { name: 'Connect device' })
    expect(connect).toBeDisabled()
    await userEvent.click(shop)
    expect(connect).toBeEnabled()
  })

  it('shows the server message and selects nothing on another network', async () => {
    const message =
      'This phone and this browser may be on different networks, so nothing is selected. Choose a device only if this phone used it before.'
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            mode: 'reconnect-only',
            suggested: null,
            message,
            options: [lookupData().options[0]],
          }),
        }),
    })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByText(message)).toBeInTheDocument()
    const only = screen.getByRole('radio', { name: /Reconnect Pixel 8/ })
    expect(only).not.toBeChecked()
    expect(
      screen.queryByRole('radio', { name: 'Add as a new device' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeDisabled()
    await userEvent.click(only)
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeEnabled()
  })

  it('hides the code and asks for it when the networks differ', async () => {
    const calls = mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({ mustTypeCode: true, sameNetwork: false }),
        }),
    })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByText(TEXT.typeCode)).toBeInTheDocument()
    expect(screen.queryByText('K7QX-2M9P')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    expect(
      screen.getByText('Check the code. It has 8 letters and numbers.')
    ).toBeInTheDocument()
    expect(calls.approvals).toEqual([])

    await userEvent.type(screen.getByLabelText('Code from the app'), 'k7qx-2m9p')
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, typedCode: 'K7QX2M9P' },
    ])
  })

  it('shows the plan limit text from the server and lets the user choose again', async () => {
    const m2 =
      'Your plan allows 2 active devices. To connect this phone, choose a device below. This phone takes its place.'
    mockApi({
      approve: () =>
        HttpResponse.json({ error: m2, code: 'DEVICE_LIMIT' }, { status: 409 }),
    })
    renderPanel('K7QX-2M9P')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect device' })
    )
    expect(await screen.findByText(m2)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeEnabled()
  })

  it('cancels the request', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      await screen.findByRole('heading', { name: TEXT.cancelledTitle })
    ).toBeInTheDocument()
    expect(calls.denials).toEqual(['K7QX2M9P'])
    expect(calls.approvals).toEqual([])
  })

  it('tells a second tab of the same user that the request is approved', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ status: 'approved' }) }),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { name: TEXT.alreadyTitle })
    ).toBeInTheDocument()
  })

  it('shows the M1 text and no connect button for a phone of another account', async () => {
    const m1 =
      'This phone is connected to another textbee account. Log in to that account. To use this phone with a new account, open the textbee app, go to Settings and tap Disconnect Device first.'
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({ mode: 'blocked', suggested: null, message: m1, options: [] }),
        }),
    })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByText(m1)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect device' })
    ).not.toBeInTheDocument()
  })

  it('shows the unverified email line', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ emailVerified: false }) }),
    })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByText(TEXT.unverified)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).toBeInTheDocument()
  })

  it('shows both places when the countries differ', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({ browserFrom: 'Germany (approximate)' }),
        }),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByText(
        'The phone: Canada (approximate). This browser: Germany (approximate).'
      )
    ).toBeInTheDocument()
  })

  it('ends in an expired state with a way to a new code when time runs out', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            expiresAt: new Date(Date.now() + 1200).toISOString(),
          }),
        }),
    })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('button', { name: 'Connect device' })
    expect(
      await screen.findByRole('heading', { name: TEXT.expiredTitle }, { timeout: 3000 })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect device' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter a new code' }))
    expect(screen.getByLabelText('Enter the code shown in the app')).toHaveValue('')
  })
})

describe('link page answers that stop the flow', () => {
  it('shows a 503 with the server text, a retry and the way back', async () => {
    const calls = mockApi({
      lookup: () =>
        HttpResponse.json(
          {
            error: 'Sign-in is not available right now. Use an API key instead.',
            code: 'DEVICE_LINKS_OFF',
          },
          { status: 503 }
        ),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { name: 'Sign-in not available' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Sign-in is not available right now. Use an API key instead.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.lookups).toEqual(['K7QX2M9P', 'K7QX2M9P']))
  })

  it('shows the text of an account that cannot connect, with the next steps', async () => {
    const text = 'This account cannot connect a phone. Contact support.'
    mockApi({
      approve: () => HttpResponse.json({ error: text }, { status: 403 }),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect device' })
    )
    expect(await screen.findByRole('heading', { name: text })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter another code' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
  })
})

describe('code handed over by the dashboard', () => {
  it('uses the stored code as typed, removes it and offers the way back', async () => {
    window.sessionStorage.setItem(STORE_KEY, 'K7QX2M9P')
    const calls = mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ mustTypeCode: true }) }),
    })
    renderPanel()

    await screen.findByRole('button', { name: 'Connect device' })
    expect(window.sessionStorage.getItem(STORE_KEY)).toBeNull()
    expect(calls.lookups).toEqual(['K7QX2M9P'])
    // Typed already: the page does not ask again and shows the code
    expect(screen.queryByText(TEXT.typeCode)).not.toBeInTheDocument()
    expect(screen.getByText('K7QX-2M9P')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, typedCode: 'K7QX2M9P' },
    ])
    expect(
      screen.getByRole('link', { name: 'Back to devices' })
    ).toHaveAttribute('href', '/dashboard')
  })

  it('ignores and removes a stored code when the address has one', async () => {
    window.sessionStorage.setItem(STORE_KEY, 'AAAABBBB')
    const calls = mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ mustTypeCode: true }) }),
    })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByText(TEXT.typeCode)).toBeInTheDocument()
    expect(window.sessionStorage.getItem(STORE_KEY)).toBeNull()
    expect(calls.lookups).toEqual(['K7QX2M9P'])
  })
})

describe('account switch', () => {
  // In production the login library answers with an address on its own
  // site setting, which is another site than the app
  const OTHER_SITE = 'https://textbee.dev/link-device?code=K7QX-2M9P'

  afterEach(() => window.history.replaceState(null, '', '/'))

  it('logs out and loads this page on the current site, code kept', async () => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P')
    signOutMock.mockResolvedValue({ url: OTHER_SITE })
    mockApi()
    renderPanel('K7QX-2M9P')
    await switchAndConfirm()
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith('/link-device?code=K7QX-2M9P')
    )
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false })
    expect(loadPage).not.toHaveBeenCalledWith(OTHER_SITE)
  })

  it('returns to the address as it is now, without a refused code', async () => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P')
    signOutMock.mockResolvedValue({ url: OTHER_SITE })
    mockApi({ lookup: () => HttpResponse.json({}, { status: 404 }) })
    renderPanel('K7QX-2M9P')
    await screen.findByRole('alert')
    expect(window.location.search).toBe('')
    await switchAndConfirm()
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/link-device'))
  })

  it('never returns to another page of this site', async () => {
    window.history.replaceState(null, '', '/dashboard')
    signOutMock.mockResolvedValue({ url: OTHER_SITE })
    mockApi()
    renderPanel('K7QX-2M9P')
    await switchAndConfirm()
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/link-device'))
  })

  it('still loads this page when signing out fails', async () => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P')
    signOutMock.mockRejectedValue(new Error('network down'))
    mockApi()
    renderPanel('K7QX-2M9P')
    await switchAndConfirm()
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith('/link-device?code=K7QX-2M9P')
    )
  })
})

describe('link page review fixes', () => {
  it('names the choice group and reads each warning once', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            options: [lookupData().options[0], lookupData().options[1], lookupData().options[2]],
          }),
        }),
    })
    renderPanel('K7QX-2M9P')
    const group = await screen.findByRole('group', { name: 'Choose a device' })
    expect(group.tagName).toBe('FIELDSET')
    await userEvent.click(screen.getByText('Use this device in place of an older one'))
    const shop = screen.getByRole('radio', { name: /^Reconnect Shop phone/ })
    expect(shop).not.toHaveAccessibleName(/Another phone/)
    expect(shop).toHaveAccessibleDescription(
      'This device is in use on another phone. That phone stops sending and receiving SMS if you continue.'
    )
  })

  it('selects the only choice when the list holds just a new device', async () => {
    const calls = mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            suggested: null,
            options: [{ type: 'new', allowed: true, warning: null, group: 'main' }],
          }),
        }),
    })
    renderPanel('K7QX-2M9P')

    const only = await screen.findByRole('radio', { name: 'Add as a new device' })
    expect(only).toBeChecked()
    expect(screen.getByLabelText('Name')).toHaveValue('Google Pixel 8')
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'new', name: 'Google Pixel 8' }])
  })

  it('asks for the code when approve says it must be typed', async () => {
    const mismatch = 'The code does not match the code on the phone.'
    let answer = () =>
      HttpResponse.json(
        { error: mismatch, code: 'TYPED_CODE' },
        { status: 400 }
      ) as Response
    const calls = mockApi({ approve: () => answer() })
    renderPanel('K7QX-2M9P')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect device' })
    )
    const field = await screen.findByLabelText('Code from the app')
    expect(screen.getByText(mismatch)).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(mismatch)
    expect(screen.queryByText('K7QX-2M9P')).not.toBeInTheDocument()

    answer = () => HttpResponse.json({ data: { status: 'approved' } })
    await userEvent.type(field, 'K7QX2M9P')
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID },
      { action: 'reconnect', deviceId: DEVICE_ID, typedCode: 'K7QX2M9P' },
    ])
  })

  it('sends one approval for a double press', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: unknown[] = []
    mockApi()
    server.use(
      http.post(
        `${API_BASE_URL}/auth/device-links/:code/approve`,
        async ({ request }) => {
          calls.push(await request.json())
          await gate
          return HttpResponse.json({ data: { status: 'approved' } })
        }
      )
    )
    renderPanel('K7QX-2M9P')
    const connect = await screen.findByRole('button', { name: 'Connect device' })
    await userEvent.click(connect)
    await userEvent.click(connect)
    release()
    await screen.findByText(TEXT.done)
    expect(calls).toHaveLength(1)
  })

  it('loads the request once and not again on focus, reconnect or visibility', async () => {
    const calls = mockApi()
    // The session provider reads the session again when the browser is back online
    server.use(http.get('*/api/auth/session', () => HttpResponse.json({})))
    renderPanel('K7QX-2M9P')
    await screen.findByRole('button', { name: 'Connect device' })

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.lookups).toEqual(['K7QX2M9P'])
  })

  it('leads an ended login to log in and back, with no error on the page', async () => {
    window.history.pushState({}, '', '/link-device?code=K7QX-2M9P')
    mockApi({
      lookup: () =>
        HttpResponse.json(
          { error: 'Unauthorized', code: 'AUTH_INVALID' },
          { status: 401 }
        ),
    })
    signOutMock.mockResolvedValue({ url: 'https://textbee.dev/login' })
    renderPanel('K7QX-2M9P')
    await waitFor(() =>
      expect(loadPage).toHaveBeenCalledWith(
        '/login?redirect=%2Flink-device%3Fcode%3DK7QX-2M9P'
      )
    )
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false })
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    window.history.pushState({}, '', '/')
  })

  it('offers nothing to approve inside a frame', async () => {
    const calls = mockApi()
    window.sessionStorage.setItem(STORE_KEY, 'K7QX2M9P')
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    try {
      renderPanel('K7QX-2M9P')
      expect(await screen.findByText(TEXT.framed)).toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(calls.lookups).toEqual([])
      expect(window.sessionStorage.getItem(STORE_KEY)).toBeNull()
    } finally {
      top.mockRestore()
    }
  })

  it('shows any other 400 as a normal error, with no code field', async () => {
    const text = 'This choice is not available. Reload the page.'
    mockApi({
      approve: () => HttpResponse.json({ error: text }, { status: 400 }),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect device' })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(screen.queryByLabelText('Code from the app')).not.toBeInTheDocument()
    expect(screen.getByText('K7QX-2M9P')).toBeInTheDocument()
  })

  it('sends no lookup in a frame from the first render after hydration', async () => {
    const calls = mockApi()
    const panel = (
      <LinkDevicePanel
        addressCode='K7QX-2M9P'
        sessionEmail='session@example.com'
      />
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(panel)
    document.body.appendChild(container)
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    try {
      let root: ReturnType<typeof hydrateRoot> | undefined
      await act(async () => {
        root = hydrateRoot(container, panel)
      })
      expect(container).toHaveTextContent(TEXT.framed)
      expect(container.querySelector('button')).toBeNull()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(calls.lookups).toEqual([])
      act(() => root?.unmount())
    } finally {
      top.mockRestore()
      container.remove()
    }
  })

  it('counts down from the seconds the server sends, not the browser clock', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            secondsLeft: 1,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          }),
        }),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { name: TEXT.expiredTitle }, { timeout: 3000 })
    ).toBeInTheDocument()
  })

  it('corrects a browser clock that runs ahead with the Date header', async () => {
    const browserNow = Date.now()
    // The server's clock is 5 minutes behind; one minute is left on it
    const serverNow = browserNow - 5 * 60 * 1000
    mockApi({
      lookup: () =>
        HttpResponse.json(
          {
            data: lookupData({
              expiresAt: new Date(serverNow + 60 * 1000).toISOString(),
            }),
          },
          { headers: { Date: new Date(serverNow).toUTCString() } }
        ),
    })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByRole('timer')).toHaveTextContent(/^(0:5\d|1:0\d)$/)
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeEnabled()
    expect(screen.queryByText(TEXT.expired)).not.toBeInTheDocument()
  })
})

describe('make the new phone the default device', () => {
  const BOX = /^Make it the default device/
  const WITH_DEFAULT =
    'Sends without a device ID go to the default device. Now: Office phone.'
  const WITHOUT_DEFAULT =
    'Sends without a device ID go to the device that was active last. Tick this to always use this device.'

  function lookupWith(over: Partial<DeviceLinkLookup>) {
    return () => HttpResponse.json({ data: lookupData({ suggested: 'new', ...over }) })
  }

  it('offers an unticked box with the current default under a new device', async () => {
    mockApi({ lookup: lookupWith({ defaultChoice: { currentDefaultName: 'Office phone' } }) })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(WITH_DEFAULT)
  })

  it('explains the last active phone when the account has no default', async () => {
    mockApi({ lookup: lookupWith({ defaultChoice: { currentDefaultName: null } }) })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByRole('checkbox', { name: BOX })).toHaveAccessibleDescription(
      WITHOUT_DEFAULT
    )
  })

  it('shows the default device name as plain text', async () => {
    mockApi({
      lookup: lookupWith({ defaultChoice: { currentDefaultName: '<b>Shop</b>' } }),
    })
    const { container } = renderPanel('K7QX-2M9P')
    await screen.findByRole('checkbox', { name: BOX })
    expect(
      screen.getByText(
        'Sends without a device ID go to the default device. Now: <b>Shop</b>.'
      )
    ).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
  })

  it('sends makeDefault only when the box is ticked', async () => {
    const calls = mockApi({
      lookup: lookupWith({ defaultChoice: { currentDefaultName: 'Office phone' } }),
    })
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('checkbox', { name: BOX }))
    expect(screen.getByRole('checkbox', { name: BOX })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'new', name: 'Google Pixel 8', makeDefault: true },
    ])
  })

  it('sends no makeDefault without the tick', async () => {
    const calls = mockApi({
      lookup: lookupWith({ defaultChoice: { currentDefaultName: 'Office phone' } }),
    })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('checkbox', { name: BOX })
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'new', name: 'Google Pixel 8' }])
  })

  it('hides the box for a reconnect and never sends it', async () => {
    const calls = mockApi({
      lookup: lookupWith({ defaultChoice: { currentDefaultName: 'Office phone' } }),
    })
    renderPanel('K7QX-2M9P')

    // Ticked under the new device, then the user picks a reconnect
    await userEvent.click(await screen.findByRole('checkbox', { name: BOX }))
    await userEvent.click(screen.getByRole('radio', { name: /Reconnect Pixel 8/ }))
    expect(screen.queryByRole('checkbox', { name: BOX })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'reconnect', deviceId: DEVICE_ID }])
  })

  it.each([
    ['null', { defaultChoice: null }],
    ['missing', {}],
  ])('shows no box when the answer has defaultChoice %s', async (_name, over) => {
    const calls = mockApi({ lookup: lookupWith(over) })
    renderPanel('K7QX-2M9P')

    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'new', name: 'Google Pixel 8' }])
  })
})

describe('turn this device on', () => {
  const BOX = 'Turn this device on'
  type Box = { default: boolean; allowed: boolean; disconnectedAt?: string | null }
  // The suggested device, turned off, with the box the server sends
  const offLookup = (turnOn: Box | null | undefined, over: Partial<DeviceLinkLookup> = {}) => {
    const data = lookupData(over)
    const [first, ...rest] = data.options
    return () =>
      HttpResponse.json({
        data: {
          ...data,
          options: [{ ...first, enabled: false, turnOn }, ...rest],
        },
      })
  }
  const disconnectedAt = new Date(new Date().getFullYear(), 10, 27, 12).toISOString()

  it('after a dashboard disconnect: ticked, with the date, and sends turnOn true', async () => {
    const calls = mockApi({
      lookup: offLookup({ default: true, allowed: true, disconnectedAt }),
    })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).toBeChecked()
    expect(box).toBeEnabled()
    expect(box).toHaveAccessibleDescription(
      'Off since it was disconnected in the dashboard on 27 Nov.'
    )
    expect(screen.getByRole('radio', { name: /Reconnect Pixel 8\s*Off/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: true },
    ])
  })

  it('sends turnOn false when the user unticks the box', async () => {
    const calls = mockApi({
      lookup: offLookup({ default: true, allowed: true, disconnectedAt }),
    })
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('checkbox', { name: BOX }))
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
    ])
  })

  it('turned off by the user: unticked, says so, and the user can tick it', async () => {
    const calls = mockApi({
      lookup: offLookup({ default: false, allowed: true, disconnectedAt: null }),
    })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'You turned this device off. It stays off unless you tick this.'
    )
    await userEvent.click(box)
    expect(box).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: true },
    ])
  })

  it('turned off by the user, ticked by default in choose mode: says how to keep it off', async () => {
    const calls = mockApi({
      lookup: offLookup({ default: true, allowed: true, disconnectedAt: null }),
    })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).toBeChecked()
    expect(box).toHaveAccessibleDescription(
      'You turned this device off. Untick this to keep it off.'
    )
    // The line follows the default, not the current tick
    await userEvent.click(box)
    expect(box).toHaveAccessibleDescription(TEXT.turnedOffBySelfTicked)
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
    ])
  })

  it('at the limit: unticked and locked, with the reason and a way to Devices', async () => {
    const calls = mockApi({
      lookup: offLookup(
        { default: false, allowed: false, disconnectedAt },
        { deviceLimit: { limit: 2, active: 2, reached: true } }
      ),
    })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).not.toBeChecked()
    expect(box).toBeDisabled()
    expect(box).toHaveAccessibleDescription(
      'Your plan allows 2 active devices, and 2 are on. Turn one off first. Open Devices Check again'
    )
    const link = screen.getByRole('link', { name: TEXT.openDevices })
    expect(link).toHaveAttribute('href', '/dashboard')
    expect(link).toHaveAttribute('target', '_blank')
    // The phone can still connect, off
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
    ])
  })

  it('sends the choice on screen when "Try again" follows a change of the box', async () => {
    let approvals = 0
    const calls = mockApi({
      lookup: offLookup({ default: true, allowed: true, disconnectedAt }),
      approve: () =>
        ++approvals === 1
          ? HttpResponse.error()
          : HttpResponse.json({ data: { status: 'approved' } }),
    })
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: BOX }))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: true },
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
    ])
  })

  it('reads the choices again on return to the page, quietly, once a device was turned off', async () => {
    let lookups = 0
    const locked = offLookup(
      { default: false, allowed: false, disconnectedAt },
      { deviceLimit: { limit: 2, active: 2, reached: true } }
    )
    const freed = offLookup(
      { default: true, allowed: true, disconnectedAt },
      { deviceLimit: { limit: 2, active: 1, reached: false } }
    )
    const calls = mockApi({ lookup: () => (++lookups === 1 ? locked() : freed()) })
    renderPanel('K7QX-2M9P')

    const box = await screen.findByRole('checkbox', { name: BOX })
    expect(box).toBeDisabled()
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BOX })).toBeEnabled())
    expect(screen.getByRole('checkbox', { name: BOX })).toBeChecked()
    // The form stayed on screen with the same choice
    expect(screen.getByRole('radio', { name: /Reconnect Pixel 8\s*Off/ })).toBeChecked()
    expect(calls.lookups).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: true },
    ])
  })

  it('offers "Check again" beside the limit line', async () => {
    let lookups = 0
    const locked = offLookup(
      { default: false, allowed: false, disconnectedAt },
      { deviceLimit: { limit: 2, active: 2, reached: true } }
    )
    const freed = offLookup(
      { default: true, allowed: true, disconnectedAt },
      { deviceLimit: { limit: 2, active: 1, reached: false } }
    )
    mockApi({ lookup: () => (++lookups === 1 ? locked() : freed()) })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('checkbox', { name: BOX })
    await userEvent.click(screen.getByRole('button', { name: TEXT.checkAgain }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BOX })).toBeEnabled())
  })

  const lockedAndFreed = () => ({
    locked: offLookup(
      { default: false, allowed: false, disconnectedAt },
      { deviceLimit: { limit: 2, active: 2, reached: true } }
    ),
    freed: offLookup(
      { default: true, allowed: true, disconnectedAt },
      { deviceLimit: { limit: 2, active: 1, reached: false } }
    ),
  })

  it('runs one check at a time and uses only its answer', async () => {
    const { locked, freed } = lockedAndFreed()
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let lookups = 0
    const calls = mockApi({
      lookup: async () => {
        lookups += 1
        if (lookups === 1) return locked()
        await gate
        return freed()
      },
    })
    // The session provider reads the session again when the page becomes visible
    server.use(http.get('*/api/auth/session', () => HttpResponse.json({})))
    renderPanel('K7QX-2M9P')
    await screen.findByRole('checkbox', { name: BOX })

    window.dispatchEvent(new Event('focus'))
    await screen.findByText(TEXT.checking)
    // Past the gap between checks, but the first check still runs
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 10_000)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls.lookups).toHaveLength(2)
    clock.mockRestore()

    release()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BOX })).toBeEnabled())
    expect(calls.lookups).toHaveLength(2)
  })

  it('sends the choice on screen after a check changed it, and the failed one when it did not', async () => {
    const { locked, freed } = lockedAndFreed()
    let lookups = 0
    let approvals = 0
    const calls = mockApi({
      lookup: () => {
        lookups += 1
        return lookups <= 2 ? locked() : freed()
      },
      approve: () =>
        ++approvals <= 2
          ? HttpResponse.error()
          : HttpResponse.json({ data: { status: 'approved' } }),
    })
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    // A check that changes nothing keeps the failed approval for "Try again"
    await userEvent.click(screen.getByRole('button', { name: TEXT.checkAgain }))
    await screen.findByRole('button', { name: TEXT.checkAgain })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    // A check that frees the limit ticks the box, so "Try again" sends that
    await userEvent.click(screen.getByRole('button', { name: TEXT.checkAgain }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: BOX })).toBeChecked())
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: false },
      { action: 'reconnect', deviceId: DEVICE_ID, turnOn: true },
    ])
  })

  it('keeps the choices on screen when the check fails', async () => {
    let lookups = 0
    const locked = offLookup(
      { default: false, allowed: false, disconnectedAt },
      { deviceLimit: { limit: 2, active: 2, reached: true } }
    )
    mockApi({ lookup: () => (++lookups === 1 ? locked() : HttpResponse.error()) })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('checkbox', { name: BOX })
    await userEvent.click(screen.getByRole('button', { name: TEXT.checkAgain }))
    expect(await screen.findByRole('button', { name: TEXT.checkAgain })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: BOX })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeEnabled()
  })

  it('writes the limit line in singular and without numbers it does not have', () => {
    expect(turnOnLimitText(1, 1)).toBe(
      'Your plan allows 1 active device, and 1 is on. Turn one off first.'
    )
    expect(turnOnLimitText(3, undefined)).toBe(
      'Your plan allows 3 active devices. Turn one off first.'
    )
    expect(turnOnLimitText(null, 2)).toBe(
      'Your plan has no room for another active device. Turn one off first.'
    )
  })

  it('writes the disconnect date with the year when it is another year, or no date', () => {
    expect(disconnectedText('2024-11-27T12:00:00.000Z')).toBe(
      'Off since it was disconnected in the dashboard on 27 Nov 2024.'
    )
    expect(disconnectedText(null)).toBe('Off since it was disconnected in the dashboard.')
    expect(disconnectedText('not a date')).toBe(
      'Off since it was disconnected in the dashboard.'
    )
  })

  it('shows the box only while that device is chosen', async () => {
    mockApi({ lookup: offLookup({ default: true, allowed: true, disconnectedAt }) })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('checkbox', { name: BOX })
    await userEvent.click(screen.getByRole('radio', { name: 'Add as a new device' }))
    expect(screen.queryByRole('checkbox', { name: BOX })).not.toBeInTheDocument()
  })

  it('shows no tag and no box for a device that is on', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    const connect = await screen.findByRole('button', { name: 'Connect device' })
    expect(screen.getByRole('radio', { name: /Reconnect Pixel 8/ })).toBeChecked()
    expect(screen.queryByText(TEXT.offTag)).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(connect)
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'reconnect', deviceId: DEVICE_ID }])
  })

  it.each([
    ['null', null],
    ['missing', undefined],
  ])('tags an off device but shows no box when the server sends %s', async (_name, turnOn) => {
    const calls = mockApi({ lookup: offLookup(turnOn) })
    renderPanel('K7QX-2M9P')

    const connect = await screen.findByRole('button', { name: 'Connect device' })
    expect(screen.getByText(TEXT.offTag)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(connect)
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'reconnect', deviceId: DEVICE_ID }])
  })
})

describe('account row and switching account', () => {
  function renderWith(name: string, email = 'session@example.com') {
    return renderWithProviders(
      <LinkDevicePanel
        sessionEmail={email}
        sessionName={name}
      />
    )
  }

  it('shows the initial, the name and the email', async () => {
    renderWith('Jane Doe')
    await screen.findByLabelText('Enter the code shown in the app')
    expect(screen.getByText('J')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Jane Doe')).toHaveAttribute('title', 'Jane Doe')
    expect(screen.getByTitle('session@example.com')).toHaveTextContent(
      'session@example.com'
    )
    expect(screen.getByRole('heading', { level: 1, name: TEXT.title })).toBeInTheDocument()
    expect(screen.getByText(TEXT.enterLine)).toBeInTheDocument()
  })

  it('shows only the email when the session has no name', async () => {
    renderWith('  ')
    await screen.findByLabelText('Enter the code shown in the app')
    expect(screen.getByText('S')).toHaveAttribute('aria-hidden', 'true')
    const email = screen.getByTitle('session@example.com')
    expect(email).toHaveClass('font-medium')
    expect(screen.getAllByText('session@example.com')).toHaveLength(1)
  })

  it('cuts long values and keeps them in full in the title', async () => {
    const longName = 'Jane Alexandra Montgomery-Smithson of the Very Long Name'
    const longEmail = 'jane.alexandra.montgomery.smithson@very-long-company-name.example.com'
    renderWith(longName, longEmail)
    await screen.findByLabelText('Enter the code shown in the app')
    expect(screen.getByTitle(longName)).toHaveClass('truncate')
    expect(screen.getByTitle(longEmail)).toHaveClass('truncate')
  })

  it('shows the name as plain text', async () => {
    renderWith('<b>Jane</b>')
    await screen.findByLabelText('Enter the code shown in the app')
    expect(screen.getByText('<b>Jane</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('asks before switching and signs out only on the confirm button', async () => {
    renderWith('Jane Doe')
    const switchButton = await screen.findByRole('button', { name: 'Switch account' })
    await userEvent.click(switchButton)

    const dialog = await screen.findByRole('alertdialog', { name: 'Switch account?' })
    expect(dialog).toHaveTextContent(
      'You will be logged out of Jane Doe. Log in with the other account to come back to this page. The code keeps working until it expires.'
    )
    expect(signOutMock).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(switchButton).toHaveFocus()
    expect(signOutMock).not.toHaveBeenCalled()
    expect(loadPage).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Enter the code shown in the app')).toBeInTheDocument()
  })

  it('names the email in the dialog when the session has no name', async () => {
    renderWith('')
    await userEvent.click(await screen.findByRole('button', { name: 'Switch account' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      'You will be logged out of session@example.com.'
    )
  })

  it('runs the sign-out path once on "Log out and switch"', async () => {
    signOutMock.mockResolvedValue({ url: 'https://textbee.dev/link-device' })
    renderWith('Jane Doe')
    await switchAndConfirm()
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/link-device'))
    expect(signOutMock).toHaveBeenCalledTimes(1)
    expect(signOutMock).toHaveBeenCalledWith({ redirect: false })
  })

  it('shows no account row inside a frame', async () => {
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    try {
      renderWith('Jane Doe')
      expect(await screen.findByText(TEXT.framed)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Switch account' })).not.toBeInTheDocument()
      expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument()
    } finally {
      top.mockRestore()
    }
  })
})

describe('approval title', () => {
  it('has the approval question as its only page title', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'Connect this device?',
    })
    expect(title).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TEXT.title })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})

describe('approval layout', () => {
  it('shows the safety text at body size, normal colour, with no box', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const note = (await screen.findByText(TEXT.safety)).parentElement as HTMLElement
    expect(note).toHaveClass('text-sm')
    expect(note).not.toHaveClass('text-muted-foreground')
    expect(note).not.toHaveClass('border')
    expect(TEXT.safety).toBe(
      'Only continue if you started this on a phone you have with you. If someone sent you this link or code, cancel.'
    )
  })

  it('keeps the email out of the heading', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'Connect this device?',
    })
    expect(title).not.toHaveTextContent('jane@example.com')
  })

  it('shows the place, the code and the time left on one line', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const timer = await screen.findByRole('timer')
    const line = timer.closest('p') as HTMLElement
    expect(line).toHaveTextContent(/^Canada \(approximate\)\s· Code K7QX-2M9P\s· \d:\d\d left$/)
    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument()
  })

  it('leaves the code out of the line when it must be typed', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ mustTypeCode: true }) }),
    })
    renderPanel('K7QX-2M9P')
    const line = (await screen.findByRole('timer')).closest('p') as HTMLElement
    expect(line).not.toHaveTextContent('Code')
  })

  it('shows a warning as a line of text, with no box', async () => {
    const text =
      'This device is in use on another phone. That phone stops sending and receiving SMS if you continue.'
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByText('Use this device in place of an older one')
    )
    const warning = screen.getByText(text).parentElement as HTMLElement
    expect(warning.tagName).toBe('P')
    expect(warning).toHaveClass('text-warning')
    expect(warning).not.toHaveClass('border')
    expect(warning.className).not.toMatch(/\bbg-/)
  })

  it('keeps the choices flat: no box and no tint per row', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const radio = await screen.findByRole('radio', { name: /Reconnect Pixel 8/ })
    const row = radio.closest('label')?.parentElement as HTMLElement
    expect(row).not.toHaveClass('border')
    expect(row.className).not.toMatch(/bg-/)
  })
})

describe('default device label', () => {
  function lookupWith(current: string | null) {
    return () =>
      HttpResponse.json({
        data: lookupData({
          suggested: 'new',
          defaultChoice: { currentDefaultName: current },
        }),
      })
  }

  it('names the current default after the label', async () => {
    mockApi({ lookup: lookupWith('Office phone') })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('checkbox', {
        name: 'Make it the default device (now: Office phone)',
      })
    ).toBeInTheDocument()
  })

  it('shows the label alone without a current default', async () => {
    mockApi({ lookup: lookupWith(null) })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('checkbox', { name: 'Make it the default device' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/\(now:/)).not.toBeInTheDocument()
  })
})

describe('device second line', () => {
  it('says "Not seen yet" for a device that never reported in', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByText('Use this device in place of an older one')
    )
    expect(screen.getByText('samsung SM-A346E. Not seen yet.')).toBeInTheDocument()
    expect(screen.getByText('Google Pixel 8. Last active 2 hours ago.')).toBeInTheDocument()
  })
})

describe('facts line wrapping and places', () => {
  it('lets a long place wrap and keeps the code and the time whole', async () => {
    const place = 'South Georgia & South Sandwich Islands (approximate)'
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({ requestedFrom: place, browserFrom: place }),
        }),
    })
    renderPanel('K7QX-2M9P')
    const line = (await screen.findByRole('timer')).closest('p') as HTMLElement
    expect(line).toHaveTextContent(place)
    const placeFact = screen.getByText(place, { exact: false })
    expect(placeFact).not.toHaveClass('whitespace-nowrap')
    const code = screen.getByText('K7QX-2M9P').closest('.whitespace-nowrap')
    expect(code).not.toBeNull()
    expect(code).not.toHaveTextContent(place)
    expect(screen.getByRole('timer').closest('.whitespace-nowrap')).not.toBeNull()
  })

  it('names the place once when the countries differ', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({ browserFrom: 'Germany (approximate)' }),
        }),
    })
    renderPanel('K7QX-2M9P')
    const line = (await screen.findByRole('timer')).closest('p') as HTMLElement
    expect(line).not.toHaveTextContent('Canada')
    expect(line).toHaveTextContent(/^Code K7QX-2M9P\s· \d:\d\d left$/)
    expect(
      screen.getByText(
        'The phone: Canada (approximate). This browser: Germany (approximate).'
      )
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Canada \(approximate\)/)).toHaveLength(1)
  })
})

// One test per row of the state table: what the user sees, and that a next
// step is always there without a reload
describe('every state has a next step', () => {
  const FIELD = 'Enter the code shown in the app'
  const notFound = (text?: string) => () =>
    HttpResponse.json(text ? { error: text } : {}, { status: 404 })

  // Answers in turn; the last one repeats
  function inTurn(...answers: Array<() => Response>) {
    let index = 0
    return () => answers[Math.min(index++, answers.length - 1)]()
  }

  async function typeAndContinue(code = 'k7qx2m9p') {
    const field = await screen.findByLabelText(FIELD)
    await userEvent.type(field, code)
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    return field as HTMLInputElement
  }

  afterEach(() => window.history.replaceState(null, '', '/'))

  it('enter, empty: Continue is off until the code is complete', async () => {
    mockApi()
    renderPanel()
    const field = await screen.findByLabelText(FIELD)
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(field).toHaveValue('')
    expect(button).toBeDisabled()
    // Neutral while it waits for the code, not a faded accent
    expect(button).toHaveClass('disabled:bg-muted')
    await userEvent.type(field, 'k7qx')
    expect(field).toHaveValue('K7QX-')
    expect(button).toBeDisabled()
    await userEvent.type(field, '2m9p')
    expect(button).toBeEnabled()
    expect(button).not.toHaveClass('disabled:bg-muted')
  })

  it('enter, complete: Enter in the field submits', async () => {
    const calls = mockApi()
    renderPanel()
    await userEvent.type(await screen.findByLabelText(FIELD), 'k7qx2m9p{Enter}')
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(calls.lookups).toEqual(['K7QX2M9P'])
  })

  it('checking: busy, field read-only, no second lookup', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls = mockApi()
    server.use(
      http.get(`${API_BASE_URL}/auth/device-links/:code`, async ({ params }) => {
        calls.lookups.push(String(params.code))
        await gate
        return HttpResponse.json({ data: lookupData() })
      })
    )
    renderPanel()
    const field = await typeAndContinue()
    const button = screen.getByRole('button', { name: /Continue/ })
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    expect(button).toBeDisabled()
    expect(field).toHaveAttribute('readonly')
    await userEvent.type(field, '{Enter}')
    release()
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(calls.lookups).toEqual(['K7QX2M9P'])
  })

  it('wrong, expired or used code: back on the field with the code selected and the server text', async () => {
    const text = 'This code is not valid or has expired. Check the code in the app.'
    const calls = mockApi({ lookup: inTurn(notFound(text), () => HttpResponse.json({ data: lookupData() })) })
    renderPanel()
    await typeAndContinue()

    const error = await screen.findByRole('alert')
    expect(error).toHaveTextContent(text)
    const field = screen.getByLabelText(FIELD) as HTMLInputElement
    expect(field).toHaveValue('K7QX-2M9P')
    expect(field).toHaveFocus()
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 9])
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(text)

    // Typing over the selected code clears the error; Continue tries again
    await userEvent.type(field, 'k7qx2m9p', { skipClick: true })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(calls.lookups).toEqual(['K7QX2M9P', 'K7QX2M9P'])
  })

  it('wrong code from a server that sends no text: the page text', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json(
          { message: 'Cannot GET', error: 'Not Found', statusCode: 404 },
          { status: 404 }
        ),
    })
    renderPanel()
    await typeAndContinue()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code is not valid or has expired. Check the code in the app.'
    )
  })

  it('a link whose code is wrong: an empty field with the error, the address cleaned', async () => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P&x=1')
    mockApi({ lookup: notFound('This code is not valid or has expired. Check the code in the app.') })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This code is not valid or has expired. Check the code in the app.'
    )
    expect(screen.getByLabelText(FIELD)).toHaveValue('')
    expect(window.location.search).toBe('?x=1')
  })

  // A code from a link must never pass as typed: the field stays empty, so
  // nothing can be sent until the user enters the code
  it.each([
    ['with a letter the alphabet has not', 'K7QXO2M9P'],
    ['with a ninth character', 'K7QX2M9PA'],
    ['that is too short', 'K7QO-2M9P'],
  ])('a link whose code cannot be a code (%s): an empty field with a hint, no lookup', async (_name, code) => {
    window.history.replaceState(null, '', `/link-device?code=${code}`)
    const calls = mockApi()
    renderPanel(code)
    const field = await screen.findByLabelText(FIELD)
    // A hint, not an error: the user typed nothing yet
    const note = screen.getByText(TEXT.linkNoCode)
    expect(note).toHaveClass('text-muted-foreground')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(field).toHaveValue('')
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).toHaveAccessibleDescription(TEXT.linkNoCode)
    expect(field).toHaveAttribute('placeholder', '')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(calls.lookups).toEqual([])
    expect(window.location.search).toBe('')

    // An Enter that picks a keyboard suggestion keeps the hint, no error
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })
    expect(screen.getByText(TEXT.linkNoCode)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Typing removes the hint and shows no error
    await userEvent.type(field, 'k7', { skipClick: true })
    expect(screen.queryByText(TEXT.linkNoCode)).not.toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'false')
    // Enter on an incomplete code is the user's own error
    await userEvent.type(field, '{Enter}', { skipClick: true })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the code. It has 8 letters and numbers.'
    )
    expect(calls.lookups).toEqual([])
  })

  it('too many tries (429) on a link code: an empty field, the code asked for when the user types it', async () => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P')
    const text = 'Too many wrong codes. Try again later.'
    const calls = mockApi({
      lookup: inTurn(
        () => HttpResponse.json({ error: text }, { status: 429 }),
        () => HttpResponse.json({ data: lookupData({ mustTypeCode: true }) })
      ),
    })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    const field = screen.getByLabelText(FIELD)
    expect(field).toHaveValue('')
    await userEvent.type(field, '{Enter}', { skipClick: true })
    expect(calls.lookups).toEqual(['K7QX2M9P'])
    // Typed by the user: the code counts as typed and is sent with the approval
    await userEvent.type(field, 'k7qx2m9p{Enter}', { skipClick: true })
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(screen.queryByLabelText('Code from the app')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect device' }))
    await screen.findByRole('heading', { name: TEXT.doneTitle })
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID, typedCode: 'K7QX2M9P' },
    ])
  })

  it('too many tries (429): the server text on the field, the code kept, Continue usable after an edit', async () => {
    const text = 'Too many wrong codes. Try again later.'
    const calls = mockApi({ lookup: () => HttpResponse.json({ error: text }, { status: 429 }) })
    renderPanel()
    const first = await typeAndContinue()
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    // The field that opens with the error, not the one that was sent
    const field = screen.getByLabelText(FIELD)
    expect(field).not.toBe(first)
    expect(field).toHaveValue('K7QX-2M9P')
    // The code is selected: typing replaces it
    await userEvent.type(field, 'k7qx2m9p', { skipClick: true })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() => expect(calls.lookups).toHaveLength(2))
  })

  it('network error on the lookup: the text and a retry that repeats it', async () => {
    const calls = mockApi({
      lookup: inTurn(
        () => HttpResponse.error(),
        () => HttpResponse.json({ data: lookupData() })
      ),
    })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByRole('heading', { name: TEXT.unreachableTitle })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(calls.lookups).toEqual(['K7QX2M9P', 'K7QX2M9P'])
  })

  it('network error on approve: an inline retry that sends the same approval', async () => {
    const calls = mockApi({
      approve: inTurn(
        () => HttpResponse.error(),
        () => HttpResponse.json({ data: { status: 'approved' } })
      ),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: TEXT.doneTitle })
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID },
      { action: 'reconnect', deviceId: DEVICE_ID },
    ])
  })

  it('network error on approve: the retry sends the approval that failed, not a choice made since', async () => {
    const calls = mockApi({
      approve: inTurn(
        () => HttpResponse.error(),
        () => HttpResponse.json({ data: { status: 'approved' } })
      ),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Add as a new device/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: TEXT.doneTitle })
    expect(calls.approvals).toEqual([
      { action: 'reconnect', deviceId: DEVICE_ID },
      { action: 'reconnect', deviceId: DEVICE_ID },
    ])
  })

  it('keeps the choices off while an approval runs', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi({
      approve: async () => {
        await gate
        return HttpResponse.json({ data: { status: 'approved' } })
      },
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Add as a new device/ })).toBeDisabled()
    )
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    release()
    await screen.findByRole('heading', { name: TEXT.doneTitle })
  })

  it('network error on cancel: an inline retry that cancels', async () => {
    const calls = mockApi({
      deny: inTurn(
        () => HttpResponse.error(),
        () => HttpResponse.json({ data: { status: 'denied' } })
      ),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: TEXT.cancelledTitle })
    expect(calls.denials).toHaveLength(2)
  })

  it.each([
    ['expired', notFound(), TEXT.expiredTitle],
    ['approved in another tab', () => HttpResponse.json({ data: lookupData({ status: 'approved' }) }), TEXT.alreadyTitle],
    ['cancelled elsewhere', () => HttpResponse.json({ data: lookupData({ status: 'denied' }) }), TEXT.cancelledTitle],
  ])('approve answers 404 and the request was %s', async (_name, second, heading) => {
    mockApi({
      lookup: inTurn(() => HttpResponse.json({ data: lookupData() }), second),
      approve: notFound(),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  })

  it('cancel answers 404: the request ended, with a way to a new code', async () => {
    mockApi({
      lookup: inTurn(() => HttpResponse.json({ data: lookupData() }), notFound()),
      deny: notFound(),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: TEXT.expiredTitle })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter a new code' })).toBeInTheDocument()
  })

  it.each([
    ['cancelled', () => HttpResponse.json({ data: lookupData({ status: 'denied' }) }), TEXT.cancelledTitle],
    ['already approved', () => HttpResponse.json({ data: lookupData({ status: 'approved' }) }), TEXT.alreadyTitle],
  ])('%s: another code, or back to the dashboard', async (_name, lookup, heading) => {
    window.history.replaceState(null, '', '/link-device?code=K7QX-2M9P')
    mockApi({ lookup })
    renderPanel('K7QX-2M9P')
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Back to dashboard' })
    expect(back).toHaveAttribute('href', '/dashboard')
    // The main button first: on top on a phone, on the right when wider
    const main = screen.getByRole('button', { name: 'Enter another code' })
    const row = main.parentElement as HTMLElement
    expect(row).toHaveClass('flex-col', 'sm:flex-row-reverse')
    expect(row.firstElementChild).toBe(main)
    expect(row).toContainElement(back)
    await userEvent.click(main)
    expect(screen.getByLabelText(FIELD)).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
  })

  it('settling after a 404: both buttons stay off until the check answers', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let lookups = 0
    mockApi({ approve: notFound() })
    server.use(
      http.get(`${API_BASE_URL}/auth/device-links/:code`, async () => {
        lookups += 1
        if (lookups === 1) return HttpResponse.json({ data: lookupData() })
        await gate
        return HttpResponse.json({ data: lookupData({ status: 'approved' }) })
      })
    )
    renderPanel('K7QX-2M9P')
    const connect = await screen.findByRole('button', { name: 'Connect device' })
    await userEvent.click(connect)
    await waitFor(() => expect(lookups).toBe(2))
    expect(connect).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    release()
    expect(await screen.findByRole('heading', { name: TEXT.alreadyTitle })).toBeInTheDocument()
  })

  it.each([
    ['a lost connection', () => HttpResponse.error(), TEXT.unreachableTitle, TEXT.failed],
    [
      'too many tries',
      () => HttpResponse.json({ error: 'Too many wrong codes. Try again later.' }, { status: 429 }),
      TEXT.tooManyTitle,
      'Too many wrong codes. Try again later.',
    ],
  ])('settling fails with %s: its own state and a retry, not "Code expired"', async (_name, failure, title, text) => {
    const calls = mockApi({
      lookup: inTurn(
        () => HttpResponse.json({ data: lookupData() }),
        failure,
        () => HttpResponse.json({ data: lookupData({ status: 'denied' }) })
      ),
      approve: notFound(),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TEXT.expiredTitle })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: TEXT.cancelledTitle })).toBeInTheDocument()
    expect(calls.lookups).toHaveLength(3)
  })

  it.each([
    ['still pending', () => HttpResponse.json({ data: lookupData({ status: 'pending' }) })],
    ['with no status', () => HttpResponse.json({ data: {} })],
    ['with an unknown status', () => HttpResponse.json({ data: lookupData({ status: 'other' as never }) })],
  ])('settling answers %s: a retry, not "Code expired"', async (_name, answer) => {
    const calls = mockApi({
      lookup: inTurn(
        () => HttpResponse.json({ data: lookupData() }),
        answer,
        () => HttpResponse.json({ data: lookupData({ status: 'approved' }) })
      ),
      approve: notFound(),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByRole('heading', { name: TEXT.unreachableTitle })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TEXT.expiredTitle })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: TEXT.alreadyTitle })).toBeInTheDocument()
    expect(calls.lookups).toHaveLength(3)
  })

  // Answers once the gate opens
  function gated(answer: () => Response) {
    let open = () => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    return {
      open,
      answer: async () => {
        await gate
        return answer()
      },
    }
  }

  it('time running out while the check after a 404 runs: the check decides', async () => {
    const check = gated(() => HttpResponse.json({ data: lookupData({ status: 'approved' }) }))
    let lookups = 0
    mockApi({ approve: notFound() })
    server.use(
      http.get(`${API_BASE_URL}/auth/device-links/:code`, () => {
        lookups += 1
        return lookups === 1
          ? HttpResponse.json({ data: lookupData({ secondsLeft: 1 }) })
          : check.answer()
      })
    )
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    await waitFor(() => expect(lookups).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(screen.queryByRole('heading', { name: TEXT.expiredTitle })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    check.open()
    expect(await screen.findByRole('heading', { name: TEXT.alreadyTitle })).toBeInTheDocument()
  })

  it('time running out while approve runs and then fails: "Code expired" once it answers', async () => {
    const approval = gated(() => HttpResponse.error())
    mockApi({
      lookup: () => HttpResponse.json({ data: lookupData({ secondsLeft: 1 }) }),
      approve: approval.answer,
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    await new Promise((resolve) => setTimeout(resolve, 1300))
    expect(screen.queryByRole('heading', { name: TEXT.expiredTitle })).not.toBeInTheDocument()
    approval.open()
    expect(await screen.findByRole('heading', { name: TEXT.expiredTitle })).toBeInTheDocument()
  })

  it('"Try again" shows the loading state and sends one lookup for a double press', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let lookups = 0
    mockApi()
    server.use(
      http.get(`${API_BASE_URL}/auth/device-links/:code`, async () => {
        lookups += 1
        if (lookups === 1) return HttpResponse.error()
        await gate
        return HttpResponse.json({ data: lookupData() })
      })
    )
    renderPanel()
    await typeAndContinue()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    await userEvent.dblClick(retry)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TEXT.unreachableTitle })).not.toBeInTheDocument()
    release()
    await screen.findByRole('heading', { name: 'Connect this device?' })
    expect(lookups).toBe(2)
  })

  it('done from a link: another phone, or back to the dashboard', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByRole('heading', { name: TEXT.doneTitle })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Connect another device' }))
    expect(screen.getByLabelText(FIELD)).toHaveValue('')
  })

  it('done from the dashboard: back to devices, or another phone', async () => {
    window.sessionStorage.setItem(STORE_KEY, 'K7QX2M9P')
    mockApi()
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    await screen.findByRole('heading', { name: TEXT.doneTitle })
    expect(screen.getByRole('link', { name: 'Back to devices' })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(screen.queryByRole('link', { name: 'Back to dashboard' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect another device' })).toBeInTheDocument()
  })
})

describe('a title and a short text per state', () => {
  it.each([
    [
      'cancelled',
      () => HttpResponse.json({ data: lookupData({ status: 'denied' }) }),
      'Request cancelled',
      'Nothing was changed.',
    ],
    [
      'already approved',
      () => HttpResponse.json({ data: lookupData({ status: 'approved' }) }),
      'Already approved',
      'This device is being connected. You can close this page.',
    ],
    [
      'network error',
      () => HttpResponse.error(),
      'Could not reach textbee',
      'Check your internet connection and try again.',
    ],
    [
      'server error with a text',
      () => HttpResponse.json({ error: 'The service is busy.' }, { status: 500 }),
      'Could not reach textbee',
      'The service is busy.',
    ],
  ])('%s', async (_name, lookup, title, text) => {
    mockApi({ lookup })
    renderPanel('K7QX-2M9P')
    const heading = await screen.findByRole('heading', { level: 1, name: title })
    expect(heading).toHaveFocus()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: TEXT.title })).not.toBeInTheDocument()
  })

  it('expired: "Code expired" and how to get a new code', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({ data: lookupData({ secondsLeft: 1 }) }),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Code expired' }, { timeout: 3000 })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Codes work for 10 minutes. Tap Sign in with textbee in the app to get a new one.'
      )
    ).toBeInTheDocument()
  })

  it('done: "Device approved" and what happens next', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Device approved' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'The device connects in a few seconds. If it does not, open the textbee app on the phone.'
      )
    ).toBeInTheDocument()
  })

  it('shows the server 404 text on the field as sent', async () => {
    const text = 'This code is not valid or has expired. Check the code in the app.'
    mockApi({ lookup: () => HttpResponse.json({ error: text }, { status: 404 }) })
    renderPanel()
    await userEvent.type(
      await screen.findByLabelText('Enter the code shown in the app'),
      'k7qx2m9p{Enter}'
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
  })
})

describe('requests that never answer', () => {
  const FIELD = 'Enter the code shown in the app'
  const timedOut = () =>
    new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED')

  afterEach(() => vi.restoreAllMocks())

  it('gives every lookup, approval and cancel 15 seconds', async () => {
    const get = vi.spyOn(httpBrowserClient, 'get')
    const post = vi.spyOn(httpBrowserClient, 'post')
    mockApi({ approve: () => HttpResponse.json({}, { status: 404 }), deny: () => HttpResponse.json({}, { status: 404 }) })
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    // The check after the 404 still says pending: not known how it ended
    await screen.findByRole('heading', { name: TEXT.unreachableTitle })
    // The first lookup, the approval and the check after its 404
    expect(get).toHaveBeenCalledTimes(2)
    for (const call of get.mock.calls) expect(call[1]).toMatchObject({ timeout: 15_000 })
    expect(post.mock.calls[0][2]).toMatchObject({ timeout: 15_000 })
  })

  it('gives a cancel 15 seconds', async () => {
    const post = vi.spyOn(httpBrowserClient, 'post')
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await screen.findByRole('heading', { name: TEXT.cancelledTitle })
    expect(post.mock.calls[0][2]).toMatchObject({ timeout: 15_000 })
  })

  it('a lookup held before it is sent, as by the session lookup: "Could not reach textbee" after 15 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      mockApi()
      vi.spyOn(httpBrowserClient, 'get').mockReturnValueOnce(new Promise(() => {}))
      renderPanel('K7QX-2M9P')
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      expect(await screen.findByRole('heading', { name: TEXT.unreachableTitle })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a lookup from the field that times out: "Could not reach textbee", nothing left busy', async () => {
    mockApi()
    const get = vi.spyOn(httpBrowserClient, 'get')
    get.mockRejectedValueOnce(timedOut())
    renderPanel()
    await userEvent.type(await screen.findByLabelText(FIELD), 'k7qx2m9p{Enter}')
    expect(await screen.findByRole('heading', { name: TEXT.unreachableTitle })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: 'Connect this device?' })
  })

  it('an approval that times out: the inline retry, both buttons on again', async () => {
    const calls = mockApi()
    const post = vi.spyOn(httpBrowserClient, 'post')
    post.mockRejectedValueOnce(timedOut())
    renderPanel('K7QX-2M9P')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect device' }))
    expect(await screen.findByText(TEXT.failed)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect device' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('heading', { name: TEXT.doneTitle })
    expect(calls.approvals).toHaveLength(1)
  })
})
