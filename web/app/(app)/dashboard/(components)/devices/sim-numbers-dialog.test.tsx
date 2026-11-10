import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { TestProviders } from '@/test/render'
import { API_BASE_URL } from '@/test/fixtures'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import type { Device } from '@/lib/api'
import { SimNumbersDialog } from './sim-numbers-dialog'

const device = (over: Partial<Device> = {}): Device => ({
  _id: 'device_1',
  brand: 'Google',
  model: 'Pixel 8',
  simInfo: {
    lastUpdated: new Date().toISOString(),
    sims: [{ subscriptionId: 17, simSlotIndex: 0, carrierName: 'Example Mobile' }],
  },
  simNumbers: [{ slotIndex: 0, phoneNumber: '+15555550123' }],
  ...over,
})

const respond = (status = 200, body: Record<string, unknown> = { data: {} }) => {
  const requests: unknown[] = []
  server.use(
    http.patch(`${API_BASE_URL}${ApiEndpoints.gateway.updateDevice('device_1')}`, async ({ request }) => {
      requests.push(await request.json())
      return HttpResponse.json(body, { status })
    })
  )
  return requests
}

const open = (d: Device = device(), onOpenChange = vi.fn()) => {
  render(<SimNumbersDialog device={d} open onOpenChange={onOpenChange} />, {
    wrapper: TestProviders,
  })
  return onOpenChange
}

const sim1 = () => screen.getByLabelText(/^SIM 1/) as HTMLInputElement
const sim2 = () => screen.getByLabelText(/^SIM 2/) as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save' })

describe('SimNumbersDialog', () => {
  it('shows a field for SIM 1 and SIM 2 with the saved number and the carrier', () => {
    open()

    expect(screen.getByRole('dialog', { name: 'SIM numbers' })).toBeTruthy()
    expect(screen.getByText('Only a label for you. textbee does not check it.')).toBeTruthy()
    expect(sim1().value).toBe('+15555550123')
    expect(sim2().value).toBe('')
    expect(sim2().getAttribute('placeholder')).toBe('Phone number (optional)')
    expect(screen.getByText('Example Mobile')).toBeTruthy()
  })

  it('shows both fields when the phone has not reported its SIMs', () => {
    open(device({ simInfo: null, simNumbers: [] }))

    expect(sim1()).toBeTruthy()
    expect(sim2()).toBeTruthy()
  })

  it('blocks Save while a number is invalid', () => {
    open()
    fireEvent.change(sim2(), { target: { value: '+1 555 abc' } })

    expect(screen.getByRole('alert').textContent).toBe(
      'Enter the phone number with digits only, for example +15555550123.'
    )
    expect(sim2().getAttribute('aria-invalid')).toBe('true')
    expect(save().hasAttribute('disabled')).toBe(true)
  })

  it('saves cleaned numbers, an empty one removes the label, then closes', async () => {
    const requests = respond()
    const onOpenChange = open()
    fireEvent.change(sim1(), { target: { value: '' } })
    fireEvent.change(sim2(), { target: { value: '+1 (555) 555-0177' } })
    fireEvent.click(save())

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requests).toEqual([
      {
        simNumbers: [
          { slotIndex: 0, phoneNumber: '' },
          { slotIndex: 1, phoneNumber: '+15555550177' },
        ],
      },
    ])
  })

  it('shows the API error and stays open', async () => {
    respond(400, { error: 'Enter the phone number with digits only, for example +15555550123.' })
    const onOpenChange = open()
    fireEvent.click(save())

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Enter the phone number with digits only, for example +15555550123.'
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes on Cancel without saving', () => {
    const requests = respond()
    const onOpenChange = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(requests).toEqual([])
  })
})
