// Hand checks of what a phone or the link page sends. The API has no global
// validation pipe, so every field is read here and nowhere else.
import { createHash, createHmac, randomBytes, randomInt } from 'crypto'
import { safeText } from '../gateway/app-settings'

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8
const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)
const OBJECT_ID = /^[0-9a-fA-F]{24}$/
const PACKAGE_NAME = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const LOCALE = /^[A-Za-z0-9_-]{1,35}$/
const INT32_MAX = 2147483647
const HEADER_MAX = 64
const NAME_MAX = 60

export type CreateLinkInput = {
  deviceName: string
  brand: string
  model: string
  appVersionCode: number
  manufacturer?: string
  appVersionName?: string
  osApiLevel?: number
  locale?: string
  deviceId?: string
  installerPackage?: string
  playServicesStatus?: number
  hasStoredKey?: boolean
  keyRejected?: boolean
  clientProtocol?: number
}

export type LinkHeaders = {
  installId?: string
  phoneId?: string
  phoneSigner?: string
}

export type ApproveInput =
  | { action: 'new'; name?: string; typedCode?: string; makeDefault?: true }
  | { action: 'reconnect'; deviceId: string; typedCode?: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function own(body: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined
}

function wholeNumber(value: unknown, min: number, max = INT32_MAX): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

/** 1 to 60 printable characters, trimmed, or undefined. */
export function cleanName(value: unknown): string | undefined {
  return safeText(value, NAME_MAX)
}

export function cleanObjectId(value: unknown): string | undefined {
  return typeof value === 'string' && OBJECT_ID.test(value) ? value.toLowerCase() : undefined
}

/** The create body, or null when a required field is bad. Bad optional fields are dropped. */
export function parseCreateBody(body: unknown): CreateLinkInput | null {
  if (!isPlainObject(body)) return null
  const deviceName = cleanName(own(body, 'deviceName'))
  const brand = cleanName(own(body, 'brand'))
  const model = cleanName(own(body, 'model'))
  const appVersionCode = wholeNumber(own(body, 'appVersionCode'), 1)
  if (!deviceName || !brand || !model || appVersionCode === undefined) return null

  const input: CreateLinkInput = { deviceName, brand, model, appVersionCode }
  const optional: Partial<CreateLinkInput> = {
    manufacturer: cleanName(own(body, 'manufacturer')),
    appVersionName: safeText(own(body, 'appVersionName'), 32),
    osApiLevel: wholeNumber(own(body, 'osApiLevel'), 1, 1000),
    locale: (() => {
      const value = own(body, 'locale')
      return typeof value === 'string' && LOCALE.test(value) ? value : undefined
    })(),
    deviceId: cleanObjectId(own(body, 'deviceId')),
    installerPackage: (() => {
      const value = own(body, 'installerPackage')
      return typeof value === 'string' && value.length <= 255 && PACKAGE_NAME.test(value)
        ? value
        : undefined
    })(),
    playServicesStatus: wholeNumber(own(body, 'playServicesStatus'), 0, 1000),
    hasStoredKey: typeof own(body, 'hasStoredKey') === 'boolean' ? (own(body, 'hasStoredKey') as boolean) : undefined,
    keyRejected: typeof own(body, 'keyRejected') === 'boolean' ? (own(body, 'keyRejected') as boolean) : undefined,
    clientProtocol: wholeNumber(own(body, 'clientProtocol'), 1, 1000),
  }
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (input as Record<string, unknown>)[key] = value
  }
  return input
}

function headerValue(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.length > HEADER_MAX) return undefined
  // Printable ASCII only; a header value is never shown, but it is stored
  return /^[\x21-\x7e]+$/.test(trimmed) ? trimmed : undefined
}

export function parseLinkHeaders(headers: Record<string, unknown> | undefined): LinkHeaders {
  const result: LinkHeaders = {}
  const installId = headerValue(headers?.['x-install-id'])
  const phoneId = headerValue(headers?.['x-phone-id'])
  const phoneSigner = headerValue(headers?.['x-app-signer'])
  if (installId) result.installId = installId
  if (phoneId) result.phoneId = phoneId
  if (phoneSigner) result.phoneSigner = phoneSigner
  return result
}

/** The code without hyphen in upper case, or undefined when it cannot be a code. */
export function normalizeCode(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 20) return undefined
  const code = value.replace(/-/g, '').trim().toUpperCase()
  return CODE_PATTERN.test(code) ? code : undefined
}

export function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

export function newCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

/** 32 random bytes as 43 base64url characters. */
export function newPollToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function parsePollToken(body: unknown): string | undefined {
  if (!isPlainObject(body)) return undefined
  const token = own(body, 'pollToken')
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined
}

/** The approve body, or null when it names no valid choice. */
export function parseApproveBody(body: unknown): ApproveInput | null {
  if (!isPlainObject(body)) return null
  const action = own(body, 'action')
  const rawTyped = own(body, 'typedCode')
  let typedCode: string | undefined
  if (rawTyped !== undefined && rawTyped !== null) {
    // A typed value that cannot be a code is kept as given, so it fails the match
    typedCode = typeof rawTyped === 'string' ? normalizeCode(rawTyped) ?? '' : ''
  }
  const withTyped = <T extends object>(input: T) =>
    typedCode === undefined ? input : { ...input, typedCode }
  // Optional on every action, but kept only for a new device
  const rawDefault = own(body, 'makeDefault')
  if (rawDefault !== undefined && rawDefault !== null && typeof rawDefault !== 'boolean') return null

  if (action === 'new') {
    const asDefault = rawDefault === true ? { makeDefault: true as const } : {}
    const rawName = own(body, 'name')
    if (rawName === undefined || rawName === null) {
      return withTyped({ action: 'new' as const, ...asDefault })
    }
    const name = cleanName(rawName)
    return name ? withTyped({ action: 'new' as const, name, ...asDefault }) : null
  }
  if (action === 'reconnect') {
    const deviceId = cleanObjectId(own(body, 'deviceId'))
    return deviceId ? withTyped({ action: 'reconnect' as const, deviceId }) : null
  }
  return null
}

// Secret for the server hashes of network addresses and phone ids
export function linkHashSecret(): string {
  return process.env.DEVICE_LINK_SECRET || process.env.JWT_SECRET || ''
}

export function serverHash(kind: 'net' | 'phone', value: string): string {
  return createHmac('sha256', linkHashSecret()).update(`${kind}:${value}`).digest('base64url')
}

/** The phone id and signer as a device stores them, or undefined without both or without a secret. */
export function storedPhoneId(
  headers: LinkHeaders,
): { phoneId: string; phoneSigner: string } | undefined {
  if (!headers.phoneId || !headers.phoneSigner || !linkHashSecret()) return undefined
  return { phoneId: serverHash('phone', headers.phoneId), phoneSigner: headers.phoneSigner }
}

/** The account ids in the tester list; values that are not ids are ignored. */
export function parseTesters(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set()
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => OBJECT_ID.test(entry))
      .map((entry) => entry.toLowerCase()),
  )
}

/** "j***@example.com" */
export function maskEmail(email: string | undefined): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}
