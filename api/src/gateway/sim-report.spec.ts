import {
  hasNestedSimUsed,
  resolveSimSelection,
  resolveSimUsed,
  resolveSimUsedReport,
} from './sim-report'

describe('resolveSimUsed', () => {
  it('takes both parts, as numbers or strings', () => {
    expect(resolveSimUsed(19, 1)).toEqual({ subscriptionId: 19, slotIndex: 1 })
    expect(resolveSimUsed('19', '1')).toEqual({
      subscriptionId: 19,
      slotIndex: 1,
    })
  })

  it('keeps one valid part when the other is missing', () => {
    expect(resolveSimUsed(19, undefined)).toEqual({ subscriptionId: 19 })
    expect(resolveSimUsed(undefined, 0)).toEqual({ slotIndex: 0 })
  })

  it('returns undefined when nothing usable is reported', () => {
    for (const [id, slot] of [
      [undefined, undefined],
      [null, null],
      ['', '   '],
      [{}, []],
      [1.5, 0.5],
      [NaN, NaN],
    ]) {
      expect(resolveSimUsed(id, slot)).toBeUndefined()
    }
  })

  it('keeps subscription id 0, which Android allows', () => {
    expect(resolveSimUsed(0, 1)).toEqual({ subscriptionId: 0, slotIndex: 1 })
    expect(resolveSimUsed('0', undefined)).toEqual({ subscriptionId: 0 })
  })

  it('takes only plain digit strings', () => {
    for (const value of ['0x13', '1e1', '-5', '19abc', ' 1 9 ']) {
      expect(resolveSimUsed(value, undefined)).toBeUndefined()
    }
    expect(resolveSimUsed(' 19 ', undefined)).toEqual({ subscriptionId: 19 })
  })

  it('drops Android sentinel values', () => {
    // -1 is INVALID_SUBSCRIPTION_ID and INVALID_SIM_SLOT_INDEX
    expect(resolveSimUsed(-1, -1)).toBeUndefined()
    // Integer.MAX_VALUE is DEFAULT_SUBSCRIPTION_ID, not a real SIM
    expect(resolveSimUsed(2147483647, 1)).toEqual({ slotIndex: 1 })
    expect(resolveSimUsed(19, 8)).toEqual({ subscriptionId: 19 })
  })
})

describe('resolveSimUsedReport', () => {
  it('takes every field of the nested object', () => {
    expect(
      resolveSimUsedReport({
        simUsed: {
          subscriptionId: 19,
          slotIndex: 1,
          carrierName: 'Smart',
          displayName: 'Work',
          countryIso: 'PH',
          mcc: '515',
          mnc: '03',
        },
      }),
    ).toEqual({
      subscriptionId: 19,
      slotIndex: 1,
      carrierName: 'Smart',
      displayName: 'Work',
      countryIso: 'ph',
      mcc: '515',
      mnc: '03',
    })
  })

  it('falls back to the flat fields of older apps', () => {
    expect(
      resolveSimUsedReport({ simSubscriptionId: 19, simSlotIndex: 1 }),
    ).toEqual({ subscriptionId: 19, slotIndex: 1 })
  })

  it('prefers the nested object over the flat fields', () => {
    expect(
      resolveSimUsedReport({
        simUsed: { subscriptionId: 20 },
        simSubscriptionId: 19,
        simSlotIndex: 1,
      }),
    ).toEqual({ subscriptionId: 20, slotIndex: 1 })
  })

  it('drops bad fields one by one and keeps the rest', () => {
    expect(
      resolveSimUsedReport({
        simUsed: {
          subscriptionId: -1,
          slotIndex: 0,
          carrierName: '   ',
          displayName: 42,
          countryIso: 'Philippines',
          mcc: 'abc',
          mnc: '1234',
        },
      }),
    ).toEqual({ slotIndex: 0 })
  })

  it('trims and caps names', () => {
    const long = 'x'.repeat(100)
    expect(
      resolveSimUsedReport({ simUsed: { carrierName: '  Smart ', displayName: long } }),
    ).toEqual({ carrierName: 'Smart', displayName: 'x'.repeat(64) })
  })

  it('takes network codes as numbers too', () => {
    expect(resolveSimUsedReport({ simUsed: { mcc: 515, mnc: 3 } })).toEqual({
      mcc: '515',
    })
  })

  it('returns undefined when nothing usable is reported', () => {
    for (const report of [
      undefined,
      null,
      {},
      { simUsed: null },
      { simUsed: 'SIM 2' },
      { simUsed: {} },
      { simUsed: { carrierName: '' }, simSubscriptionId: -1 },
    ]) {
      expect(resolveSimUsedReport(report as any)).toBeUndefined()
    }
  })
})

describe('hasNestedSimUsed', () => {
  it('is true only for an object', () => {
    expect(hasNestedSimUsed({ simUsed: {} })).toBe(true)
    expect(hasNestedSimUsed({ simUsed: { slotIndex: 0 } })).toBe(true)
    for (const report of [
      undefined,
      null,
      {},
      { simUsed: null },
      { simUsed: 'SIM 2' },
      { simUsed: [] },
      { simSubscriptionId: 19 },
    ]) {
      expect(hasNestedSimUsed(report as any)).toBe(false)
    }
  })
})

describe('resolveSimSelection', () => {
  it('takes a known value', () => {
    expect(resolveSimSelection('requested')).toBe('requested')
    expect(resolveSimSelection('requested_invalid_fallback')).toBe(
      'requested_invalid_fallback',
    )
  })

  it('takes the slot outcomes', () => {
    expect(resolveSimSelection('requested_slot')).toBe('requested_slot')
    expect(resolveSimSelection('requested_slot_empty')).toBe(
      'requested_slot_empty',
    )
  })

  it('ignores anything else', () => {
    for (const value of [undefined, null, '', 'REQUESTED', 'other', 1, {}]) {
      expect(resolveSimSelection(value)).toBeUndefined()
    }
  })
})
