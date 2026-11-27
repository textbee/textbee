import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import {
  act,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/test/render'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import type { DeviceLinkLookup } from '@/lib/api/types'
import LinkDevicePanel, { TEXT } from './link-device-panel'

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
          text: 'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.',
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
  lookup?: () => Response
  approve?: () => Response
  deny?: () => Response
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
      returnTo={
        addressCode
          ? `/link-device?code=${encodeURIComponent(addressCode)}`
          : '/link-device'
      }
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
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

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
      name: 'Connect this phone?',
    })
    expect(calls.lookups).toEqual(['K7QX2M9P'])

    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
        name: 'Connect this phone?',
      })
    ).toBeInTheDocument()
    // The account row shows the email of the account the server names
    expect(screen.getByTitle('jane@example.com')).toBeInTheDocument()
    expect(screen.getByText('Google Pixel 8')).toBeInTheDocument()
    expect(screen.getByText('(name sent by the phone)')).toBeInTheDocument()
    expect(screen.getByText('Canada (approximate)')).toBeInTheDocument()
    expect(screen.getByText('K7QX-2M9P')).toBeInTheDocument()

    const reconnect = screen.getByRole('radio', { name: /Reconnect Pixel 8/ })
    expect(reconnect).toBeChecked()
    expect(screen.getByText('Google Pixel 8. Last active 2 hours ago.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Add as a new device' })).not.toBeChecked()
    // The replace group starts closed while something is suggested
    expect(
      screen.getByText('Use this phone in place of another device').closest('details')
    ).not.toHaveAttribute('open')
    expect(screen.getByText(TEXT.safety)).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent(/^\d:\d\d$/)
  })

  it('approves a reconnect without a typed code', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect phone' })
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))

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
                  text: 'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.',
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
      screen.getByText('Use this phone in place of another device').closest('details')
    ).toHaveAttribute('open')
    const shop = screen.getByRole('radio', { name: /Reconnect Shop phone/ })
    expect(shop).toHaveAccessibleDescription(
      'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.'
    )
    const connect = screen.getByRole('button', { name: 'Connect phone' })
    expect(connect).toBeDisabled()
    await userEvent.click(shop)
    expect(connect).toBeEnabled()
  })

  it('shows the server message and selects nothing on another network', async () => {
    const message =
      'This phone and this browser are on different networks, so no device is selected. Choose a device only if this phone used it before.'
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
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeDisabled()
    await userEvent.click(only)
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeEnabled()
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

    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
    expect(
      screen.getByText('Check the code. It has 8 letters and numbers.')
    ).toBeInTheDocument()
    expect(calls.approvals).toEqual([])

    await userEvent.type(screen.getByLabelText('Code from the app'), 'k7qx-2m9p')
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
      await screen.findByRole('button', { name: 'Connect phone' })
    )
    expect(await screen.findByText(m2)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeEnabled()
  })

  it('cancels the request', async () => {
    const calls = mockApi()
    renderPanel('K7QX-2M9P')

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(
      await screen.findByRole('heading', { name: TEXT.cancelled })
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
      await screen.findByRole('heading', { name: TEXT.already })
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
      screen.queryByRole('button', { name: 'Connect phone' })
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

  it('turns the buttons off when the code expires', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json({
          data: lookupData({
            expiresAt: new Date(Date.now() + 1200).toISOString(),
          }),
        }),
    })
    renderPanel('K7QX-2M9P')

    await screen.findByRole('button', { name: 'Connect phone' })
    expect(
      await screen.findByText(TEXT.expired, {}, { timeout: 3000 })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeDisabled()
    // Only Connect turns off; the server answers a late Cancel itself
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})

describe('link page answers that stop the flow', () => {
  it.each([
    [404, { error: 'This code is not valid or has expired. Start again in the app.' }],
    [
      503,
      {
        error: 'Sign-in is not available right now. Use an API key instead.',
        code: 'DEVICE_LINKS_OFF',
      },
    ],
    [429, { error: 'Too many wrong codes. Try again later.' }],
  ])('shows the server text of a %s', async (status, body) => {
    mockApi({ lookup: () => HttpResponse.json(body, { status }) })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { name: body.error })
    ).toBeInTheDocument()
  })

  it('shows the page text when a server without the route answers 404', async () => {
    mockApi({
      lookup: () =>
        HttpResponse.json(
          { message: 'Cannot GET', error: 'Not Found', statusCode: 404 },
          { status: 404 }
        ),
    })
    renderPanel('K7QX-2M9P')
    expect(
      await screen.findByRole('heading', { name: TEXT.notFound })
    ).toBeInTheDocument()
  })

  it('shows the text of an account that cannot connect', async () => {
    const text = 'This account cannot connect a phone. Contact support.'
    mockApi({
      approve: () => HttpResponse.json({ error: text }, { status: 403 }),
    })
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect phone' })
    )
    expect(await screen.findByRole('heading', { name: text })).toBeInTheDocument()
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

    await screen.findByRole('button', { name: 'Connect phone' })
    expect(window.sessionStorage.getItem(STORE_KEY)).toBeNull()
    expect(calls.lookups).toEqual(['K7QX2M9P'])
    // Typed already: the page does not ask again and shows the code
    expect(screen.queryByText(TEXT.typeCode)).not.toBeInTheDocument()
    expect(screen.getByText('K7QX-2M9P')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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

  it('logs out and loads this page on the current site, code kept', async () => {
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

  it.each([
    ['another site', 'https://evil.example.net/link-device?code=K7QX-2M9P'],
    ['a protocol-relative address', '//evil.example.net/link-device'],
    ['another page of this site', '/dashboard'],
  ])('never returns to %s', async (_name, returnTo) => {
    signOutMock.mockResolvedValue({ url: OTHER_SITE })
    mockApi()
    renderWithProviders(
      <LinkDevicePanel
        addressCode='K7QX-2M9P'
        sessionEmail='session@example.com'
        returnTo={returnTo}
      />
    )
    await switchAndConfirm()
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/link-device'))
  })

  it('still loads this page when signing out fails', async () => {
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
    await userEvent.click(screen.getByText('Use this phone in place of another device'))
    const shop = screen.getByRole('radio', { name: /^Reconnect Shop phone/ })
    expect(shop).not.toHaveAccessibleName(/Another phone/)
    expect(shop).toHaveAccessibleDescription(
      'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.'
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
      await screen.findByRole('button', { name: 'Connect phone' })
    )
    const field = await screen.findByLabelText('Code from the app')
    expect(screen.getByText(mismatch)).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription(mismatch)
    expect(screen.queryByText('K7QX-2M9P')).not.toBeInTheDocument()

    answer = () => HttpResponse.json({ data: { status: 'approved' } })
    await userEvent.type(field, 'K7QX2M9P')
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
    const connect = await screen.findByRole('button', { name: 'Connect phone' })
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
    await screen.findByRole('button', { name: 'Connect phone' })

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
      await screen.findByRole('button', { name: 'Connect phone' })
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
        returnTo='/link-device?code=K7QX-2M9P'
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
      await screen.findByText(TEXT.expired, {}, { timeout: 3000 })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Connect phone' })).toBeEnabled()
    expect(screen.queryByText(TEXT.expired)).not.toBeInTheDocument()
  })
})

describe('make the new phone the default device', () => {
  const BOX = /^Make it the default device/
  const WITH_DEFAULT =
    'Sends without a device ID go to the default device. Now: Office phone.'
  const WITHOUT_DEFAULT =
    'Sends without a device ID go to the phone that was active last. Tick this to always use this phone.'

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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Connect phone' }))
    await screen.findByText(TEXT.done)
    expect(calls.approvals).toEqual([{ action: 'new', name: 'Google Pixel 8' }])
  })
})

describe('account row and switching account', () => {
  function renderWith(name: string, email = 'session@example.com') {
    return renderWithProviders(
      <LinkDevicePanel
        sessionEmail={email}
        sessionName={name}
        returnTo='/link-device'
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
      name: 'Connect this phone?',
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
      name: 'Connect this phone?',
    })
    expect(title).not.toHaveTextContent('jane@example.com')
  })

  it('shows the place, the code and the time left on one line', async () => {
    mockApi()
    renderPanel('K7QX-2M9P')
    const timer = await screen.findByRole('timer')
    const line = timer.closest('p') as HTMLElement
    expect(line).toHaveTextContent(/^Canada \(approximate\)·Code K7QX-2M9P·\d:\d\d left$/)
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
      'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.'
    mockApi()
    renderPanel('K7QX-2M9P')
    await userEvent.click(
      await screen.findByText('Use this phone in place of another device')
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
