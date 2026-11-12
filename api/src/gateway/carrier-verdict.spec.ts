import {
  carrierVerdict,
  carrierVerdictEnabled,
  cdmaVerdict,
  gsmVerdict,
} from './carrier-verdict'

const hex = (value: number) => `0x${value.toString(16).padStart(2, '0')}`
const failed = (code: string) => ({ kind: 'failed', code })

describe('carrier verdict', () => {
  it('reads completed statuses as delivered', () => {
    for (const status of [0x00, 0x01, 0x02, 0x10, 0x1f]) {
      expect([hex(status), gsmVerdict(status)]).toEqual([hex(status), { kind: 'delivered' }])
    }
  })

  it('reads statuses the carrier still tries as still trying', () => {
    for (const status of [0x20, 0x21, 0x25, 0x30, 0x3f]) {
      expect([hex(status), gsmVerdict(status)]).toEqual([hex(status), { kind: 'still_trying' }])
    }
  })

  it('fails permanent errors with the status code', () => {
    expect(gsmVerdict(0x40)).toEqual(failed('CARRIER_0x40'))
    expect(gsmVerdict(0x4a)).toEqual(failed('CARRIER_0x4A'))
    expect(gsmVerdict(0x5f)).toEqual(failed('CARRIER_0x5F'))
  })

  it('fails temporary errors the carrier gave up on', () => {
    expect(gsmVerdict(0x62)).toEqual(failed('CARRIER_0x62'))
    expect(gsmVerdict(0x7f)).toEqual(failed('CARRIER_0x7F'))
  })

  it('fails reserved high values', () => {
    expect(gsmVerdict(0x80)).toEqual(failed('CARRIER_0x80'))
    expect(gsmVerdict(0xff)).toEqual(failed('CARRIER_0xFF'))
  })

  it('reads no verdict from values outside one byte', () => {
    expect(gsmVerdict(-1)).toBeNull()
    expect(gsmVerdict(0x100)).toBeNull()
    expect(gsmVerdict(2 << 16)).toBeNull()
    expect(gsmVerdict(1.5)).toBeNull()
  })

  it('lets the 3GPP2 error class decide', () => {
    // class 0, cause 2: delivered
    expect(cdmaVerdict(2 << 16)).toEqual({ kind: 'delivered' })
    expect(cdmaVerdict((2 << 24) | (0x21 << 16))).toEqual({ kind: 'still_trying' })
    expect(cdmaVerdict((3 << 24) | (0x05 << 16))).toEqual(failed('CARRIER_3GPP2_0x05'))
    // class 1 is reserved and counts as failed
    expect(cdmaVerdict(1 << 24)).toEqual(failed('CARRIER_3GPP2_0x00'))
  })

  it('reads no 3GPP2 verdict from a value outside 32 bits', () => {
    expect(cdmaVerdict(2 ** 32)).toBeNull()
    expect(cdmaVerdict(0.5)).toBeNull()
  })

  it('picks the rule by format', () => {
    expect(carrierVerdict('3gpp', 0x20)).toEqual({ kind: 'still_trying' })
    expect(carrierVerdict('3gpp2', 0x20)).toEqual({ kind: 'delivered' })
    expect(carrierVerdict('unknown', 0x00)).toBeNull()
    expect(carrierVerdict(undefined, 0x00)).toBeNull()
    expect(carrierVerdict('3gpp', undefined)).toBeNull()
  })

  describe('switch', () => {
    const env = { ...process.env }
    afterEach(() => {
      process.env = { ...env }
    })

    it('is off when unset', () => {
      delete process.env.CARRIER_VERDICT_ENABLED
      expect(carrierVerdictEnabled({})).toBe(false)
    })

    it('follows the environment', () => {
      process.env.CARRIER_VERDICT_ENABLED = 'true'
      expect(carrierVerdictEnabled({})).toBe(true)
    })

    it('lets a device override win either way', () => {
      process.env.CARRIER_VERDICT_ENABLED = 'false'
      expect(
        carrierVerdictEnabled({ configOverrides: { carrierVerdictEnabled: true } }),
      ).toBe(true)
      process.env.CARRIER_VERDICT_ENABLED = 'true'
      expect(
        carrierVerdictEnabled({ configOverrides: { carrierVerdictEnabled: false } }),
      ).toBe(false)
    })

    it('ignores an override of the wrong type', () => {
      delete process.env.CARRIER_VERDICT_ENABLED
      expect(
        carrierVerdictEnabled({ configOverrides: { carrierVerdictEnabled: 'true' } }),
      ).toBe(false)
    })
  })
})
