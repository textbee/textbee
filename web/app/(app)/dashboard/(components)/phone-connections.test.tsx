import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/test/render'
import ApiKeys from './api-keys/api-keys'
import DeviceList from './devices/device-list'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000).toISOString()

const HAND_MADE = {
  _id: 'key_own',
  apiKey: 'tb_live_abcd1234******',
  name: 'Production',
  status: 'active',
  createdAt: minutesAgo(60 * 24 * 40),
}

const PHONE_KEY = {
  _id: 'key_phone',
  apiKey: 'tb_live_phon1234******',
  name: 'Phone sign-in: Pixel 8',
  status: 'active',
  source: 'device-link',
  createdAt: minutesAgo(60 * 24 * 2),
  linkedDevice: {
    _id: 'device_phone',
    name: 'Pixel 8',
    brand: 'Google',
    model: 'Pixel 8',
    lastHeartbeat: minutesAgo(5),
    enabled: true,
  },
}

const QUIET_PHONE_KEY = {
  ...PHONE_KEY,
  _id: 'key_quiet',
  linkedDevice: {
    _id: 'device_quiet',
    name: 'Shop phone',
    brand: 'samsung',
    model: 'SM-A346E',
    lastHeartbeat: minutesAgo(60 * 5),
    enabled: true,
  },
}

const ORPHAN_KEY = {
  ...PHONE_KEY,
  _id: 'key_orphan',
  linkedDevice: null,
}

type Calls = { revoked: string[]; deleted: string[] }

function mockKeys(active: unknown[], revoked: unknown[] = []): Calls {
  const calls: Calls = { revoked: [], deleted: [] }
  server.use(
    http.get(`${API_BASE_URL}/auth/api-keys`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      return HttpResponse.json({ data: status === 'revoked' ? revoked : active })
    }),
    http.post(`${API_BASE_URL}/auth/api-keys/:id/revoke`, ({ params }) => {
      calls.revoked.push(String(params.id))
      return HttpResponse.json({ data: {} })
    }),
    http.delete(`${API_BASE_URL}/auth/api-keys/:id`, ({ params }) => {
      calls.deleted.push(String(params.id))
      return HttpResponse.json({ data: {} })
    })
  )
  return calls
}

function rowOf(text: string) {
  return screen.getByText(text).closest('div.flex.items-start') as HTMLElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('API keys list of an account with a phone sign-in key', () => {
  it('splits the keys into your keys and phone connections', async () => {
    mockKeys([HAND_MADE, PHONE_KEY, QUIET_PHONE_KEY])
    renderWithProviders(<ApiKeys />)

    const own = await screen.findByRole('group', { name: 'Your API keys' })
    expect(
      within(own).getByText('For your own code, scripts and integrations.')
    ).toBeInTheDocument()
    expect(within(own).getByText('Production')).toBeInTheDocument()
    expect(within(own).queryByText('Pixel 8')).not.toBeInTheDocument()

    const phones = screen.getByRole('group', { name: 'Phone connections' })
    expect(
      within(phones).getByText(
        'Made by the textbee app when a phone signs in. Each one works only on its own phone.'
      )
    ).toBeInTheDocument()
    // The device name, not the key's own name
    expect(within(phones).getByText('Pixel 8')).toBeInTheDocument()
    expect(within(phones).queryByText('Phone sign-in: Pixel 8')).not.toBeInTheDocument()
    expect(within(phones).getAllByText('Phone')).toHaveLength(2)

    expect(rowOf('Pixel 8')).toHaveTextContent(
      'Google Pixel 8. Online·Connected 2 days ago'
    )
    expect(rowOf('Shop phone')).toHaveTextContent(
      'samsung SM-A346E. Last active 5 hours ago·Connected 2 days ago'
    )
    // The count in the title is of the user's own keys
    expect(screen.getByText('API Keys').textContent).toBe('API Keys1')
  })

  it('offers View device and Disconnect phone, not Rename', async () => {
    mockKeys([HAND_MADE, PHONE_KEY])
    renderWithProviders(<ApiKeys />)
    await screen.findByText('Pixel 8')

    await userEvent.click(
      within(rowOf('Pixel 8')).getByRole('button', { name: 'API key actions' })
    )
    expect(
      await screen.findByRole('menuitem', { name: 'View device' })
    ).toHaveAttribute('href', '/dashboard#device-device_phone')
    expect(
      screen.getByRole('menuitem', { name: 'Disconnect phone' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Rename' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Revoke' })
    ).not.toBeInTheDocument()
  })

  it('disconnects a phone by revoking its key after the confirm dialog', async () => {
    const calls = mockKeys([HAND_MADE, PHONE_KEY])
    renderWithProviders(<ApiKeys />)
    await screen.findByText('Pixel 8')

    await userEvent.click(
      within(rowOf('Pixel 8')).getByRole('button', { name: 'API key actions' })
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Disconnect phone' })
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Disconnect Pixel 8?',
    })
    expect(dialog).toHaveTextContent(
      'The textbee app on this phone stops sending and receiving SMS. To use the phone again, open the app and tap "Reconnect this phone". Your own API keys are not changed.'
    )
    expect(calls.revoked).toEqual([])

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Disconnect phone' })
    )
    await waitFor(() => expect(calls.revoked).toEqual(['key_phone']))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })

  it('shows a key of a deleted device as removed, with only Remove', async () => {
    const calls = mockKeys([HAND_MADE, ORPHAN_KEY])
    renderWithProviders(<ApiKeys />)

    expect(await screen.findByText('Device removed')).toBeInTheDocument()
    await userEvent.click(
      within(rowOf('Device removed')).getByRole('button', {
        name: 'API key actions',
      })
    )
    const remove = await screen.findByRole('menuitem', { name: 'Remove' })
    expect(
      screen.queryByRole('menuitem', { name: 'View device' })
    ).not.toBeInTheDocument()
    await userEvent.click(remove)
    // A confirm first; nothing is sent yet
    const dialog = await screen.findByRole('dialog', { name: 'Remove this key?' })
    expect(calls.revoked).toEqual([])
    const confirm = within(dialog).getByRole('button', { name: 'Remove' })
    await userEvent.click(confirm)
    await userEvent.click(confirm)
    await waitFor(() => expect(calls.deleted).toEqual(['key_orphan']))
    expect(calls.revoked).toEqual(['key_orphan'])
  })

  it('does not call a key without device details removed', async () => {
    const withoutDevice: Record<string, unknown> = { ...PHONE_KEY, _id: 'key_unknown' }
    delete withoutDevice.linkedDevice
    mockKeys([HAND_MADE, withoutDevice])
    renderWithProviders(<ApiKeys />)

    expect(await screen.findByText('Phone sign-in: Pixel 8')).toBeInTheDocument()
    expect(screen.queryByText('Device removed')).not.toBeInTheDocument()
    await userEvent.click(
      within(rowOf('Phone sign-in: Pixel 8')).getByRole('button', {
        name: 'API key actions',
      })
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Disconnect phone' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'View device' })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument()
  })

  it('labels revoked phone keys in the revoked keys view', async () => {
    mockKeys(
      [HAND_MADE, PHONE_KEY],
      [
        {
          ...PHONE_KEY,
          _id: 'key_phone_old',
          name: 'Phone sign-in: Old phone',
          status: 'revoked',
          revokedAt: minutesAgo(60),
        },
        { ...HAND_MADE, _id: 'key_old', name: 'Old key', revokedAt: minutesAgo(60) },
      ]
    )
    renderWithProviders(<ApiKeys />)
    await screen.findByText('Pixel 8')

    await userEvent.click(
      screen.getAllByRole('button', { name: /revoked keys/i })[0]
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Revoked API keys',
    })
    const phoneRow = (await within(dialog).findByText('Phone sign-in: Old phone'))
      .parentElement as HTMLElement
    expect(within(phoneRow).getByText('Phone')).toBeInTheDocument()
    const ownRow = within(dialog).getByText('Old key').parentElement as HTMLElement
    expect(within(ownRow).queryByText('Phone')).not.toBeInTheDocument()
  })
})

describe('devices list for a phone connected by sign-in', () => {
  function mockDevices(devices: unknown[]) {
    server.use(
      http.get(`${API_BASE_URL}/gateway/devices`, () =>
        HttpResponse.json({ data: devices })
      )
    )
  }

  const SIGNED_IN = {
    _id: 'device_phone',
    name: 'Pixel 8',
    brand: 'Google',
    model: 'Pixel 8',
    enabled: true,
    lastHeartbeat: minutesAgo(5),
    appVersionCode: 23,
    apiKeySource: 'device-link',
    createdAt: minutesAgo(60 * 24 * 2),
  }

  it('says the phone is connected by phone sign-in', async () => {
    mockDevices([SIGNED_IN])
    const { container } = renderWithProviders(<DeviceList />)
    expect(
      await screen.findByText('Connected by phone sign-in')
    ).toBeInTheDocument()
    // The target of "View device"
    expect(container.querySelector('#device-device_phone')).not.toBeNull()
  })

  it('tells how to reconnect a disconnected phone instead of asking for a key', async () => {
    mockDevices([{ ...SIGNED_IN, apiKeyRevoked: true }])
    renderWithProviders(<DeviceList />)

    expect(
      await screen.findByText(
        'Disconnected. Open the app on the phone and tap Reconnect this phone.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(screen.queryByText('API key revoked')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Create API key' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Connected by phone sign-in')
    ).not.toBeInTheDocument()
  })
})
