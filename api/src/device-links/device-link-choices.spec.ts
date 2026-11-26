import {
  ChoiceDevice,
  ChoiceInput,
  DeviceOption,
  NewOption,
  TEXTS,
  buildChoices,
  checkChoice,
  classify,
  defaultDeviceName,
  isOnline,
  m2Text,
  networkFacts,
  placeLabel,
  relativeTime,
  sameNetwork,
  strongSameNetwork,
  w1Text,
} from './device-link-choices'

const NOW = new Date('2026-11-26T12:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000)
const ONLINE = minutesAgo(10)
const OFFLINE = minutesAgo(3 * 60)

const id = (n: number) => `665f1c2ab3d4e5f6a7b8c9${String(n).padStart(2, '0')}`

function device(n: number, fields: Partial<ChoiceDevice> = {}): ChoiceDevice {
  return {
    _id: id(n),
    name: `Phone ${n}`,
    brand: 'Google',
    model: 'Pixel 8',
    enabled: true,
    lastHeartbeat: OFFLINE,
    heartbeatIntervalMinutes: 30,
    ...fields,
  }
}

const samePhone = { phoneId: 'P1', phoneSigner: 'S1' }
const request = { brand: 'Google', model: 'Pixel 8', phoneId: 'P1', phoneSigner: 'S1' }

function choices(input: Partial<ChoiceInput> = {}) {
  return buildChoices({
    request,
    devices: [],
    limit: null,
    strongSameNetwork: true,
    now: NOW,
    ...input,
    activeCount:
      input.activeCount ?? (input.devices ?? []).filter((entry) => entry.enabled).length,
  })
}

const deviceOption = (result: ReturnType<typeof choices>, n: number) =>
  result.options.find(
    (option): option is DeviceOption => option.type === 'reconnect' && option.deviceId === id(n),
  )
const newOption = (result: ReturnType<typeof choices>) =>
  result.options.find((option): option is NewOption => option.type === 'new')

describe('classify', () => {
  it('needs equal ids from the same signer and the same brand and model', () => {
    expect(classify(device(1, samePhone), request)).toBe('same-phone')
    expect(classify(device(1, { ...samePhone, brand: ' GOOGLE ', model: 'pixel 8' }), request)).toBe(
      'same-phone',
    )
  })

  it('reads another id from the same signer as another phone', () => {
    expect(classify(device(1, { phoneId: 'P2', phoneSigner: 'S1' }), request)).toBe('other')
    expect(classify(device(1, samePhone), { ...request, phoneId: undefined })).toBe('other')
  })

  it('reads a shared id on another model as another phone', () => {
    expect(classify(device(1, { ...samePhone, model: 'Pixel 9' }), request)).toBe('other')
  })

  it('reads no id on record or another signer as unknown', () => {
    expect(classify(device(1), request)).toBe('unknown')
    expect(classify(device(1, { phoneId: 'P1', phoneSigner: 'S2' }), request)).toBe('unknown')
    expect(classify(device(1, samePhone), { ...request, phoneSigner: undefined })).toBe('unknown')
  })
})

describe('isOnline', () => {
  it('uses the larger of 65 minutes and two intervals plus 5 minutes', () => {
    expect(isOnline(device(1, { lastHeartbeat: minutesAgo(64) }), NOW)).toBe(true)
    expect(isOnline(device(1, { lastHeartbeat: minutesAgo(66) }), NOW)).toBe(false)
    expect(
      isOnline(device(1, { lastHeartbeat: minutesAgo(120), heartbeatIntervalMinutes: 60 }), NOW),
    ).toBe(true)
    expect(isOnline(device(1, { lastHeartbeat: undefined }), NOW)).toBe(false)
  })
})

describe('the main cases', () => {
  it('first phone on the account: new device, no list', () => {
    const result = choices()
    expect(result.mode).toBe('choose')
    expect(result.suggested).toBe('new')
    expect(result.options).toEqual([{ type: 'new', allowed: true, warning: null, group: 'main' }])
    expect(result.message).toBeNull()
  })

  it('same phone, app reinstalled, phone ID on record: reconnect, no warning', () => {
    const result = choices({ devices: [device(1, { ...samePhone, lastHeartbeat: ONLINE })] })
    expect(result.suggested).toBe(id(1))
    expect(deviceOption(result, 1)).toMatchObject({ match: 'same-phone', warning: null, group: 'main' })
  })

  it('same phone, device last seen on an older app: reconnect the one same-model device, always with W1', () => {
    const online = choices({ devices: [device(1, { lastHeartbeat: ONLINE })] })
    expect(online.suggested).toBe(id(1))
    expect(deviceOption(online, 1)?.warning).toEqual({ code: 'W1', text: w1Text(ONLINE, NOW) })

    const offline = choices({ devices: [device(1)] })
    expect(offline.suggested).toBe(id(1))
    expect(deviceOption(offline, 1)?.warning).toEqual({ code: 'W1', text: w1Text(OFFLINE, NOW) })
  })

  it('third phone of a model, the other two have phone IDs: new device, W2 on both', () => {
    const result = choices({
      devices: [
        device(1, { phoneId: 'P2', phoneSigner: 'S1', hasSignInKey: true }),
        device(2, { phoneId: 'P3', phoneSigner: 'S1' }),
      ],
    })
    expect(result.suggested).toBe('new')
    expect(deviceOption(result, 1)).toMatchObject({
      match: 'other',
      group: 'main',
      warning: { code: 'W2', text: TEXTS.W2SignIn },
    })
    expect(deviceOption(result, 2)?.warning).toEqual({ code: 'W2', text: TEXTS.W2HandMade })
  })

  it('several same-model devices without phone IDs: nothing suggested, W1 per online row', () => {
    const result = choices({ devices: [device(1, { lastHeartbeat: ONLINE }), device(2)] })
    expect(result.suggested).toBeNull()
    expect(deviceOption(result, 1)?.warning?.code).toBe('W1')
    expect(deviceOption(result, 2)?.warning).toBeNull()
    expect(deviceOption(result, 1)?.group).toBe('main')
    expect(deviceOption(result, 2)?.group).toBe('main')
  })

  it('a model the account does not have: new device, other devices in the replace group', () => {
    const result = choices({ devices: [device(1, { brand: 'samsung', model: 'SM-A346E' })] })
    expect(result.suggested).toBe('new')
    expect(deviceOption(result, 1)).toMatchObject({ group: 'replace', warning: null })
    expect(result.options.map((option) => option.type)).toEqual(['new', 'reconnect'])
  })

  it('device limit reached, a reconnect is possible: the reconnect, M2 on new', () => {
    const result = choices({ devices: [device(1, samePhone)], limit: 1 })
    expect(result.suggested).toBe(id(1))
    expect(newOption(result)).toEqual({
      type: 'new',
      allowed: false,
      warning: { code: 'M2', text: m2Text(1) },
      group: 'main',
    })
    expect(result.deviceLimit).toEqual({ limit: 1, active: 1, reached: true })
  })

  it('device limit reached, free plan, replacement phone of another model: nothing suggested, M2', () => {
    const result = choices({ devices: [device(1, { model: 'Pixel 6' })], limit: 1 })
    expect(result.suggested).toBeNull()
    expect(newOption(result)?.allowed).toBe(false)
    expect(deviceOption(result, 1)).toMatchObject({ group: 'replace', allowed: true })
  })

  it('computer on another network and a reconnect was due: nothing selected, same phone first, W1 on unknown', () => {
    const result = choices({
      devices: [device(2, { model: 'Pixel 6' }), device(1, samePhone)],
      strongSameNetwork: false,
    })
    expect(result.suggested).toBeNull()
    expect(result.message).toBe(TEXTS.differentNetwork)
    expect(result.options[0]).toMatchObject({ deviceId: id(1), match: 'same-phone', warning: null })
    expect(deviceOption(result, 2)?.warning).toEqual({ code: 'W1', text: w1Text(OFFLINE, NOW) })
  })

  it('computer on another network and a new device was due: new stays, W1 on unknown devices', () => {
    const result = choices({
      devices: [device(1, { model: 'Pixel 6', lastHeartbeat: undefined })],
      strongSameNetwork: false,
    })
    expect(result.suggested).toBe('new')
    expect(result.message).toBeNull()
    expect(deviceOption(result, 1)?.warning).toEqual({ code: 'W1', text: w1Text(undefined, NOW) })
  })
})

describe('the request names a Device ID', () => {
  it('same phone in this account: reconnect-only with only that device', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1, samePhone), device(2)],
    })
    expect(result.mode).toBe('reconnect-only')
    expect(result.suggested).toBe(id(1))
    expect(result.options).toHaveLength(1)
    expect(result.options[0]).toMatchObject({ deviceId: id(1), allowed: true })
  })

  it('reconnect-only on another network: the one device, not selected', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1, samePhone)],
      strongSameNetwork: false,
    })
    expect(result.mode).toBe('reconnect-only')
    expect(result.suggested).toBeNull()
    expect(result.message).toBe(TEXTS.differentNetwork)
    expect(result.options).toHaveLength(1)
  })

  it('reconnect-only keeps a turned off device choosable at the limit', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1, { ...samePhone, enabled: false }), device(2)],
      limit: 1,
    })
    expect(result.options[0]).toMatchObject({ allowed: true, enabled: false })
  })

  it('unknown device of the same brand and model in this account: the only candidate, with W1', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1), device(2)],
    })
    expect(result.mode).toBe('choose')
    expect(result.suggested).toBe(id(1))
    expect(deviceOption(result, 1)).toMatchObject({ group: 'main', warning: { code: 'W1' } })
    expect(deviceOption(result, 2)?.group).toBe('replace')
  })

  it('unknown device of another model in this account: listed first, not suggested', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1, { model: 'Pixel 6' }), device(2)],
    })
    expect(result.mode).toBe('choose')
    expect(result.suggested).toBeNull()
    expect(result.options[0]).toMatchObject({ deviceId: id(1), group: 'main' })
    expect(deviceOption(result, 2)?.group).toBe('main')
  })

  it('a Device ID alone never gives the one-tap mode', () => {
    const result = choices({
      request: { ...request, phoneId: undefined, requestDeviceId: id(1) },
      devices: [device(1)],
    })
    expect(result.mode).toBe('choose')
  })

  it('another phone in this account: as if no Device ID was sent, with W2', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(1) },
      devices: [device(1, { phoneId: 'P9', phoneSigner: 'S1' })],
    })
    expect(result.mode).toBe('choose')
    expect(result.suggested).toBe('new')
    expect(deviceOption(result, 1)?.warning?.code).toBe('W2')
  })

  it('the same phone in another account: blocked with M1', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(9) },
      devices: [device(1)],
      otherAccountDevice: device(9, samePhone),
    })
    expect(result).toMatchObject({ mode: 'blocked', suggested: null, message: TEXTS.M1, options: [] })
  })

  it('a device of another account without a phone ID match is ignored', () => {
    const result = choices({
      request: { ...request, requestDeviceId: id(9) },
      devices: [],
      otherAccountDevice: device(9),
    })
    expect(result.mode).toBe('choose')
    expect(result.suggested).toBe('new')
  })

  it('a deleted device is ignored', () => {
    const result = choices({ request: { ...request, requestDeviceId: id(9) } })
    expect(result).toMatchObject({ mode: 'choose', suggested: 'new' })
  })
})

describe('other rules', () => {
  it('of several same-phone devices the newest heartbeat is suggested', () => {
    const result = choices({
      devices: [device(1, samePhone), device(2, { ...samePhone, lastHeartbeat: ONLINE })],
    })
    expect(result.suggested).toBe(id(2))
  })

  it('other phones of another model sit in the replace group', () => {
    const result = choices({
      devices: [device(1, { phoneId: 'P2', phoneSigner: 'S1', model: 'Pixel 6' })],
    })
    expect(deviceOption(result, 1)).toMatchObject({ group: 'replace', warning: { code: 'W2' } })
  })

  it('a disabled device at the limit cannot be chosen or suggested', () => {
    const result = choices({
      devices: [device(1, { ...samePhone, enabled: false }), device(2, { model: 'Pixel 6' })],
      limit: 1,
    })
    expect(deviceOption(result, 1)?.allowed).toBe(false)
    expect(result.suggested).toBeNull()
  })

  it('an account over its limit can still choose an enabled device', () => {
    const result = choices({ devices: [device(1), device(2, { model: 'Pixel 6' })], limit: 1 })
    expect(deviceOption(result, 1)?.allowed).toBe(true)
    expect(deviceOption(result, 2)?.allowed).toBe(true)
  })

  it('the default name gets a number when the name is taken', () => {
    expect(defaultDeviceName('Google', 'Pixel 8', [])).toBe('Google Pixel 8')
    expect(
      defaultDeviceName('Google', 'Pixel 8', [{ name: 'google pixel 8' }, { name: 'Google Pixel 8 2' }]),
    ).toBe('Google Pixel 8 3')
    expect(defaultDeviceName('x'.repeat(60), 'y'.repeat(60), []).length).toBeLessThanOrEqual(60)
  })
})

describe('another network in mode choose', () => {
  const devices = [device(1, { lastHeartbeat: OFFLINE }), device(2, { model: 'Pixel 6' })]

  it('on a strong match keeps the suggestion, with W1 only on the suggested unknown device', () => {
    const result = choices({ devices })
    expect(result.suggested).toBe(id(1))
    expect(deviceOption(result, 1)?.warning?.code).toBe('W1')
    expect(deviceOption(result, 2)?.warning).toBeNull()
  })

  it('removes the reconnect, sets the message and warns on every unknown device', () => {
    const result = choices({ devices, strongSameNetwork: false })
    expect(result.suggested).toBeNull()
    expect(result.message).toBe(TEXTS.differentNetwork)
    expect(deviceOption(result, 1)?.warning?.code).toBe('W1')
    expect(deviceOption(result, 2)?.warning?.code).toBe('W1')
  })
})

describe('checkChoice', () => {
  it('accepts an allowed choice and names the reason for a refused one', () => {
    const result = choices({ devices: [device(1, samePhone)], limit: 1 })
    expect(checkChoice(result, { action: 'reconnect', deviceId: id(1) })).toMatchObject({
      ok: true,
      action: 'reconnect',
    })
    expect(checkChoice(result, { action: 'new' })).toEqual({ ok: false, reason: 'limit' })
    expect(checkChoice(result, { action: 'reconnect', deviceId: id(7) })).toEqual({
      ok: false,
      reason: 'choice',
    })
  })

  it('refuses new in mode reconnect-only and everything in mode blocked', () => {
    const only = choices({ request: { ...request, requestDeviceId: id(1) }, devices: [device(1, samePhone)] })
    expect(checkChoice(only, { action: 'new' })).toEqual({ ok: false, reason: 'choice' })
    const blocked = choices({
      request: { ...request, requestDeviceId: id(9) },
      otherAccountDevice: device(9, samePhone),
    })
    expect(checkChoice(blocked, { action: 'new' })).toEqual({ ok: false, reason: 'choice' })
  })

  it('refuses a disabled device at the limit as a limit case', () => {
    const result = choices({ devices: [device(1, { enabled: false }), device(2)], limit: 1 })
    expect(checkChoice(result, { action: 'reconnect', deviceId: id(1) })).toEqual({
      ok: false,
      reason: 'limit',
    })
  })
})

describe('sameNetwork', () => {
  const facts = (ip: string | undefined, asn?: number, country?: string) =>
    networkFacts(ip, asn, country)

  it('compares IPv4 addresses whole', () => {
    expect(sameNetwork(facts('203.0.113.5'), facts('203.0.113.5'))).toBe(true)
    expect(sameNetwork(facts('203.0.113.5'), facts('203.0.113.6'))).toBe(false)
  })

  it('compares IPv6 addresses by their first 64 bits', () => {
    expect(sameNetwork(facts('2001:db8:1:2::1'), facts('2001:db8:1:2:ffff::9'))).toBe(true)
    expect(sameNetwork(facts('2001:db8:1:2::1'), facts('2001:db8:1:3::1'))).toBe(false)
  })

  it('counts only the same kind and address as a strong match', () => {
    expect(strongSameNetwork(facts('203.0.113.5'), facts('203.0.113.5'))).toBe(true)
    expect(strongSameNetwork(facts('2001:db8:1:2::1'), facts('2001:db8:1:2::9'))).toBe(true)
    expect(
      strongSameNetwork(facts('203.0.113.5', 64500, 'CA'), facts('2001:db8::1', 64500, 'CA')),
    ).toBe(false)
    expect(strongSameNetwork(facts('203.0.113.5'), facts('203.0.113.6'))).toBe(false)
    expect(strongSameNetwork(facts(undefined), facts(undefined))).toBe(false)
  })

  it('compares mixed kinds by network number and country', () => {
    expect(sameNetwork(facts('203.0.113.5', 64500, 'CA'), facts('2001:db8::1', 64500, 'CA'))).toBe(true)
    expect(sameNetwork(facts('203.0.113.5', 64500, 'CA'), facts('2001:db8::1', 64501, 'CA'))).toBe(false)
    expect(sameNetwork(facts('203.0.113.5', 64500, 'CA'), facts('2001:db8::1', 64500, 'US'))).toBe(false)
    expect(sameNetwork(facts('203.0.113.5'), facts('2001:db8::1'))).toBe(false)
  })

  it('is false when an address is missing', () => {
    expect(sameNetwork(facts(undefined), facts(undefined))).toBe(false)
    expect(sameNetwork(facts('203.0.113.5'), facts(undefined))).toBe(false)
  })

  it('stores no raw address', () => {
    const stored = facts('203.0.113.5', 64500, 'CA')
    expect(JSON.stringify(stored)).not.toContain('203.0.113')
    expect(stored).toMatchObject({ netKind: 'v4', asn: 64500, country: 'CA' })
  })
})

describe('texts', () => {
  it('names the place approximately', () => {
    expect(placeLabel('CA')).toBe('Canada (approximate)')
    expect(placeLabel(undefined)).toBe('Unknown place')
  })

  it('says that the same network could not be confirmed', () => {
    expect(TEXTS.differentNetwork).toBe(
      'The server could not confirm that this phone and this browser are on the same network, so no device is selected. Choose a device only if this phone used it before.',
    )
  })

  it('writes the device limit in singular and plural', () => {
    expect(m2Text(1)).toContain('allows 1 active device.')
    expect(m2Text(3)).toContain('allows 3 active devices.')
  })

  it('writes the last activity in plain words', () => {
    expect(relativeTime(minutesAgo(0.5), NOW)).toBe('just now')
    expect(relativeTime(minutesAgo(1), NOW)).toBe('1 minute ago')
    expect(relativeTime(minutesAgo(180), NOW)).toBe('3 hours ago')
    expect(relativeTime(minutesAgo(3 * 24 * 60), NOW)).toBe('3 days ago')
    expect(w1Text(undefined, NOW)).toMatch(/^Not seen yet\./)
  })
})
