import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { SimIdInput } from './sim-id-input'

const dualSim = {
  lastUpdated: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  sims: [
    { subscriptionId: 17, simSlotIndex: 0, carrierName: 'Smart' },
    { subscriptionId: 19, simSlotIndex: 1, carrierName: 'Smart' },
  ],
}

function Harness({
  simInfo = dualSim,
  initial,
  onValue,
}: {
  simInfo?: { lastUpdated?: string; sims?: unknown[] }
  initial?: number
  onValue?: (v: number | undefined) => void
}) {
  const [value, setValue] = useState<number | undefined>(initial)
  return (
    <SimIdInput
      id='sim'
      value={value}
      simInfo={simInfo}
      onChange={(v) => {
        setValue(v)
        onValue?.(v)
      }}
    />
  )
}

const toggle = () => screen.getByRole('switch', { name: 'Send from a specific SIM' })
const field = () => screen.queryByLabelText('SIM subscription ID') as HTMLInputElement | null

describe('SimIdInput', () => {
  it('is off by default and shows only the toggle', () => {
    render(<Harness />)

    expect(toggle().getAttribute('aria-checked')).toBe('false')
    expect(field()).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('opens a typed field with reported SIMs as suggestions', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    fireEvent.click(toggle())
    expect(field()).toBeTruthy()
    expect(screen.getByText(/reported 3 hours ago/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /SIM 2 · Smart\s*19/ }))
    expect(onValue).toHaveBeenLastCalledWith(19)
    expect(field()!.value).toBe('19')
    expect(
      screen.getByRole('button', { name: /SIM 2 · Smart\s*19/ }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('always says the IDs can change while open', () => {
    render(<Harness />)
    fireEvent.click(toggle())

    expect(screen.getByText(/not the slot number \(SIM 1 or\s+SIM 2\)/)).toBeTruthy()
    expect(screen.getByText(/can change after a SIM swap/)).toBeTruthy()
    expect(field()!.getAttribute('placeholder')).toBe('SIM subscription ID')
    expect(screen.getByText(/SIM Cards section of the textbee app/)).toBeTruthy()
  })

  it('flags an ID that is not in the last report', () => {
    render(<Harness />)
    fireEvent.click(toggle())
    fireEvent.change(field()!, { target: { value: '18' } })

    expect(screen.getByText(/No SIM with subscription ID 18 in the phone's\s+last\s+report/)).toBeTruthy()
  })

  it('reports invalid text as NaN and shows the error at once', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.click(toggle())
    fireEvent.change(field()!, { target: { value: 'sim2' } })

    expect(onValue).toHaveBeenLastCalledWith(NaN)
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/)
    expect(field()!.getAttribute('aria-describedby')).toContain('sim-error')
  })

  it('clears the ID when switched off', () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    fireEvent.click(toggle())
    fireEvent.change(field()!, { target: { value: '19' } })
    fireEvent.click(toggle())

    expect(onValue).toHaveBeenLastCalledWith(undefined)
    expect(field()).toBeNull()
    expect(toggle().getAttribute('aria-checked')).toBe('false')
  })

  it('starts on when an ID is already set, such as after a send', () => {
    render(<Harness initial={19} />)

    expect(toggle().getAttribute('aria-checked')).toBe('true')
    expect(field()!.value).toBe('19')
  })

  it('works for a phone with one reported SIM', () => {
    render(
      <Harness simInfo={{ sims: [{ subscriptionId: 3, simSlotIndex: 0, carrierName: 'Smart' }] }} />
    )
    fireEvent.click(toggle())

    expect(screen.getByRole('button', { name: /SIM 1 · Smart\s*3/ })).toBeTruthy()
  })
})
