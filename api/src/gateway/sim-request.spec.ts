import {
  SIM_SUBSCRIPTION_ID_INVALID_ERROR,
  SIM_SLOT_INDEX_INVALID_ERROR,
  SIM_SLOT_MIN_APP_VERSION_CODE,
  SIM_SLOT_UNSUPPORTED_ERROR,
  resolveSimRequest,
  simPayloadFor,
  simSlotNotReportedError,
} from './sim-request'

const dualSim = {
  sims: [
    { subscriptionId: 3, simSlotIndex: 0 },
    { subscriptionId: 7, simSlotIndex: 1 },
  ],
}
const slotRelease = {
  appVersionCode: SIM_SLOT_MIN_APP_VERSION_CODE,
  simInfo: dualSim,
}
const oldApp = { appVersionCode: 20, simInfo: dualSim }

describe('resolveSimRequest validation', () => {
  it.each([
    ['a fraction', 1.5],
    ['a negative number', -1],
    ['a slot above 7', 8],
    ['a numeric string', '1'],
    ['a boolean', true],
    ['NaN', Number.NaN],
    ['an object', {}],
  ])('rejects %s', (_name, simSlotIndex) => {
    expect(resolveSimRequest(slotRelease, { simSlotIndex })).toEqual({
      ok: false,
      error:
        'simSlotIndex must be a whole number from 0 to 7. 0 is SIM 1, 1 is SIM 2.',
    })
  })

  it('accepts every slot from 0 to 7 on the slot release', () => {
    for (let slot = 0; slot <= 7; slot++) {
      expect(resolveSimRequest(slotRelease, { simSlotIndex: slot }).ok).toBe(
        true,
      )
    }
  })

  it('validates the slot before looking at the device', () => {
    expect(resolveSimRequest(null, { simSlotIndex: 9 })).toEqual({
      ok: false,
      error: SIM_SLOT_INDEX_INVALID_ERROR,
    })
  })

  it('treats null as no slot', () => {
    expect(
      resolveSimRequest(oldApp, { simSlotIndex: null, simSubscriptionId: 4 }),
    ).toEqual({
      ok: true,
      stored: { simSubscriptionId: 4 },
      metadata: {},
      payload: { simSubscriptionId: 4 },
    })
  })
})

describe('resolveSimRequest without a slot', () => {
  it('passes simSubscriptionId through unchanged, whatever the device', () => {
    for (const device of [
      null,
      {},
      oldApp,
      slotRelease,
      { appVersionCode: 10 },
    ]) {
      expect(resolveSimRequest(device, { simSubscriptionId: 0 })).toEqual({
        ok: true,
        stored: { simSubscriptionId: 0 },
        metadata: {},
        payload: { simSubscriptionId: 0 },
      })
    }
  })

  it('adds nothing when no SIM is requested', () => {
    expect(resolveSimRequest(oldApp, {})).toEqual({
      ok: true,
      stored: {},
      metadata: {},
      payload: {},
    })
  })
})

describe('resolveSimRequest mapping', () => {
  it('maps the slot to the reported SIM for the slot release', () => {
    expect(resolveSimRequest(slotRelease, { simSlotIndex: 1 })).toEqual({
      ok: true,
      stored: { simSlotIndex: 1 },
      metadata: { simMappedSubscriptionId: 7 },
      payload: { simSlotIndex: 1, simSubscriptionId: 7 },
    })
  })

  it('maps the slot for an older app', () => {
    expect(resolveSimRequest(oldApp, { simSlotIndex: 0 })).toEqual({
      ok: true,
      stored: { simSlotIndex: 0 },
      metadata: { simMappedSubscriptionId: 3 },
      payload: { simSlotIndex: 0, simSubscriptionId: 3 },
    })
  })

  it('maps subscription id 0, which Android allows', () => {
    const device = {
      appVersionCode: 18,
      simInfo: { sims: [{ subscriptionId: 0, simSlotIndex: 1 }] },
    }
    expect(resolveSimRequest(device, { simSlotIndex: 1 })).toMatchObject({
      ok: true,
      metadata: { simMappedSubscriptionId: 0 },
      payload: { simSlotIndex: 1, simSubscriptionId: 0 },
    })
  })

  it('lets the slot release resolve an unreported slot itself', () => {
    expect(resolveSimRequest(slotRelease, { simSlotIndex: 2 })).toEqual({
      ok: true,
      stored: { simSlotIndex: 2 },
      metadata: {},
      payload: { simSlotIndex: 2 },
    })
  })

  it('lets the slot release send without any SIM report', () => {
    expect(
      resolveSimRequest({ appVersionCode: 22 }, { simSlotIndex: 0 }),
    ).toEqual({
      ok: true,
      stored: { simSlotIndex: 0 },
      metadata: {},
      payload: { simSlotIndex: 0 },
    })
  })

  it('uses the slot and drops simSubscriptionId when both are sent', () => {
    const request = resolveSimRequest(oldApp, {
      simSlotIndex: 1,
      simSubscriptionId: 3,
    })
    expect(request).toEqual({
      ok: true,
      stored: { simSlotIndex: 1 },
      metadata: { simMappedSubscriptionId: 7 },
      payload: { simSlotIndex: 1, simSubscriptionId: 7 },
    })
  })

  it('takes the heartbeat version when the device never registered one', () => {
    const device = { appVersionInfo: { versionCode: 22 } }
    expect(resolveSimRequest(device, { simSlotIndex: 4 })).toMatchObject({
      ok: true,
      payload: { simSlotIndex: 4 },
    })
  })

  it('takes the lower version when heartbeat and registration disagree', () => {
    // A build 22 heartbeat, then build 21 reinstalled and registered again
    const downgraded = {
      appVersionCode: 21,
      appVersionInfo: { versionCode: 22 },
      simInfo: dualSim,
    }
    expect(resolveSimRequest(downgraded, { simSlotIndex: 4 })).toEqual({
      ok: false,
      error:
        "The phone's last report shows no SIM 5 (simSlotIndex 4). Open the textbee app to refresh, or update the app.",
    })
    expect(
      resolveSimRequest(
        {
          ...downgraded,
          appVersionCode: 22,
          appVersionInfo: { versionCode: 21 },
        },
        { simSlotIndex: 4 },
      ),
    ).toMatchObject({ ok: false })
  })

  it('ignores a reported SIM without a usable subscription id', () => {
    const device = {
      appVersionCode: 22,
      simInfo: {
        sims: [{ simSlotIndex: 1 }, { subscriptionId: '7', simSlotIndex: 1 }],
      },
    }
    expect(resolveSimRequest(device, { simSlotIndex: 1 })).toEqual({
      ok: true,
      stored: { simSlotIndex: 1 },
      metadata: {},
      payload: { simSlotIndex: 1 },
    })
  })
})

describe('resolveSimRequest with a reported id the phone cannot read', () => {
  it.each([-1, 2147483647, 3000000000, 1.5])(
    'refuses a slot an older app would send from another SIM, for a reported id of %p',
    (subscriptionId) => {
      const device = {
        appVersionCode: 20,
        simInfo: { sims: [{ subscriptionId, simSlotIndex: 1 }] },
      }
      expect(resolveSimRequest(device, { simSlotIndex: 1 })).toEqual({
        ok: false,
        error: simSlotNotReportedError(1),
      })
    },
  )

  it('maps the valid SIM when the slot also lists one the phone cannot read', () => {
    const device = {
      appVersionCode: 20,
      simInfo: {
        sims: [
          { subscriptionId: -1, simSlotIndex: 1 },
          { subscriptionId: 9, simSlotIndex: 1 },
        ],
      },
    }
    expect(resolveSimRequest(device, { simSlotIndex: 1 })).toMatchObject({
      ok: true,
      metadata: { simMappedSubscriptionId: 9 },
      payload: { simSlotIndex: 1, simSubscriptionId: 9 },
    })
  })

  it('still sends the slot alone to the slot release', () => {
    const device = {
      appVersionCode: 22,
      simInfo: { sims: [{ subscriptionId: -1, simSlotIndex: 1 }] },
    }
    expect(resolveSimRequest(device, { simSlotIndex: 1 })).toEqual({
      ok: true,
      stored: { simSlotIndex: 1 },
      metadata: {},
      payload: { simSlotIndex: 1 },
    })
  })
})

describe('resolveSimRequest on apps before the slot release', () => {
  it.each([
    ['below 2.6.2', { appVersionCode: 14, simInfo: dualSim }],
    [
      'on 2.6.2, which reports slots but cannot choose a SIM',
      { appVersionCode: 15, simInfo: dualSim },
    ],
    ['that reports slots but no version', { simInfo: dualSim }],
    ['with no SIM report', { appVersionCode: 20 }],
    ['with an empty SIM report', { appVersionCode: 20, simInfo: { sims: [] } }],
    ['with no version and no SIM report', {}],
    ['for a missing device', null],
  ])('refuses %s', (_name, device) => {
    expect(resolveSimRequest(device, { simSlotIndex: 0 })).toEqual({
      ok: false,
      error:
        "This device's textbee app cannot choose a SIM. Update the app, or send without simSlotIndex.",
    })
  })

  it('refuses a slot the last report does not show, naming it both ways', () => {
    expect(resolveSimRequest(oldApp, { simSlotIndex: 2 })).toEqual({
      ok: false,
      error:
        "The phone's last report shows no SIM 3 (simSlotIndex 2). Open the textbee app to refresh, or update the app.",
    })
  })

  it('refuses build 21, the last one before the slot release', () => {
    const device = {
      appVersionCode: 21,
      simInfo: { sims: [{ subscriptionId: 3, simSlotIndex: 0 }] },
    }
    expect(resolveSimRequest(device, { simSlotIndex: 1 })).toEqual({
      ok: false,
      error:
        "The phone's last report shows no SIM 2 (simSlotIndex 1). Open the textbee app to refresh, or update the app.",
    })
  })

  it('maps for 2.7.0, the first release that sends from a chosen SIM', () => {
    expect(
      resolveSimRequest(
        { appVersionCode: 16, simInfo: dualSim },
        { simSlotIndex: 1 },
      ),
    ).toMatchObject({
      ok: true,
      payload: { simSlotIndex: 1, simSubscriptionId: 7 },
    })
  })

  it('refuses even when simSubscriptionId is also sent', () => {
    expect(
      resolveSimRequest(
        { appVersionCode: 14 },
        { simSlotIndex: 0, simSubscriptionId: 3 },
      ),
    ).toEqual({ ok: false, error: SIM_SLOT_UNSUPPORTED_ERROR })
  })
})

describe('simPayloadFor', () => {
  it('rebuilds the slot payload from a stored message', () => {
    expect(
      simPayloadFor({
        simSlotIndex: 1,
        metadata: { simMappedSubscriptionId: 7 },
      }),
    ).toEqual({ simSlotIndex: 1, simSubscriptionId: 7 })
  })

  it('never sends a stored simSubscriptionId next to a slot', () => {
    expect(simPayloadFor({ simSlotIndex: 1, simSubscriptionId: 3 })).toEqual({
      simSlotIndex: 1,
    })
  })

  it('keeps an id-only message as it was', () => {
    expect(simPayloadFor({ simSubscriptionId: 3 })).toEqual({
      simSubscriptionId: 3,
    })
    expect(simPayloadFor({})).toEqual({})
  })
})

describe('resolveSimRequest simSubscriptionId validation', () => {
  it.each([
    ['0', 0, 0],
    ['the largest id', 2147483646, 2147483646],
    ['a string of digits', '12', 12],
    ['a string with spaces', ' 7 ', 7],
    ['the JSON number 1.0', JSON.parse('1.0'), 1],
    ['"1.0"', '1.0', 1],
    ['"1."', '1.', 1],
    ['"+1"', '+1', 1],
    ['"1e0"', '1e0', 1],
    ['"1E1"', '1E1', 10],
    ['"1e+1"', '1e+1', 10],
    ['"150e-1"', '150e-1', 15],
    ['"00000000001"', '00000000001', 1],
    ['"0e5"', '0e5', 0],
    ['"0.0"', '0.0', 0],
    ['"-0"', '-0', 0],
    ['the largest id as a string', '2147483646', 2147483646],
  ])('accepts %s', (_name, simSubscriptionId, stored) => {
    expect(resolveSimRequest(oldApp, { simSubscriptionId })).toEqual({
      ok: true,
      stored: { simSubscriptionId: stored },
      metadata: {},
      payload: { simSubscriptionId: stored },
    })
  })

  it.each([
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '   '],
    ['-1', -1],
    ['"-1"', '-1'],
    ['-2', -2],
    ['"-7.0"', '-7.0'],
    ['Integer.MIN_VALUE', -2147483648],
    ['"-2147483648"', '-2147483648'],
    ['Integer.MAX_VALUE', 2147483647],
    ['"2147483647"', '2147483647'],
    ['"2147483647.0"', '2147483647.0'],
  ])('treats %s as no SIM chosen', (_name, simSubscriptionId) => {
    expect(resolveSimRequest(oldApp, { simSubscriptionId })).toEqual({
      ok: true,
      stored: {},
      metadata: {},
      payload: {},
    })
  })

  it.each([
    ['a fraction', 1.5],
    ['a fraction string', '1.5'],
    ['a boolean', true],
    ['a fraction in exponent form', '15e-1'],
    ['a fraction after a zero', '1.05'],
    ['false', false],
    ['a number above 32 bits', 3000000000],
    ['a string above 32 bits', '3000000000'],
    ['2147483648', 2147483648],
    ['a negative number below 32 bits', -2147483649],
    ['a negative string below 32 bits', '-3000000000'],
    ['an exponent beyond any number', '1e400'],
    ['a value too small to read', '1e-999'],
    ['a negative value too small to read', '-5e-400'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['"Infinity"', 'Infinity'],
    ['hex', '0x10'],
    ['a dot alone', '.'],
    ['a leading dot', '.0'],
    ['text', 'sim1'],
    ['a number with a space inside', '1 2'],
    ['an object', {}],
    ['an array', [1]],
  ])('rejects %s', (_name, simSubscriptionId) => {
    expect(resolveSimRequest(oldApp, { simSubscriptionId })).toEqual({
      ok: false,
      error: SIM_SUBSCRIPTION_ID_INVALID_ERROR,
    })
  })

  it('names the field and what it allows', () => {
    expect(SIM_SUBSCRIPTION_ID_INVALID_ERROR).toContain('simSubscriptionId')
    expect(SIM_SUBSCRIPTION_ID_INVALID_ERROR).toContain('0 to 2147483646')
  })

  it('ignores simSubscriptionId when a slot is sent, as documented', () => {
    expect(
      resolveSimRequest(slotRelease, {
        simSlotIndex: 1,
        simSubscriptionId: 1.5,
      }),
    ).toMatchObject({ ok: true, stored: { simSlotIndex: 1 } })
  })
})

describe('simPayloadFor with stored values the phone cannot read', () => {
  it.each([
    ['a fraction', 1.5],
    ['a number above 32 bits', 3000000000],
    ['a negative number', -1],
    ['a string', '3'],
    ['null', null],
  ])('leaves out a stored simSubscriptionId that is %s', (_name, value) => {
    expect(simPayloadFor({ simSubscriptionId: value as any })).toEqual({})
  })

  it('leaves out a mapped id the phone cannot read, keeping the slot', () => {
    expect(
      simPayloadFor({
        simSlotIndex: 1,
        metadata: { simMappedSubscriptionId: 3000000000 },
      }),
    ).toEqual({ simSlotIndex: 1 })
  })
})
