import { describe, expect, it, vi } from 'vitest'
import { forwardRef } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import DeviceList from './device-list'
import type { Device } from '@/lib/api'

const MINUTE_MS = 60 * 1000
const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE_MS).toISOString()

let devices: Device[] = []

vi.mock('@/lib/api', () => ({
  useDevices: () => ({ isPending: false, error: null, data: devices, refetch: vi.fn() }),
  useSubscription: () => ({ data: undefined }),
  useDeleteDevice: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDefaultDevice: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('./add-device-dialog', () => {
  const AddDeviceDialog = forwardRef(() => null)
  AddDeviceDialog.displayName = 'AddDeviceDialog'
  return { default: AddDeviceDialog }
})

const device = (over: Partial<Device>): Device =>
  ({
    _id: 'device_1',
    brand: 'Google',
    model: 'Pixel 8',
    enabled: true,
    createdAt: ago(60 * 24 * 30),
    ...over,
  }) as Device

const row = (name: RegExp) =>
  screen.getByRole('heading', { name }).closest('div.min-w-0.flex-1') as HTMLElement

describe('DeviceList presence', () => {
  it('hides last seen while the device is online', () => {
    devices = [device({ lastHeartbeat: ago(5) })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Online' })).toBeInTheDocument()
    expect(within(r).queryByText(/Last seen/)).not.toBeInTheDocument()
  })

  it('hides last seen up to the end of the online window', () => {
    devices = [device({ lastHeartbeat: ago(62) })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Online' })).toBeInTheDocument()
    expect(within(r).queryByText(/Last seen/)).not.toBeInTheDocument()
  })

  it('shows last seen for an offline device', () => {
    devices = [device({ lastHeartbeat: ago(60 * 5) })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Offline' })).toBeInTheDocument()
    expect(within(r).getByText(/Last seen/)).toHaveTextContent('Last seen 5 hours ago')
  })

  it('keeps a disabled device labelled disabled, without last seen in the row', () => {
    devices = [device({ enabled: false, lastHeartbeat: ago(1) })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Disabled' })).toBeInTheDocument()
    expect(within(r).queryByText('Online')).not.toBeInTheDocument()
    expect(within(r).queryByText(/Last seen/)).not.toBeInTheDocument()
  })

  it('says an old build needs a newer app for online status', () => {
    devices = [device({ lastHeartbeat: null, appVersionCode: 14, appVersionName: '2.5.0' })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Enabled' })).toBeInTheDocument()
    expect(within(r).queryByText('Offline')).not.toBeInTheDocument()
    expect(within(r).queryByText(/Last seen/)).not.toBeInTheDocument()
    expect(within(r).getByText('Online status needs app 2.7.0+')).toBeInTheDocument()
  })

  it('says the same when no app version is on record', () => {
    devices = [device({ lastHeartbeat: null })]
    render(<DeviceList />)

    expect(
      within(row(/Pixel 8/)).getByText('Online status needs app 2.7.0+')
    ).toBeInTheDocument()
  })

  it('shows no old-app notice for a build that sends status updates', () => {
    devices = [device({ lastHeartbeat: null, appVersionCode: 16, appVersionName: '2.7.0' })]
    render(<DeviceList />)

    expect(
      within(row(/Pixel 8/)).queryByText(/Online status needs app/)
    ).not.toBeInTheDocument()
  })

  it('shows no old-app notice for a current build that has not reported yet', () => {
    devices = [device({ lastHeartbeat: null, appVersionCode: 9999 })]
    render(<DeviceList />)

    const r = row(/Pixel 8/)
    expect(within(r).getByRole('button', { name: 'Enabled' })).toBeInTheDocument()
    expect(within(r).queryByText(/Online status needs app/)).not.toBeInTheDocument()
  })

  it('explains the status when the label is tapped', async () => {
    devices = [device({ lastHeartbeat: ago(60 * 5) })]
    render(<DeviceList />)

    fireEvent.click(within(row(/Pixel 8/)).getByRole('button', { name: 'Offline' }))
    expect(await screen.findByText(/^Not seen for 5 hours\./)).toBeInTheDocument()
  })
})

describe('DeviceList row layout', () => {
  it('shows the full device ID', () => {
    devices = [device({ _id: '6720f1c9a4be2d0013a1b2c3', lastHeartbeat: ago(5) })]
    render(<DeviceList />)

    expect(within(row(/Pixel 8/)).getByText('6720f1c9a4be2d0013a1b2c3')).toBeInTheDocument()
  })

  it('keeps the name on its own line, apart from the tags', () => {
    devices = [
      device({
        brand: 'Xiaomi',
        model: 'Redmi Note 12 Pro+ 5G',
        isDefault: true,
        lastHeartbeat: ago(5),
      }),
    ]
    render(<DeviceList />)

    const heading = screen.getByRole('heading', { name: /Redmi Note 12 Pro\+ 5G/ })
    expect(heading.className).not.toContain('truncate')
    expect(within(heading).queryByText('Default')).not.toBeInTheDocument()
    expect(within(row(/Redmi Note/)).getByText('Default')).toBeInTheDocument()
  })
})
