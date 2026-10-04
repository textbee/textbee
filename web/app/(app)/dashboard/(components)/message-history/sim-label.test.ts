import { describe, expect, it } from 'vitest'
import {
  simDetails,
  simFullLabel,
  simLabel,
  simMismatch,
  simName,
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

describe('simFullLabel', () => {
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
