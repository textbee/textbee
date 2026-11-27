import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/render'
import ApiKeys from './api-keys/api-keys'
import DeviceList from './devices/device-list'

// An account without a phone sign-in key sees the API keys and devices lists
// exactly as before phone sign-in. The expected markup was captured from the
// version before that change, with the same data and the same clock.

const NOW = new Date('2026-11-26T12:00:00.000Z')
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60 * 1000).toISOString()

const ACTIVE_KEYS = [
  {
    _id: 'key_1',
    apiKey: 'tb_live_abcd1234******',
    name: 'Production',
    status: 'active',
    usageCount: 5,
    lastUsedAt: minutesAgo(30),
    createdAt: minutesAgo(60 * 24 * 40),
    devices: [
      {
        _id: 'device_1',
        name: 'Office phone',
        brand: 'Google',
        model: 'Pixel 8',
        lastHeartbeat: minutesAgo(5),
      },
    ],
  },
  {
    _id: 'key_2',
    apiKey: 'tb_live_efgh5678******',
    status: 'active',
    createdAt: minutesAgo(60 * 24 * 3),
  },
]

const REVOKED_KEYS = [
  {
    _id: 'key_3',
    apiKey: 'tb_live_old00000******',
    name: 'Old key',
    status: 'revoked',
    createdAt: minutesAgo(60 * 24 * 90),
    revokedAt: minutesAgo(60 * 24 * 10),
  },
]

const DEVICES = [
  {
    _id: 'device_1',
    name: 'Office phone',
    brand: 'Google',
    model: 'Pixel 8',
    enabled: true,
    isDefault: true,
    lastHeartbeat: minutesAgo(5),
    appVersionCode: 22,
    appVersionName: '2.10.0',
    createdAt: minutesAgo(60 * 24 * 40),
  },
  {
    _id: 'device_2',
    brand: 'Samsung',
    model: 'Galaxy S23',
    enabled: true,
    isDefault: false,
    lastHeartbeat: minutesAgo(180),
    appVersionCode: 17,
    apiKeyRevoked: true,
    createdAt: minutesAgo(60 * 24 * 20),
  },
  {
    _id: 'device_3',
    brand: 'Xiaomi',
    model: 'Redmi Note 12',
    enabled: false,
    isDefault: false,
    appVersionCode: 16,
    createdAt: minutesAgo(60 * 24 * 60),
  },
]

// Sorted attributes and masked generated ids: only what is shown and
// announced is compared
function normalize(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const attributes = Array.from(element.attributes)
    .map(({ name, value }) =>
      /^(id|aria-labelledby|aria-describedby|aria-controls)$/.test(name)
        ? `${name}="x"`
        : `${name}="${value}"`
    )
    .sort()
    .join(' ')
  const children = Array.from(element.childNodes)
    .map((node) =>
      node.nodeType === Node.ELEMENT_NODE
        ? normalize(node as Element)
        : (node.textContent ?? '')
    )
    .join('')
  return `<${tag}${attributes ? ` ${attributes}` : ''}>${children}</${tag}>\n`
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  server.use(
    http.get(`${API_BASE_URL}/auth/api-keys`, ({ request }) => {
      const status = new URL(request.url).searchParams.get('status')
      return HttpResponse.json({
        data: status === 'revoked' ? REVOKED_KEYS : ACTIVE_KEYS,
      })
    }),
    http.get(`${API_BASE_URL}/gateway/devices`, () =>
      HttpResponse.json({ data: DEVICES })
    )
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('lists of an account without a phone sign-in key', () => {
  it('shows the API keys list of today', async () => {
    const { container } = renderWithProviders(<ApiKeys />)
    await screen.findByText('Production')
    await expect(normalize(container)).toMatchFileSnapshot(
      './__snapshots__/api-keys-without-sign-in.html'
    )
  })

  it('shows the revoked keys view of today', async () => {
    renderWithProviders(<ApiKeys />)
    await screen.findByText('Production')
    await userEvent.click(
      screen.getAllByRole('button', { name: /revoked keys/i })[0]
    )
    const dialog = await screen.findByRole('dialog', {
      name: 'Revoked API keys',
    })
    await screen.findByText('Old key')
    await expect(normalize(dialog)).toMatchFileSnapshot(
      './__snapshots__/revoked-keys-without-sign-in.html'
    )
  })

  it('shows the devices list of today', async () => {
    const { container } = renderWithProviders(<DeviceList />)
    await screen.findByText(/Office phone/)
    await waitFor(() =>
      expect(screen.getAllByText(/Registered/).length).toBeGreaterThan(0)
    )
    await expect(normalize(container)).toMatchFileSnapshot(
      './__snapshots__/devices-without-sign-in.html'
    )
  })
})
