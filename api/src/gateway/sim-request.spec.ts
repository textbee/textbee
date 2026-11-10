import {
  SIM_SLOT_INDEX_INVALID_ERROR,
  SIM_SLOT_MIN_APP_VERSION_CODE,
  SIM_SLOT_UNSUPPORTED_ERROR,
  resolveSimRequest,
  simPayloadFor,
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
