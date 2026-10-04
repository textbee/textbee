import { resolveSimSelection, resolveSimUsed } from './sim-report'

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

describe('resolveSimSelection', () => {
  it('takes a known value', () => {
    expect(resolveSimSelection('requested')).toBe('requested')
    expect(resolveSimSelection('requested_invalid_fallback')).toBe(
      'requested_invalid_fallback',
    )
  })

  it('ignores anything else', () => {
    for (const value of [undefined, null, '', 'REQUESTED', 'other', 1, {}]) {
      expect(resolveSimSelection(value)).toBeUndefined()
    }
  })
})
