// The SIM the phone reports it actually used. It can differ from the
// requested simSubscriptionId, which the phone ignores when no active SIM has it.

// Android uses Integer.MAX_VALUE for "default subscription", never a real SIM
const MAX_SUBSCRIPTION_ID = 2147483646
const MAX_SLOT_INDEX = 7
const MAX_NAME_LENGTH = 64

export const SIM_SELECTIONS = [
  'requested',
  'requested_invalid_fallback',
  'requested_slot',
  'requested_slot_empty',
  'app_preferred',
  'system_default',
] as const

export type SimSelection = (typeof SIM_SELECTIONS)[number]

export type SimUsed = {
  subscriptionId?: number
  slotIndex?: number
  carrierName?: string
  displayName?: string
  countryIso?: string
  mcc?: string
  mnc?: string
}

// The request shape: a nested simUsed object, or the older flat fields
export type SimUsedReport = {
  simUsed?: unknown
  simSubscriptionId?: unknown
  simSlotIndex?: unknown
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  return undefined
}

function toName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.trim()
  return name ? name.slice(0, MAX_NAME_LENGTH) : undefined
}

function toCountryIso(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const iso = value.trim().toLowerCase()
  return /^[a-z]{2}$/.test(iso) ? iso : undefined
}

function toNetworkCode(value: unknown): string | undefined {
  const code = typeof value === 'number' ? String(value) : value
  if (typeof code !== 'string') return undefined
  const digits = code.trim()
  return /^\d{2,3}$/.test(digits) ? digits : undefined
}

/** The reported SIM, or undefined when neither part is a plausible value. */
export function resolveSimUsed(
  subscriptionId: unknown,
  slotIndex: unknown,
): SimUsed | undefined {
  const id = toInteger(subscriptionId)
  const slot = toInteger(slotIndex)
  const simUsed: SimUsed = {}
  // 0 is a valid id (MIN_SUBSCRIPTION_ID_VALUE), so the app must omit unknowns
  if (id !== undefined && id >= 0 && id <= MAX_SUBSCRIPTION_ID) {
    simUsed.subscriptionId = id
  }
  if (slot !== undefined && slot >= 0 && slot <= MAX_SLOT_INDEX) {
    simUsed.slotIndex = slot
  }
  return Object.keys(simUsed).length > 0 ? simUsed : undefined
}

/**
 * The SIM from a device report. The nested simUsed object wins over the flat
 * simSubscriptionId and simSlotIndex fields. Bad values are dropped one by
 * one, never rejected, so a partial report still stores what is sound.
 */
export function resolveSimUsedReport(
  report: SimUsedReport | null | undefined,
): SimUsed | undefined {
  if (!report || typeof report !== 'object') return undefined
  const nested =
    report.simUsed && typeof report.simUsed === 'object'
      ? (report.simUsed as Record<string, unknown>)
      : {}
  const ids = resolveSimUsed(
    nested.subscriptionId ?? report.simSubscriptionId,
    nested.slotIndex ?? report.simSlotIndex,
  )
  const simUsed: SimUsed = { ...ids }
  const carrierName = toName(nested.carrierName)
  if (carrierName) simUsed.carrierName = carrierName
  const displayName = toName(nested.displayName)
  if (displayName) simUsed.displayName = displayName
  const countryIso = toCountryIso(nested.countryIso)
  if (countryIso) simUsed.countryIso = countryIso
  const mcc = toNetworkCode(nested.mcc)
  if (mcc) simUsed.mcc = mcc
  const mnc = toNetworkCode(nested.mnc)
  if (mnc) simUsed.mnc = mnc
  return Object.keys(simUsed).length > 0 ? simUsed : undefined
}

/**
 * True when the report carries the nested simUsed object. It describes one
 * whole SIM, so it replaces the stored one instead of merging into it.
 */
export function hasNestedSimUsed(report: SimUsedReport | null | undefined) {
  return (
    !!report &&
    typeof report.simUsed === 'object' &&
    report.simUsed !== null &&
    !Array.isArray(report.simUsed)
  )
}

/** Why the phone picked that SIM, or undefined for an unknown value. */
export function resolveSimSelection(value: unknown): SimSelection | undefined {
  return SIM_SELECTIONS.find((s) => s === value)
}
