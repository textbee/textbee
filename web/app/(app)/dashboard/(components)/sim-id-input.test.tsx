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
  simInfo,
  onValue,
}: {
  simInfo?: { lastUpdated?: string; sims?: unknown[] }
  onValue?: (v: number | undefined) => void
}) {
  const [value, setValue] = useState<number | undefined>()
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

describe('SimIdInput', () => {
  it('is a text field for the ID, not a list to pick from', () => {
    render(<Harness simInfo={dualSim} />)

    expect(screen.getByLabelText(/SIM subscription ID/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('fills the field from a reported SIM and shows how old the report is', () => {
    const onValue = vi.fn()
    render(<Harness simInfo={dualSim} onValue={onValue} />)

    expect(screen.getByText(/Last reported by this phone 3 hours ago/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /SIM 2 · Smart\s*19/ }))

    expect(onValue).toHaveBeenLastCalledWith(19)
    expect((screen.getByLabelText(/SIM subscription ID/) as HTMLInputElement).value).toBe('19')
    expect(
      screen.getByRole('button', { name: /SIM 2 · Smart\s*19/ }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('always warns that the IDs may have changed', () => {
    render(<Harness simInfo={dualSim} />)

    expect(screen.getByText(/SIM IDs can change/)).toBeTruthy()
    expect(screen.getByText(/SIM Cards section of\s+the textbee app/)).toBeTruthy()
  })

  it('flags an ID that is not in the last report', () => {
    render(<Harness simInfo={dualSim} />)

    fireEvent.change(screen.getByLabelText(/SIM subscription ID/), {
      target: { value: '18' },
    })

    expect(screen.getByText(/No SIM with ID 18 in the phone's last report/)).toBeTruthy()
  })

  it('reports text that is not a whole number as NaN', () => {
    const onValue = vi.fn()
    render(<Harness simInfo={dualSim} onValue={onValue} />)

    fireEvent.change(screen.getByLabelText(/SIM subscription ID/), {
      target: { value: 'sim2' },
    })

    expect(onValue).toHaveBeenLastCalledWith(NaN)
    // Shown while typing, not only after a submit attempt
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/)
    expect(
      screen.getByLabelText(/SIM subscription ID/).getAttribute('aria-describedby')
    ).toContain('sim-error')
  })

  it('stays out of the way on a phone with one reported SIM until asked', () => {
    render(
      <Harness
        simInfo={{ sims: [{ subscriptionId: 3, simSlotIndex: 0, carrierName: 'Smart' }] }}
      />
    )

    expect(screen.queryByLabelText(/SIM subscription ID/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send from a specific SIM' }))
    expect(screen.getByLabelText(/SIM subscription ID/)).toBeTruthy()
  })
})
