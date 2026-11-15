import { describe, expect, it } from 'vitest'
import {
  SIM_NUMBER_ERROR,
  hasSimReport,
  normalizeSimNumber,
  savedSimNumbers,
  simNumberForSlot,
  simSlots,
} from './sim-slots'

describe('normalizeSimNumber', () => {
  it('strips spaces, dashes, dots and brackets', () => {
    expect(normalizeSimNumber('+1 (555) 555-0123')).toBe('+15555550123')
    expect(normalizeSimNumber(' 555.555.0123 ')).toBe('5555550123')
    expect(normalizeSimNumber('[555] 0123')).toBe('5550123')
  })

  it('allows an empty value, which removes the label', () => {
    expect(normalizeSimNumber('')).toBe('')
    expect(normalizeSimNumber('  - ')).toBe('')
  })

  it('accepts 3 to 15 digits with an optional leading +', () => {
    expect(normalizeSimNumber('123')).toBe('123')
    expect(normalizeSimNumber('+123456789012345')).toBe('+123456789012345')
  })

  it('rejects anything else', () => {
    for (const text of ['12', '+1234567890123456', '++15555550123', '1555+5550123', 'abc', '+1 555 CALL']) {
      expect(normalizeSimNumber(text)).toBeNull()
    }
  })

  it('has the API error text', () => {
    expect(SIM_NUMBER_ERROR).toBe(
      'Enter the phone number with digits only, for example +15555550123.'
    )
  })
})

describe('simSlots', () => {
  it('always lists SIM 1 and SIM 2, even without a report', () => {
    expect(simSlots(undefined)).toEqual([
      { slotIndex: 0, present: false, carrier: undefined, subscriptionId: undefined, phoneNumber: undefined },
      { slotIndex: 1, present: false, carrier: undefined, subscriptionId: undefined, phoneNumber: undefined },
    ])
  })

  it('joins the report and the saved numbers by slot', () => {
    const slots = simSlots(
      {
        sims: [
          { subscriptionId: 17, simSlotIndex: 0, carrierName: ' Example Mobile ' },
          { subscriptionId: 19, simSlotIndex: 1, displayName: 'Work' },
        ],
      },
      [{ slotIndex: 1, phoneNumber: '+15555550177' }]
    )
    expect(slots).toEqual([
      { slotIndex: 0, present: true, carrier: 'Example Mobile', subscriptionId: 17, phoneNumber: undefined },
      { slotIndex: 1, present: true, carrier: 'Work', subscriptionId: 19, phoneNumber: '+15555550177' },
    ])
  })

  it('adds a higher slot when reported, numbered or included', () => {
    expect(simSlots({ sims: [{ simSlotIndex: 2 }] }).map((s) => s.slotIndex)).toEqual([0, 1, 2])
    expect(
      simSlots(null, [{ slotIndex: 3, phoneNumber: '+15555550123' }]).map((s) => s.slotIndex)
    ).toEqual([0, 1, 3])
    expect(simSlots(null, null, 4).map((s) => s.slotIndex)).toEqual([0, 1, 4])
    expect(simSlots(null, null, 9).map((s) => s.slotIndex)).toEqual([0, 1])
  })
})

describe('hasSimReport', () => {
  it('is true only when the phone reported a SIM', () => {
    expect(hasSimReport({ sims: [{ simSlotIndex: 0 }] })).toBe(true)
    expect(hasSimReport({ sims: [] })).toBe(false)
    expect(hasSimReport(null)).toBe(false)
    expect(hasSimReport(undefined)).toBe(false)
  })
})

describe('savedSimNumbers and simNumberForSlot', () => {
  const numbers = [
    { slotIndex: 1, phoneNumber: '+15555550177' },
    { slotIndex: 0, phoneNumber: ' +15555550123 ' },
    { slotIndex: 2, phoneNumber: '' },
  ]

  it('keeps slots with a number, in slot order', () => {
    expect(savedSimNumbers(numbers)).toEqual([
      { slotIndex: 0, phoneNumber: '+15555550123' },
      { slotIndex: 1, phoneNumber: '+15555550177' },
    ])
    expect(savedSimNumbers(undefined)).toEqual([])
  })

  it('finds the number for a slot', () => {
    expect(simNumberForSlot(numbers, 1)).toBe('+15555550177')
    expect(simNumberForSlot(numbers, 2)).toBeUndefined()
    expect(simNumberForSlot(numbers, undefined)).toBeUndefined()
  })
})
