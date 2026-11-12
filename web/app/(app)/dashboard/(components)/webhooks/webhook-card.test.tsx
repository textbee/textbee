import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/render'
import { WebhookCard } from './webhook-card'
import { ALL_DEVICES, deviceIdFromForm } from './webhook-device-field'

const useDevices = vi.fn()

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  useDevices: () => useDevices(),
  useUpdateWebhook: () => ({ mutate: vi.fn(), isPending: false }),
}))

const webhook = {
  _id: 'w1',
  deliveryUrl: 'https://example.com/hook',
  events: ['MESSAGE_RECEIVED'],
  isActive: true,
  signingSecret: 'a'.repeat(24),
}

beforeEach(() => {
  vi.clearAllMocks()
  useDevices.mockReturnValue({
    data: [{ _id: 'd1', brand: 'Google', model: 'Pixel 8' }],
  })
})

describe('WebhookCard device', () => {
  it('names the device the webhook is limited to', () => {
    renderWithProviders(
      <WebhookCard
        webhook={{ ...webhook, deviceId: 'd1' }}
        onEdit={() => {}}
        defaultOpen
      />,
    )
    expect(screen.getByText('Google Pixel 8')).toBeInTheDocument()
  })

  it('says so when the device no longer exists', () => {
    renderWithProviders(
      <WebhookCard
        webhook={{ ...webhook, deviceId: 'gone' }}
        onEdit={() => {}}
        defaultOpen
      />,
    )
    expect(screen.getByText('Unknown device')).toBeInTheDocument()
  })

  it('shows all devices when the webhook has no device', () => {
    renderWithProviders(
      <WebhookCard webhook={webhook} onEdit={() => {}} defaultOpen />,
    )
    expect(screen.getByText('All devices')).toBeInTheDocument()
  })
})

describe('deviceIdFromForm', () => {
  it('maps the "all devices" choice to no device', () => {
    expect(deviceIdFromForm(ALL_DEVICES)).toBeUndefined()
    expect(deviceIdFromForm('')).toBeUndefined()
    expect(deviceIdFromForm(undefined)).toBeUndefined()
  })

  it('passes a device id through', () => {
    expect(deviceIdFromForm('d1')).toBe('d1')
  })
})
