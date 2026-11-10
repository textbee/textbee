// The SIM part of a send: what the caller asked for, what is stored on the
// message, and what the phone receives in the push and the recovery poll.

/** First app build that reads simSlotIndex and resolves the slot itself. */
export const SIM_SLOT_MIN_APP_VERSION_CODE = 22
/** First released app build (2.7.0) that sends from a requested simSubscriptionId. */
export const SIM_SUBSCRIPTION_MIN_APP_VERSION_CODE = 16
export const MAX_SIM_SLOT_INDEX = 7

export const SIM_SLOT_INDEX_INVALID_ERROR =
  'simSlotIndex must be a whole number from 0 to 7. 0 is SIM 1, 1 is SIM 2.'
export const SIM_SLOT_UNSUPPORTED_ERROR =
  "This device's textbee app cannot choose a SIM. Update the app, or send without simSlotIndex."
export const simSlotNotReportedError = (slot: number) =>
  `The phone's last report shows no SIM ${slot + 1} (simSlotIndex ${slot}). Open the textbee app to refresh, or update the app.`

export type SimRequestDevice = {
  appVersionCode?: number
  appVersionInfo?: { versionCode?: number }
  simInfo?: {
    sims?: Array<{ subscriptionId?: unknown; simSlotIndex?: unknown }>
  }
}

export type SimRequestInput = {
  simSlotIndex?: unknown
  simSubscriptionId?: number
}

/** The SIM fields of a stored message. */
export type StoredSimRequest = {
  simSubscriptionId?: number
  simSlotIndex?: number
  metadata?: { simMappedSubscriptionId?: number; [key: string]: unknown } | null
}

export type SimPayload = {
  simSlotIndex?: number
  simSubscriptionId?: number
}

export type SimRequest =
  | {
      ok: true
      /** Top-level fields for the SMS document. */
      stored: { simSubscriptionId?: number; simSlotIndex?: number }
      /** Keys to merge into the SMS metadata. */
      metadata: { simMappedSubscriptionId?: number }
      payload: SimPayload
    }
  | { ok: false; error: string }

const isPresent = (value: unknown) => value !== undefined && value !== null

export const isValidSimSlotIndex = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SIM_SLOT_INDEX

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

// Heartbeats write appVersionInfo; registration writes appVersionCode. After a
// downgrade the two disagree, and the lower one is the safe guess.
function appVersionCodeOf(device: SimRequestDevice | null | undefined) {
  const fromHeartbeat = device?.appVersionInfo?.versionCode
  const fromRegistration = device?.appVersionCode
  if (isNumber(fromHeartbeat) && isNumber(fromRegistration)) {
    return Math.min(fromHeartbeat, fromRegistration)
  }
  if (isNumber(fromHeartbeat)) return fromHeartbeat
  if (isNumber(fromRegistration)) return fromRegistration
  return undefined
}

/** The SIM fields of the push, rebuilt from what is stored on the message. */
export function simPayloadFor(sms: StoredSimRequest): SimPayload {
  if (isPresent(sms.simSlotIndex)) {
    const mapped = sms.metadata?.simMappedSubscriptionId
    return {
      simSlotIndex: sms.simSlotIndex,
      ...(isPresent(mapped) && { simSubscriptionId: mapped }),
    }
  }
  return sms.simSubscriptionId !== undefined
    ? { simSubscriptionId: sms.simSubscriptionId }
    : {}
}

/**
 * Resolves the requested SIM against the device's last SIM report. A slot wins
 * over a subscription id. Builds that do not read the slot get the mapped
 * subscription id, and a slot they cannot be sent to is refused, so a slot
 * request never goes out from another SIM.
 */
export function resolveSimRequest(
  device: SimRequestDevice | null | undefined,
  input: SimRequestInput,
): SimRequest {
  if (!isPresent(input.simSlotIndex)) {
    const stored =
      input.simSubscriptionId !== undefined
        ? { simSubscriptionId: input.simSubscriptionId }
        : {}
    return { ok: true, stored, metadata: {}, payload: simPayloadFor(stored) }
  }

  const slot = input.simSlotIndex
  if (!isValidSimSlotIndex(slot)) {
    return { ok: false, error: SIM_SLOT_INDEX_INVALID_ERROR }
  }

  const sims = Array.isArray(device?.simInfo?.sims) ? device.simInfo.sims : []
  const match = sims.find(
    (sim) =>
      sim?.simSlotIndex === slot &&
      typeof sim.subscriptionId === 'number' &&
      Number.isInteger(sim.subscriptionId),
  )
  const mapped = match?.subscriptionId as number | undefined

  const versionCode = appVersionCodeOf(device)
  const readsSlot =
    versionCode !== undefined && versionCode >= SIM_SLOT_MIN_APP_VERSION_CODE

  if (!readsSlot) {
    const readsSubscriptionId =
      versionCode !== undefined &&
      versionCode >= SIM_SUBSCRIPTION_MIN_APP_VERSION_CODE
    if (!readsSubscriptionId || sims.length === 0) {
      return { ok: false, error: SIM_SLOT_UNSUPPORTED_ERROR }
    }
    if (mapped === undefined) {
      return { ok: false, error: simSlotNotReportedError(slot) }
    }
  }

  const stored = { simSlotIndex: slot }
  const metadata =
    mapped !== undefined ? { simMappedSubscriptionId: mapped } : {}
  return {
    ok: true,
    stored,
    metadata,
    payload: simPayloadFor({ ...stored, metadata }),
  }
}
