export type ReportedSim = { subscriptionId: number; label: string }

/** The typed ID: undefined when empty, NaN when not a whole number. */
export function parseSimId(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : NaN
}

/** The SIMs in the phone's last report, labelled "SIM 2 · Smart". */
export function reportedSims(simInfo?: { sims?: unknown[] }): ReportedSim[] {
  const sims = Array.isArray(simInfo?.sims) ? simInfo.sims : []
  return sims.flatMap((raw: any) => {
    if (!Number.isInteger(raw?.subscriptionId)) return []
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

export const SIM_ID_ERROR = 'Enter the SIM subscription ID as a whole number, or leave it empty.'
