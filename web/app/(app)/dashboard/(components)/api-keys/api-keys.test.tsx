import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forwardRef } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApiKeys from './api-keys'
import type { ApiKey } from '@/lib/api/types'

const HOUR_MS = 60 * 60 * 1000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR_MS).toISOString()

let apiKeys: ApiKey[] = []
const { refetch, revokeApiKey } = vi.hoisted(() => ({
  refetch: vi.fn(),
  revokeApiKey: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  useApiKeys: () => ({ isPending: false, error: null, data: apiKeys, refetch }),
  useRevokeApiKey: () => ({ mutate: revokeApiKey, isPending: false }),
  useDeleteApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameApiKey: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('./generate-api-key', () => {
  const GenerateApiKey = forwardRef(() => null)
  GenerateApiKey.displayName = 'GenerateApiKey'
  return { default: GenerateApiKey }
})

const key = (over: Partial<ApiKey>): ApiKey => ({
  _id: 'key_1',
  apiKey: 'tb_live_abcd1234******',
  name: 'Phone key',
  createdAt: ago(24 * 30),
  ...over,
})

const TWO_DEVICES =
  '2 devices used this key in the last 7 days. They stop working with textbee until you enter a new key in the textbee app on each one.'

const openRevokeDialog = async () => {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'API key actions' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Revoke' }))
  const dialog = await screen.findByRole('dialog', { name: 'Revoke API key?' })
  return { user, dialog }
}

beforeEach(() => {
  refetch.mockReset()
  revokeApiKey.mockReset()
})

describe('ApiKeys revoke dialog', () => {
  it('names the devices that use the key', async () => {
    apiKeys = [
      key({
        devices: [
          { _id: 'device_1', brand: 'Google', model: 'Pixel 8', name: 'Office phone', lastHeartbeat: ago(2) },
          { _id: 'device_2', brand: 'Samsung', model: 'Galaxy S23', lastHeartbeat: ago(5) },
        ],
      }),
    ]
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    const warning = within(dialog).getByText(TWO_DEVICES)
    expect(warning).toBeInTheDocument()
    const list = within(dialog).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Office phone (Google Pixel 8)').closest('li')).toHaveTextContent(
      'last seen 2h ago'
    )
    expect(within(list).getByText('Samsung Galaxy S23').closest('li')).toHaveTextContent(
      'last seen 5h ago'
    )
    // Plain text: nothing in the list takes focus
    expect(list.querySelector('[tabindex], time, button, a')).toBeNull()
    expect(dialog.getAttribute('aria-describedby')?.split(' ')).toContain(warning.id)
  })

  it('focuses Cancel first, as before', async () => {
    apiKeys = [key({ devices: [{ _id: 'device_1', model: 'Pixel 8', lastHeartbeat: ago(1) }] })]
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('reads the devices from the list refetched when Revoke is clicked', async () => {
    apiKeys = [key({ devices: [] })]
    refetch.mockImplementation(() => {
      apiKeys = [
        key({
          devices: [
            { _id: 'device_1', model: 'Pixel 8', lastHeartbeat: ago(1) },
            { _id: 'device_2', model: 'Pixel 7', lastHeartbeat: ago(1) },
          ],
        }),
      ]
      return Promise.resolve()
    })
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText(TWO_DEVICES)).toBeInTheDocument()
  })

  it('names a device with no name, brand or model as an unnamed device', async () => {
    apiKeys = [key({ devices: [{ _id: 'device_1', lastHeartbeat: ago(1) }] })]
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    expect(
      within(dialog).getByText(
        '1 device used this key in the last 7 days. It stops working with textbee until you enter a new key in the textbee app on it.'
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Unnamed device')).toBeInTheDocument()
  })

  it('revokes the key from the button while the warning shows', async () => {
    apiKeys = [
      key({
        _id: 'key_9',
        devices: [
          { _id: 'device_1', model: 'Pixel 8', lastHeartbeat: ago(1) },
          { _id: 'device_2', model: 'Pixel 7', lastHeartbeat: ago(1) },
        ],
      }),
    ]
    render(<ApiKeys />)

    const { user, dialog } = await openRevokeDialog()
    expect(within(dialog).getByText(TWO_DEVICES)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Revoke key' }))
    expect(revokeApiKey).toHaveBeenCalledWith('key_9', expect.any(Object))
  })

  it('stays as before when no device uses the key', async () => {
    apiKeys = [key({ devices: [] })]
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    expect(within(dialog).queryByText(/used this key/)).not.toBeInTheDocument()
    expect(within(dialog).getByText(/Revoking immediately stops this key/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Revoke key' })).toBeEnabled()
  })

  it('stays as before for a key from an older API with no devices field', async () => {
    apiKeys = [key({})]
    render(<ApiKeys />)

    const { dialog } = await openRevokeDialog()
    expect(within(dialog).queryByText(/used this key/)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Revoke key' })).toBeEnabled()
  })
})
