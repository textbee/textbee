export type ReportedSim = { subscriptionId: number; label: string }

// Android subscription IDs are 32-bit ints
export const MAX_SIM_ID = 2147483647

export const SIM_ID_ERROR =
  'Enter the SIM subscription ID as a whole number, or leave it empty.'

/** The typed ID: undefined when empty, NaN when not a valid ID. */
export function parseSimId(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^\d{1,10}$/.test(trimmed)) return NaN
  const id = Number(trimmed)
  return id <= MAX_SIM_ID ? id : NaN
}

/** The SIMs in the phone's last report, labelled "SIM 2 · Smart". */
export function reportedSims(simInfo?: { sims?: unknown[] }): ReportedSim[] {
  const sims = Array.isArray(simInfo?.sims) ? simInfo.sims : []
  const seen = new Set<number>()
  return sims.flatMap((raw: any) => {
    // Same range the field accepts, so a picked chip never blocks the send
    const id = raw?.subscriptionId
    if (!Number.isInteger(id) || id < 0 || id > MAX_SIM_ID || seen.has(id)) {
      return []
    }
    seen.add(raw.subscriptionId)
    const slot = Number.isInteger(raw.simSlotIndex) ? `SIM ${raw.simSlotIndex + 1}` : 'SIM'
    const name = raw.carrierName || raw.displayName
    return [
      {
        subscriptionId: raw.subscriptionId,
        label: name ? `${slot} · ${name}` : slot,
      },
    ]
  })
}
