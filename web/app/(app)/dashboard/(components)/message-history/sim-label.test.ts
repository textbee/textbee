import { describe, expect, it } from 'vitest'
import {
  simCarrier,
  simDetails,
  simFullLabel,
  simLabel,
  simMismatch,
  simName,
  simNameWithCarrier,
  simRequested,
  simSlotMismatch,
} from './sim-label'
import type { SmsMessage } from './types'

const msg = (over: Partial<SmsMessage>): SmsMessage =>
  ({ _id: 'm1', message: 'hi', ...over }) as SmsMessage

describe('simName', () => {
  it('names the SIM by its slot', () => {
    expect(simName(msg({ simUsed: { subscriptionId: 19, slotIndex: 1 } }))).toBe(
      'SIM 2'
    )
    expect(simName(msg({ simUsed: { slotIndex: 0 } }))).toBe('SIM 1')
  })

  it('falls back to the subscription ID when the slot is missing', () => {
    expect(simName(msg({ simUsed: { subscriptionId: 19 } }))).toBe('SIM ID 19')
  })

  it('is undefined for messages from apps that do not report the SIM', () => {
    expect(simName(msg({}))).toBeUndefined()
    expect(simName(msg({ simUsed: {} }))).toBeUndefined()
    // The requested SIM alone says nothing about the SIM used
    expect(simName(msg({ simSubscriptionId: 19 }))).toBeUndefined()
  })
})

describe('simLabel', () => {
  it('words the label by direction', () => {
    const simUsed = { slotIndex: 1 }
    expect(simLabel(msg({ type: 'SENT', simUsed }))).toBe('Sent from SIM 2')
    expect(simLabel(msg({ type: 'RECEIVED', simUsed }))).toBe(
      'Received on SIM 2'
    )
  })

  it('is undefined when no SIM was reported', () => {
    expect(simLabel(msg({ type: 'SENT' }))).toBeUndefined()
  })
})

describe('simMismatch', () => {
  it('is true when the phone used a different SIM than requested', () => {
    expect(
      simMismatch(msg({ simSubscriptionId: 18, simUsed: { subscriptionId: 17 } }))
    ).toBe(true)
  })

  it('is false when they match or either side is unknown', () => {
    expect(
      simMismatch(msg({ simSubscriptionId: 19, simUsed: { subscriptionId: 19 } }))
    ).toBe(false)
    expect(simMismatch(msg({ simSubscriptionId: 18 }))).toBe(false)
    expect(simMismatch(msg({ simUsed: { subscriptionId: 17 } }))).toBe(false)
  })
})

describe('simDetails', () => {
  it('lists the slot and the subscription ID', () => {
    expect(simDetails(msg({ simUsed: { subscriptionId: 19, slotIndex: 1 } }))).toEqual([
      'Slot: SIM 2 (slotIndex 1)',
      'Subscription ID: 19',
    ])
  })

  it('lists only the parts the phone reported', () => {
    expect(simDetails(msg({ simUsed: { subscriptionId: 0 } }))).toEqual([
      'Subscription ID: 0',
    ])
    expect(simDetails(msg({}))).toEqual([])
  })
})

describe('simCarrier and simNameWithCarrier', () => {
  it('adds the carrier to the SIM name', () => {
    const m = msg({ simUsed: { slotIndex: 1, carrierName: ' Smart ' } })
    expect(simCarrier(m)).toBe('Smart')
    expect(simNameWithCarrier(m)).toBe('SIM 2 · Smart')
  })

  it('shows the name alone when the carrier is missing or blank', () => {
    expect(simNameWithCarrier(msg({ simUsed: { slotIndex: 0 } }))).toBe('SIM 1')
    expect(
      simNameWithCarrier(msg({ simUsed: { slotIndex: 0, carrierName: '  ' } }))
    ).toBe('SIM 1')
  })

  it('names the SIM by its carrier when nothing else is known', () => {
    const m = msg({ type: 'RECEIVED', simUsed: { carrierName: 'Smart' } })
    expect(simName(m)).toBe('Smart')
    expect(simNameWithCarrier(m)).toBe('Smart')
    expect(simFullLabel(m)).toBe('Received on Smart')
  })
})

describe('simDetails with carrier data', () => {
  it('lists every part the phone reported', () => {
    expect(
      simDetails(
        msg({
          simUsed: {
            subscriptionId: 19,
            slotIndex: 1,
            carrierName: 'Smart',
            displayName: 'Work',
            countryIso: 'ph',
            mcc: '515',
            mnc: '03',
          },
        })
      )
    ).toEqual([
      'Slot: SIM 2 (slotIndex 1)',
      'Subscription ID: 19',
      'Carrier: Smart',
      'Name on phone: Work',
      'Country: PH',
      'Network code: 515-03',
    ])
  })

  it('skips a phone name that only repeats the carrier', () => {
    expect(
      simDetails(msg({ simUsed: { carrierName: 'Smart', displayName: 'Smart' } }))
    ).toEqual(['Carrier: Smart'])
  })

  it('shows either code alone when the other is missing', () => {
    expect(simDetails(msg({ simUsed: { mcc: '515' } }))).toEqual([
      'Mobile country code: 515',
    ])
    expect(simDetails(msg({ simUsed: { mnc: '03' } }))).toEqual([
      'Mobile network code: 03',
    ])
  })
})

describe('simFullLabel', () => {
  it('adds the carrier and the ID', () => {
    expect(
      simFullLabel(
        msg({
          type: 'RECEIVED',
          simUsed: { subscriptionId: 19, slotIndex: 1, carrierName: 'Smart' },
        })
      )
    ).toBe('Received on SIM 2 · Smart (ID 19)')
  })

  it('adds the ID when the slot named the SIM', () => {
    expect(
      simFullLabel(msg({ type: 'SENT', simUsed: { subscriptionId: 19, slotIndex: 1 } }))
    ).toBe('Sent from SIM 2 (ID 19)')
  })

  it('does not repeat the ID when it already named the SIM', () => {
    expect(simFullLabel(msg({ type: 'SENT', simUsed: { subscriptionId: 19 } }))).toBe(
      'Sent from SIM ID 19'
    )
    expect(simFullLabel(msg({ type: 'SENT' }))).toBeUndefined()
  })
})

describe('simRequested', () => {
  it('names the requested slot, never the index', () => {
    expect(simRequested(msg({ simSlotIndex: 1 }))).toBe('Requested SIM 2')
    expect(simRequested(msg({ simSlotIndex: 0 }))).toBe('Requested SIM 1')
  })

  it('names the requested ID for older requests', () => {
    expect(simRequested(msg({ simSubscriptionId: 19 }))).toBe('Requested SIM ID 19')
  })

  it('is undefined when no SIM was requested', () => {
    expect(simRequested(msg({ simUsed: { slotIndex: 1 } }))).toBeUndefined()
  })
})

describe('simSlotMismatch', () => {
  it('is true when the phone used another slot than requested', () => {
    expect(simSlotMismatch(msg({ simSlotIndex: 1, simUsed: { slotIndex: 0 } }))).toBe(true)
  })

  it('is false when they match or either side is unknown', () => {
    expect(simSlotMismatch(msg({ simSlotIndex: 1, simUsed: { slotIndex: 1 } }))).toBe(false)
    expect(simSlotMismatch(msg({ simSlotIndex: 1 }))).toBe(false)
    expect(simSlotMismatch(msg({ simUsed: { slotIndex: 0 } }))).toBe(false)
  })

  it('leaves the ID mismatch note to ID requests', () => {
    expect(
      simMismatch(msg({ simSlotIndex: 1, simSubscriptionId: 18, simUsed: { subscriptionId: 17 } }))
    ).toBe(false)
  })
})

describe('SIM number label', () => {
  it('puts the saved number between the SIM and the carrier', () => {
    const m = msg({ type: 'SENT', simUsed: { subscriptionId: 19, slotIndex: 1, carrierName: 'Smart' } })
    expect(simNameWithCarrier(m, '+15555550123')).toBe('SIM 2 · +15555550123 · Smart')
    expect(simFullLabel(m, '+15555550123')).toBe('Sent from SIM 2 · +15555550123 · Smart (ID 19)')
  })

  it('skips the number when the slot is unknown or the number is blank', () => {
    expect(simNameWithCarrier(msg({ simUsed: { subscriptionId: 19 } }), '+15555550123')).toBe(
      'SIM ID 19'
    )
    expect(simNameWithCarrier(msg({ simUsed: { slotIndex: 0 } }), '  ')).toBe('SIM 1')
  })
})
