import { describe, expect, it, vi } from 'vitest'
import { useState, type FormEvent } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { TestProviders } from '@/test/render'
import { API_BASE_URL } from '@/test/fixtures'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import type { Device } from '@/lib/api'
import { SimPicker, type SimChoice } from './sim-picker'

const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

const dualSim: Device = {
  _id: 'device_1',
  simInfo: {
    lastUpdated: threeHoursAgo,
    sims: [
      { subscriptionId: 17, simSlotIndex: 0, carrierName: 'Example Mobile' },
      { subscriptionId: 19, simSlotIndex: 1, carrierName: 'Sample Tel' },
    ],
  },
  simNumbers: [{ slotIndex: 1, phoneNumber: '+15555550177' }],
}

const oneSim: Device = {
  _id: 'device_2',
  simInfo: {
    lastUpdated: threeHoursAgo,
    sims: [{ subscriptionId: 17, simSlotIndex: 0, carrierName: 'Example Mobile' }],
  },
}

function Harness({
  device = dualSim,
  initial = {},
  onValue,
}: {
  device?: Device
  initial?: SimChoice
  onValue?: (v: SimChoice) => void
}) {
  const [value, setValue] = useState<SimChoice>(initial)
  return (
    <SimPicker
      id='sim'
      device={device}
      slotIndex={value.simSlotIndex}
      subscriptionId={value.simSubscriptionId}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
    />
  )
}

const renderPicker = (props: Parameters<typeof Harness>[0] = {}) =>
  render(<Harness {...props} />, { wrapper: TestProviders })

const radio = (name: RegExp) => screen.getByRole('radio', { name })
const checked = (name: RegExp) => radio(name).getAttribute('aria-checked')
const field = () => screen.queryByLabelText('SIM subscription ID') as HTMLInputElement | null

describe('SimPicker segments', () => {
  it('is a radio group labelled SIM with Default chosen', () => {
    renderPicker()

    const group = screen.getByRole('radiogroup', { name: 'SIM' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent)
    ).toEqual(['Default', 'SIM 1 Example Mobile', 'SIM 2 Sample Tel', 'ID'])
    expect(checked(/^Default$/)).toBe('true')
    expect(field()).toBeNull()
    expect(
      screen.getByText('Uses the SIM set as default in the textbee app or on the phone.')
    ).toBeTruthy()
  })

  it('sends a zero-based simSlotIndex for SIM n and no ID', () => {
    const onValue = vi.fn()
    renderPicker({ onValue })

    fireEvent.click(radio(/^SIM 2/))
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: 1, simSubscriptionId: undefined })
    expect(checked(/^SIM 2/)).toBe('true')

    fireEvent.click(radio(/^SIM 1/))
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: 0, simSubscriptionId: undefined })

    fireEvent.click(radio(/^Default$/))
    expect(onValue).toHaveBeenLastCalledWith({
      simSlotIndex: undefined,
      simSubscriptionId: undefined,
    })
  })

  it('names the chosen SIM, its carrier and a saved number', () => {
    renderPicker()

    fireEvent.click(radio(/^SIM 2/))
    expect(screen.getByText('Sends from SIM 2 · Sample Tel · +15555550177')).toBeTruthy()

    fireEvent.click(radio(/^SIM 1/))
    expect(screen.getByText('Sends from SIM 1 · Example Mobile')).toBeTruthy()
  })

  it('keeps an empty slot selectable but warns that the send fails', () => {
    renderPicker({ device: oneSim })

    expect(radio(/^SIM 2$/).className).toContain('opacity-60')
    fireEvent.click(radio(/^SIM 2$/))

    expect(checked(/^SIM 2$/)).toBe('true')
    expect(
      screen.getByText(
        /SIM 2 was empty in the phone's last report\s*\(3 hours ago\)\. If it is still empty, the message fails\. It is never sent from another SIM\./
      )
    ).toBeTruthy()
  })

  it('shows SIM 1 and SIM 2 without a report and says the phone has not reported', () => {
    renderPicker({ device: { _id: 'device_3' } })

    expect(radio(/^SIM 1$/).className).not.toContain('opacity-60')
    fireEvent.click(radio(/^SIM 2$/))
    expect(
      screen.getByText(
        'This phone has not reported its SIMs. Update the textbee app on the phone to choose a SIM.'
      )
    ).toBeTruthy()
  })

  it('adds a segment for a reported SIM above slot 2', () => {
    const onValue = vi.fn()
    renderPicker({
      onValue,
      device: {
        _id: 'device_4',
        simInfo: { sims: [{ subscriptionId: 5, simSlotIndex: 2, carrierName: 'Example Mobile' }] },
      },
    })

    fireEvent.click(radio(/^SIM 3/))
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: 2, simSubscriptionId: undefined })
  })

  it('never shows a slot index', () => {
    renderPicker()
    fireEvent.click(radio(/^SIM 1/))

    expect(screen.queryByText(/slotIndex|SIM 0/)).toBeNull()
  })

  it('moves and selects with the arrow keys', () => {
    const onValue = vi.fn()
    renderPicker({ onValue })

    const def = radio(/^Default$/)
    def.focus()
    fireEvent.keyDown(def, { key: 'ArrowRight' })
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: 0, simSubscriptionId: undefined })
    expect(document.activeElement).toBe(radio(/^SIM 1/))
    expect(radio(/^SIM 1/).getAttribute('tabindex')).toBe('0')
    expect(def.getAttribute('tabindex')).toBe('-1')

    fireEvent.keyDown(radio(/^SIM 1/), { key: 'ArrowLeft' })
    expect(checked(/^Default$/)).toBe('true')
  })

  it('starts on the slot kept after a send', () => {
    renderPicker({ initial: { simSlotIndex: 1 } })

    expect(checked(/^SIM 2/)).toBe('true')
  })
})

describe('SimPicker ID option', () => {
  it('opens the older subscription ID editor with its note', () => {
    renderPicker()
    fireEvent.click(radio(/^ID$/))

    expect(checked(/^ID$/)).toBe('true')
    expect(screen.getByText('Older option: subscription ID')).toBeTruthy()
    expect(
      screen.getByText(
        'Subscription IDs can change after a SIM swap. A changed ID sends from the default SIM. Prefer SIM 1 or SIM 2.'
      )
    ).toBeTruthy()
    expect(document.activeElement).toBe(field())
  })

  it('sends simSubscriptionId from typed text or a reported SIM, and no slot', () => {
    const onValue = vi.fn()
    renderPicker({ onValue })
    fireEvent.click(radio(/^ID$/))

    fireEvent.change(field()!, { target: { value: '17' } })
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: undefined, simSubscriptionId: 17 })

    fireEvent.click(screen.getByRole('button', { name: /SIM 2 · Sample Tel\s*19/ }))
    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: undefined, simSubscriptionId: 19 })
    expect(field()!.value).toBe('19')
  })

  it('reports invalid text as NaN and shows the error at once', () => {
    const onValue = vi.fn()
    renderPicker({ onValue })
    fireEvent.click(radio(/^ID$/))
    fireEvent.change(field()!, { target: { value: 'sim2' } })

    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: undefined, simSubscriptionId: NaN })
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/)
    expect(field()!.getAttribute('aria-describedby')).toContain('sim-error')
  })

  it('flags an ID that is not in the last report', () => {
    renderPicker()
    fireEvent.click(radio(/^ID$/))
    fireEvent.change(field()!, { target: { value: '18' } })

    expect(screen.getByText(/No SIM with subscription ID 18 in the phone's\s+last\s+report/)).toBeTruthy()
  })

  it('clears the ID when another option is chosen', () => {
    const onValue = vi.fn()
    renderPicker({ onValue })
    fireEvent.click(radio(/^ID$/))
    fireEvent.change(field()!, { target: { value: '19' } })
    fireEvent.click(radio(/^SIM 1/))

    expect(onValue).toHaveBeenLastCalledWith({ simSlotIndex: 0, simSubscriptionId: undefined })
    expect(field()).toBeNull()
  })

  it('starts on ID when an ID is already set', () => {
    renderPicker({ initial: { simSubscriptionId: 19 } })

    expect(checked(/^ID$/)).toBe('true')
    expect(field()!.value).toBe('19')
  })
})

describe('SimPicker details', () => {
  it('lists each SIM with carrier, number and subscription ID', async () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'SIM details' }))

    const details = await screen.findByRole('dialog', { name: 'SIM details' })
    expect(within(details).getByText('Example Mobile')).toBeTruthy()
    expect(within(details).getByText('Not set')).toBeTruthy()
    expect(within(details).getByText('+15555550177')).toBeTruthy()
    expect(within(details).getAllByText('older option')).toHaveLength(2)
    expect(within(details).getByText('Reported by the phone 3 hours ago.')).toBeTruthy()
  })

  it('opens the SIM numbers dialog from the details', async () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'SIM details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit SIM numbers' }))

    expect(await screen.findByRole('dialog', { name: 'SIM numbers' })).toBeTruthy()
  })

  it('saves SIM numbers without submitting the surrounding form', async () => {
    const requests: unknown[] = []
    server.use(
      http.patch(
        `${API_BASE_URL}${ApiEndpoints.gateway.updateDevice('device_1')}`,
        async ({ request }) => {
          requests.push(await request.json())
          return HttpResponse.json({ data: {} })
        }
      )
    )
    const onSubmit = vi.fn((e: FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
      { wrapper: TestProviders }
    )

    fireEvent.click(screen.getByRole('button', { name: 'SIM details' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit SIM numbers' }))
    const dialog = await screen.findByRole('dialog', { name: 'SIM numbers' })
    fireEvent.change(within(dialog).getByLabelText(/^SIM 1/), {
      target: { value: '+15555550123' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toEqual({
      simNumbers: [
        { slotIndex: 0, phoneNumber: '+15555550123' },
        { slotIndex: 1, phoneNumber: '+15555550177' },
      ],
    })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'SIM numbers' })).toBeNull()
    )
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
