import { describe, expect, it } from 'vitest'
import { SIM_ID_ERROR, parseSimId, reportedSims } from './sim-id'

describe('parseSimId', () => {
  it('reads a whole number, including 0', () => {
    expect(parseSimId('19')).toBe(19)
    expect(parseSimId(' 17 ')).toBe(17)
    expect(parseSimId('0')).toBe(0)
  })

  it('treats empty text as no SIM chosen', () => {
    expect(parseSimId('')).toBeUndefined()
    expect(parseSimId('   ')).toBeUndefined()
  })

  it('rejects IDs beyond a 32-bit int instead of rounding them', () => {
    expect(parseSimId('2147483647')).toBe(2147483647)
    expect(parseSimId('2147483648')).toBeNaN()
    expect(parseSimId('12345678901234567890')).toBeNaN()
  })

  it('marks anything else as invalid', () => {
    for (const text of ['1.5', '-1', '1e1', '0x13', 'sim2', '1 9']) {
      expect(parseSimId(text)).toBeNaN()
    }
  })
})

describe('reportedSims', () => {
  it('labels each SIM by slot and carrier', () => {
    expect(
      reportedSims({
        sims: [
          { subscriptionId: 17, simSlotIndex: 0, carrierName: 'Smart' },
          { subscriptionId: 19, simSlotIndex: 1, displayName: 'Work' },
        ],
      })
    ).toEqual([
      { subscriptionId: 17, label: 'SIM 1 · Smart' },
      { subscriptionId: 19, label: 'SIM 2 · Work' },
    ])
  })

  it('leaves out IDs the field would reject, such as -1', () => {
    expect(
      reportedSims({ sims: [{ subscriptionId: -1 }, { subscriptionId: 2147483648 }, { subscriptionId: 7 }] })
    ).toEqual([{ subscriptionId: 7, label: 'SIM' }])
  })

  it('lists a repeated ID once', () => {
    expect(
      reportedSims({ sims: [{ subscriptionId: 5 }, { subscriptionId: 5, simSlotIndex: 1 }] })
    ).toEqual([{ subscriptionId: 5, label: 'SIM' }])
  })

  it('skips entries without a usable ID and handles a missing report', () => {
    expect(reportedSims({ sims: [{ simSlotIndex: 0 }, { subscriptionId: 3 }] })).toEqual([
      { subscriptionId: 3, label: 'SIM' },
    ])
    expect(reportedSims(undefined)).toEqual([])
  })
})

describe('sendSmsSchema simSubscriptionId', () => {
  const base = { deviceId: 'd1', recipients: ['+15550100'], message: 'hi' }

  it('accepts an ID or none', async () => {
    const { sendSmsSchema } = await import('./schemas')
    expect(sendSmsSchema.safeParse({ ...base, simSubscriptionId: 19 }).success).toBe(true)
    expect(sendSmsSchema.safeParse({ ...base, simSubscriptionId: 0 }).success).toBe(true)
    expect(sendSmsSchema.safeParse(base).success).toBe(true)
  })

  it('blocks the send while the typed ID is not a whole number', async () => {
    const { sendSmsSchema } = await import('./schemas')
    const result = sendSmsSchema.safeParse({ ...base, simSubscriptionId: NaN })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(SIM_ID_ERROR)
    expect(
      sendSmsSchema.safeParse({ ...base, simSubscriptionId: 2147483648 }).success
    ).toBe(false)
  })
})
