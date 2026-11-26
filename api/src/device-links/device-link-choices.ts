// How the server builds the choices of the link page from the account's
// devices. Pure functions: the service loads the records and calls these.
import { isIP } from 'net'
import { canonicalAddress, rawAddress } from '../common/client-address'
import { serverHash } from './device-link-input'
import type { DeviceLinkMode } from './schemas/device-link.schema'

const MINUTE_MS = 60 * 1000
const MIN_ONLINE_WINDOW_MS = 65 * MINUTE_MS
const DEFAULT_INTERVAL_MINUTES = 30
const DEFAULT_NAME_BASE_MAX = 56

export const TEXTS = {
  M1: 'This phone is connected to another textbee account. Log in to that account. To use this phone with a new account, open the textbee app, go to Settings and tap Disconnect Device first.',
  W2SignIn:
    'Another phone uses this device now. If you continue, that phone stops sending and receiving SMS.',
  W2HandMade:
    'Another phone uses this device now. If you continue, both phones share it, and a message can go to either phone. Disconnect the other phone first.',
  differentNetwork:
    'This phone and this browser are on different networks, so no device is selected. Choose a device only if this phone used it before.',
}

export function m2Text(limit: number): string {
  return limit === 1
    ? 'Your plan allows 1 active device. To connect this phone, choose a device below. This phone takes its place.'
    : `Your plan allows ${limit} active devices. To connect this phone, choose a device below. This phone takes its place.`
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

export function relativeTime(date: Date | undefined | null, now: Date): string | null {
  const at = date ? new Date(date).getTime() : NaN
  if (!Number.isFinite(at)) return null
  const diff = Math.max(0, now.getTime() - at)
  if (diff < MINUTE_MS) return 'just now'
  if (diff < 60 * MINUTE_MS) return plural(Math.floor(diff / MINUTE_MS), 'minute')
  if (diff < 24 * 60 * MINUTE_MS) return plural(Math.floor(diff / (60 * MINUTE_MS)), 'hour')
  return plural(Math.floor(diff / (24 * 60 * MINUTE_MS)), 'day')
}

export function w1Text(lastSeen: Date | undefined | null, now: Date): string {
  const when = relativeTime(lastSeen, now)
  const lead = when ? `Last active ${when}.` : 'Not seen yet.'
  return `${lead} Choose this only if this is the same phone. If another phone still uses this device, add this phone as a new device.`
}

export type ChoiceDevice = {
  _id: { toString(): string }
  name?: string
  brand?: string
  model?: string
  enabled?: boolean
  lastHeartbeat?: Date
  heartbeatIntervalMinutes?: number
  phoneId?: string
  phoneSigner?: string
  // A live sign-in key is tied to this device
  hasSignInKey?: boolean
}

export type ChoiceRequest = {
  brand: string
  model: string
  phoneId?: string
  phoneSigner?: string
  requestDeviceId?: string
}

export type Match = 'same-phone' | 'other' | 'unknown'

export type Warning = { code: 'W1' | 'W2' | 'M2'; text: string }

export type DeviceOption = {
  type: 'reconnect'
  deviceId: string
  name: string | null
  brand: string | null
  model: string | null
  lastSeenAt: string | null
  enabled: boolean
  match: Match
  warning: Warning | null
  allowed: boolean
  group: 'main' | 'replace'
}

export type NewOption = {
  type: 'new'
  allowed: boolean
  warning: Warning | null
  group: 'main'
}

export type DeviceLimitInfo = { limit: number | null; active: number; reached: boolean }

export type Choices = {
  mode: DeviceLinkMode
  suggested: string | null
  message: string | null
  defaultName: string
  deviceLimit: DeviceLimitInfo
  options: Array<DeviceOption | NewOption>
}

export type ChoiceInput = {
  request: ChoiceRequest
  devices: ChoiceDevice[]
  // The device named by requestDeviceId when it is in another account
  otherAccountDevice?: ChoiceDevice | null
  // null: no limit
  limit: number | null
  activeCount: number
  sameNetwork: boolean
  now: Date
}

const same = (a: string | undefined, b: string | undefined) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.trim().toLowerCase() === b.trim().toLowerCase()

export function classify(device: ChoiceDevice, request: ChoiceRequest): Match {
  if (!device.phoneId || !device.phoneSigner) return 'unknown'
  if (!request.phoneSigner || request.phoneSigner !== device.phoneSigner) return 'unknown'
  if (request.phoneId && request.phoneId === device.phoneId) {
    // Some cloned phones share one id, so the model must match too
    return same(device.brand, request.brand) && same(device.model, request.model)
      ? 'same-phone'
      : 'other'
  }
  return 'other'
}

// The dashboard's rule: the larger of 65 minutes and two intervals plus 5 minutes
export function isOnline(device: ChoiceDevice, now: Date): boolean {
  const last = device.lastHeartbeat ? new Date(device.lastHeartbeat).getTime() : NaN
  if (!Number.isFinite(last)) return false
  const interval =
    device.heartbeatIntervalMinutes && device.heartbeatIntervalMinutes > 0
      ? device.heartbeatIntervalMinutes
      : DEFAULT_INTERVAL_MINUTES
  const window = Math.max(MIN_ONLINE_WINDOW_MS, (2 * interval + 5) * MINUTE_MS)
  return now.getTime() - last <= window
}

export function defaultDeviceName(
  brand: string,
  model: string,
  devices: Array<{ name?: string }>,
): string {
  const base = `${brand.trim()} ${model.trim()}`.trim().slice(0, DEFAULT_NAME_BASE_MAX).trim()
  const taken = new Set(
    devices
      .map((device) => device.name?.trim().toLowerCase())
      .filter((name): name is string => !!name),
  )
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

const byNewestHeartbeat = (a: ChoiceDevice, b: ChoiceDevice) =>
  (b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0) -
  (a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0)

const idOf = (device: ChoiceDevice) => device._id.toString()

export function buildChoices(input: ChoiceInput): Choices {
  const { request, devices, limit, activeCount, sameNetwork, now } = input
  const limitReached = limit !== null && activeCount >= limit
  const deviceLimit: DeviceLimitInfo = { limit, active: activeCount, reached: limitReached }
  const defaultName = defaultDeviceName(request.brand, request.model, devices)
  const match = new Map(devices.map((device) => [idOf(device), classify(device, request)]))

  const warningFor = (device: ChoiceDevice): Warning | null => {
    const kind = match.get(idOf(device))
    if (kind === 'other') {
      return { code: 'W2', text: device.hasSignInKey ? TEXTS.W2SignIn : TEXTS.W2HandMade }
    }
    if (kind === 'unknown' && (!sameNetwork || isOnline(device, now))) {
      return { code: 'W1', text: w1Text(device.lastHeartbeat, now) }
    }
    return null
  }
  // A disabled device can be chosen only while enabling it stays within the limit
  const allowedDevice = (device: ChoiceDevice) => device.enabled === true || !limitReached
  const deviceOption = (
    device: ChoiceDevice,
    group: 'main' | 'replace',
    allowed = allowedDevice(device),
  ): DeviceOption => ({
    type: 'reconnect',
    deviceId: idOf(device),
    name: device.name ?? null,
    brand: device.brand ?? null,
    model: device.model ?? null,
    lastSeenAt: device.lastHeartbeat ? new Date(device.lastHeartbeat).toISOString() : null,
    enabled: device.enabled === true,
    match: match.get(idOf(device)) ?? 'unknown',
    warning: warningFor(device),
    allowed,
    group,
  })

  // Rule 1: the phone names its Device ID
  let onlyCandidate: ChoiceDevice | undefined
  if (request.requestDeviceId) {
    const own = devices.find((device) => idOf(device) === request.requestDeviceId)
    const ownMatch = own ? match.get(idOf(own)) : undefined
    if (own && ownMatch === 'same-phone') {
      // The device keeps its enabled state, so the limit does not apply
      const option = deviceOption(own, 'main', true)
      return {
        mode: 'reconnect-only',
        suggested: sameNetwork ? idOf(own) : null,
        message: sameNetwork ? null : TEXTS.differentNetwork,
        defaultName,
        deviceLimit,
        options: [option],
      }
    }
    if (own && ownMatch === 'unknown') onlyCandidate = own
    if (
      !own &&
      input.otherAccountDevice &&
      classify(input.otherAccountDevice, request) === 'same-phone'
    ) {
      return {
        mode: 'blocked',
        suggested: null,
        message: TEXTS.M1,
        defaultName,
        deviceLimit,
        options: [],
      }
    }
  }

  const samePhones = devices
    .filter((device) => match.get(idOf(device)) === 'same-phone')
    .sort(byNewestHeartbeat)
  const candidates = onlyCandidate
    ? [onlyCandidate]
    : devices
        .filter(
          (device) =>
            match.get(idOf(device)) === 'unknown' &&
            same(device.brand, request.brand) &&
            same(device.model, request.model),
        )
        .sort(byNewestHeartbeat)

  let suggested: string | null
  if (!onlyCandidate && samePhones.length > 0) {
    // Rule 2: the reinstall case
    suggested = idOf(samePhones[0])
  } else if (candidates.length === 0) {
    suggested = 'new'
  } else if (candidates.length === 1) {
    suggested = idOf(candidates[0])
  } else {
    suggested = null
  }

  // Rule 4: other phones with the same model stay in the main list
  const otherSameModel = devices
    .filter(
      (device) =>
        match.get(idOf(device)) === 'other' &&
        same(device.brand, request.brand) &&
        same(device.model, request.model),
    )
    .sort(byNewestHeartbeat)

  const mainIds = new Set<string>()
  const main: ChoiceDevice[] = []
  for (const device of [...samePhones, ...candidates, ...otherSameModel]) {
    if (mainIds.has(idOf(device))) continue
    mainIds.add(idOf(device))
    main.push(device)
  }
  const rest = devices.filter((device) => !mainIds.has(idOf(device))).sort(byNewestHeartbeat)

  // Rule 6: adding is always listed, and off at the limit
  const newOption: NewOption = {
    type: 'new',
    allowed: !limitReached,
    warning: limitReached ? { code: 'M2', text: m2Text(limit as number) } : null,
    group: 'main',
  }

  const options: Array<DeviceOption | NewOption> = [
    ...main.map((device) => deviceOption(device, 'main')),
    newOption,
    ...rest.map((device) => deviceOption(device, 'replace')),
  ]

  if (suggested === 'new' && !newOption.allowed) suggested = null
  if (suggested && suggested !== 'new') {
    const option = options.find(
      (entry): entry is DeviceOption => entry.type === 'reconnect' && entry.deviceId === suggested,
    )
    if (!option?.allowed) suggested = null
  }

  // Rule 8: on another network no reconnect is selected
  let message: string | null = null
  if (!sameNetwork && suggested && suggested !== 'new') {
    suggested = null
    message = TEXTS.differentNetwork
  }

  return { mode: 'choose', suggested, message, defaultName, deviceLimit, options }
}

export type ChosenOption =
  | { ok: true; action: 'new' }
  | { ok: true; action: 'reconnect'; option: DeviceOption }
  | { ok: false; reason: 'choice' | 'limit' }

/** Checks a choice of the page against a fresh list. */
export function checkChoice(
  choices: Choices,
  choice: { action: 'new' } | { action: 'reconnect'; deviceId: string },
): ChosenOption {
  if (choices.mode === 'blocked') return { ok: false, reason: 'choice' }
  if (choice.action === 'new') {
    const option = choices.options.find((entry) => entry.type === 'new')
    if (!option) return { ok: false, reason: 'choice' }
    return option.allowed ? { ok: true, action: 'new' } : { ok: false, reason: 'limit' }
  }
  const option = choices.options.find(
    (entry): entry is DeviceOption =>
      entry.type === 'reconnect' && entry.deviceId === choice.deviceId,
  )
  if (!option) return { ok: false, reason: 'choice' }
  return option.allowed
    ? { ok: true, action: 'reconnect', option }
    : { ok: false, reason: 'limit' }
}

export type NetworkFacts = {
  netKind?: 'v4' | 'v6'
  netHash?: string
  asn?: number
  country?: string
}

/** The network of an address: its kind and a server hash of the address or its /64. */
export function networkFacts(
  ip: string | undefined,
  asn: number | undefined,
  country: string | undefined,
): NetworkFacts {
  const facts: NetworkFacts = {}
  const address = rawAddress(ip)
  const network = canonicalAddress(address)
  if (address && network) {
    facts.netKind = isIP(address) === 4 ? 'v4' : 'v6'
    facts.netHash = serverHash('net', network)
  }
  if (asn !== undefined) facts.asn = asn
  if (country) facts.country = country
  return facts
}

export function sameNetwork(phone: NetworkFacts, browser: NetworkFacts): boolean {
  if (phone.netKind && browser.netKind && phone.netKind === browser.netKind) {
    return !!phone.netHash && phone.netHash === browser.netHash
  }
  if (phone.netKind && browser.netKind) {
    return (
      phone.asn !== undefined &&
      phone.asn === browser.asn &&
      !!phone.country &&
      phone.country === browser.country
    )
  }
  return false
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

/** "Canada (approximate)", or "Unknown place". */
export function placeLabel(country: string | undefined): string {
  if (!country) return 'Unknown place'
  let name: string | undefined
  try {
    name = regionNames.of(country)
  } catch {
    name = undefined
  }
  return name && name !== country ? `${name} (approximate)` : 'Unknown place'
}
