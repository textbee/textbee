// The SIM the phone reports it actually used. It can differ from the
// requested simSubscriptionId, which the phone ignores when no active SIM has it.

// Android uses Integer.MAX_VALUE for "default subscription", never a real SIM
const MAX_SUBSCRIPTION_ID = 2147483646
const MAX_SLOT_INDEX = 7

export const SIM_SELECTIONS = [
  'requested',
  'requested_invalid_fallback',
  'app_preferred',
  'system_default',
] as const

export type SimSelection = (typeof SIM_SELECTIONS)[number]

export type SimUsed = {
  subscriptionId?: number
  slotIndex?: number
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

/** Why the phone picked that SIM, or undefined for an unknown value. */
export function resolveSimSelection(value: unknown): SimSelection | undefined {
  return SIM_SELECTIONS.find((s) => s === value)
}
