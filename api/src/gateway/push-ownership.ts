import { randomUUID } from 'crypto'
import { RECOVERY_MIN_VERSION_CODE, deviceConfigFor } from './device-config'

// Who may hand a message to the phone, and when. A queue run takes its rows
// before it pushes, so a run that repeats pushes nothing. A row whose push was
// rejected stays open for the phone to claim.

// versionCode of the first build that claims through the new endpoint
export const PULL_MIN_VERSION_CODE = 22

// A push to a claiming build expires before a claim may take the row
export const PULL_PUSH_TTL_MS = 30 * 60 * 1000
export const PUSH_LEASE_MS = 35 * 60 * 1000
export const MIN_CLAIM_LEASE_MS = 30 * 60 * 1000
export const CLAIM_LEASE_MARGIN_MS = 10 * 60 * 1000

// A device silent for longer is treated as one that cannot claim
export const FRESH_HEARTBEAT_MS = 24 * 60 * 60 * 1000

// handedTo value for a push to a phone that reported no install id
export const HANDED_BY_PUSH = 'fcm'

function envOn(key: string): boolean {
  const raw = process.env[key]?.trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

export function pushOwnershipEnabled(): boolean {
  return envOn('RECOVERABLE_PUSH_FAILURES_ENABLED')
}

export function finalFailureEnabled(): boolean {
  return envOn('SMS_FINAL_FAILURE_ENABLED')
}

export function newRunToken(): string {
  return randomUUID()
}

type OwnershipDevice = {
  appVersionCode?: number
  appVersionInfo?: { versionCode?: number }
  lastHeartbeat?: Date
  installId?: string
  configOverrides?: Record<string, unknown> | null
}

export function deviceVersionCode(device: OwnershipDevice | null | undefined): number {
  return device?.appVersionInfo?.versionCode ?? device?.appVersionCode ?? 0
}

function heartbeatIsFresh(device: OwnershipDevice | null | undefined, now: Date): boolean {
  const last = device?.lastHeartbeat ? new Date(device.lastHeartbeat).getTime() : NaN
  return Number.isFinite(last) && now.getTime() - last < FRESH_HEARTBEAT_MS
}

// The device can come and get a message whose push did not arrive
export function deviceCanClaim(
  device: OwnershipDevice | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!device || deviceVersionCode(device) < RECOVERY_MIN_VERSION_CODE) return false
  if (!heartbeatIsFresh(device, now)) return false
  const config = deviceConfigFor(device as any)
  return config.recoveryPollEnabled || config.pullEnabled
}

// The device claims through the new endpoint, so its pushes get a short life
export function deviceUsesPull(
  device: OwnershipDevice | null | undefined,
  now: Date = new Date(),
): boolean {
  return (
    !!device &&
    !!device.installId &&
    deviceVersionCode(device) >= PULL_MIN_VERSION_CODE &&
    heartbeatIsFresh(device, now) &&
    deviceConfigFor(device as any).pullEnabled
  )
}

// Push errors that prove the push service did not accept the message. Server
// errors, timeouts and connection errors prove nothing: the push may have landed.
const REJECTED_PUSH_CODES = new Set([
  'messaging/invalid-argument',
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
  'messaging/mismatched-credential',
  'messaging/authentication-error',
  'messaging/third-party-auth-error',
  'messaging/message-rate-exceeded',
  'messaging/invalid-payload',
  'messaging/payload-size-limit-exceeded',
  'messaging/invalid-recipient',
  'app/invalid-credential',
])

export function pushWasRejected(error: { code?: unknown } | null | undefined): boolean {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : ''
  return REJECTED_PUSH_CODES.has(code)
}

export function claimLeaseMs(limit: number, sendDelaySeconds: number): number {
  const sendTimeMs = Math.max(0, limit) * Math.max(0, sendDelaySeconds) * 1000
  return Math.max(MIN_CLAIM_LEASE_MS, sendTimeMs + CLAIM_LEASE_MARGIN_MS)
}

// How long the app waits before its next claim. Raise it to slow the fleet down.
export function claimRetryAfterSeconds(): number {
  const parsed = Number.parseInt(process.env.CLAIM_RETRY_AFTER_SECONDS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}
