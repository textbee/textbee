// Whether an account's sending is blocked by a missing SMS permission on the
// phone. This file is mirrored outside this repository, and a Python twin runs
// the same cases from sms-permission-cases.json. Change the rule, change the
// cases in the same commit.

export const PERMISSION_DENIED = 'PERMISSION_DENIED'

export interface LastOutgoingMessage {
  status?: string
  errorCode?: string
  createdAt?: Date | string
  /** Server time of the last write, i.e. when the failure was reported. */
  updatedAt?: Date | string
  /** Phone time, so it can be skewed. */
  failedAt?: Date | string
  /** Set when the send targeted a SIM, which also needs the Phone permission. */
  simSubscriptionId?: number
}

export interface DeviceAppState {
  hasSendSmsPermission?: boolean
  hasReadPhoneStatePermission?: boolean
  /** Server time of the heartbeat that reported these. */
  lastUpdated?: Date | string
}

export interface FailingDevice {
  enabled?: boolean
  appStateInfo?: DeviceAppState
}

const time = (value: Date | string | undefined): number | undefined => {
  if (value === undefined || value === null) return undefined
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

// Server time where we have it: the heartbeat's lastUpdated is server time, and
// comparing it with the phone's own failedAt breaks on a skewed phone clock.
export const permissionFailureAt = (
  message: LastOutgoingMessage,
): number | undefined =>
  time(message.updatedAt) ?? time(message.failedAt) ?? time(message.createdAt)

/**
 * True when the most recent outgoing message failed for a missing permission,
 * its phone is still on the account, and the phone has not reported the
 * permission granted since. Undefined when the account has never sent, so it
 * is never targeted.
 */
export function needsSmsPermission(
  last: LastOutgoingMessage | null | undefined,
  device: FailingDevice | null | undefined,
): boolean | undefined {
  if (!last) return undefined
  if (last.status !== 'failed' || last.errorCode !== PERMISSION_DENIED) {
    return false
  }
  // The phone was removed or switched off, so it no longer blocks anything.
  if (!device || device.enabled === false) return false

  const appState = device.appStateInfo
  const failedAt = permissionFailureAt(last)
  const reportedAt = time(appState?.lastUpdated)
  const needsPhonePermission =
    last.simSubscriptionId !== undefined && last.simSubscriptionId !== null
  const granted =
    appState?.hasSendSmsPermission === true &&
    (!needsPhonePermission || appState?.hasReadPhoneStatePermission === true)

  if (granted && reportedAt !== undefined && failedAt !== undefined) {
    return reportedAt <= failedAt
  }
  return true
}

/** Whole hours since the blocking failure, or undefined when not blocked. */
export function hoursSincePermissionFailure(
  last: LastOutgoingMessage | null | undefined,
  device: FailingDevice | null | undefined,
  now: Date,
): number | undefined {
  if (needsSmsPermission(last, device) !== true) return undefined
  const failedAt = permissionFailureAt(last)
  if (failedAt === undefined) return undefined
  return Math.max(0, Math.floor((now.getTime() - failedAt) / 3_600_000))
}
