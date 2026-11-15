import type { DeviceSim, SimNumber } from '@/lib/api/types'

export const SIM_NUMBER_ERROR =
  'Enter the phone number with digits only, for example +15555550123.'

/**
 * The typed number without spaces, dashes, dots or brackets. '' when empty,
 * null when it is not an optional + followed by 3 to 15 digits.
 */
export function normalizeSimNumber(text: string): string | null {
  const stripped = text.replace(/[\s\-.()[\]]/g, '')
  if (stripped === '') return ''
  return /^\+?\d{3,15}$/.test(stripped) ? stripped : null
}

export type SimSlot = {
  // Zero-based: 0 is SIM 1
  slotIndex: number
  // A SIM was in this slot in the phone's last report
  present: boolean
  carrier?: string
  subscriptionId?: number
  phoneNumber?: string
}

type SimInfo = { sims?: DeviceSim[] } | null | undefined

const isSlot = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7

const reported = (simInfo: SimInfo): DeviceSim[] =>
  Array.isArray(simInfo?.sims) ? simInfo.sims.filter(Boolean) : []

/** True when the phone reported at least one SIM. */
export function hasSimReport(simInfo: SimInfo): boolean {
  return reported(simInfo).length > 0
}

/** Saved number labels with a number, by slot. */
export function savedSimNumbers(simNumbers?: SimNumber[] | null): SimNumber[] {
  if (!Array.isArray(simNumbers)) return []
  return simNumbers
    .filter((n) => isSlot(n?.slotIndex) && typeof n.phoneNumber === 'string' && n.phoneNumber.trim())
    .map((n) => ({ slotIndex: n.slotIndex, phoneNumber: n.phoneNumber.trim() }))
    .sort((a, b) => a.slotIndex - b.slotIndex)
}

/**
 * SIM 1 and SIM 2 always, plus any higher slot that the phone reported, that
 * has a saved number, or that is passed as `include`.
 */
export function simSlots(
  simInfo: SimInfo,
  simNumbers?: SimNumber[] | null,
  include?: number
): SimSlot[] {
  const sims = reported(simInfo)
  const numbers = savedSimNumbers(simNumbers)
  const indexes = new Set([0, 1])
  for (const sim of sims) if (isSlot(sim.simSlotIndex)) indexes.add(sim.simSlotIndex)
  for (const n of numbers) indexes.add(n.slotIndex)
  if (isSlot(include)) indexes.add(include)

  return [...indexes]
    .sort((a, b) => a - b)
    .map((slotIndex) => {
      const sim = sims.find((s) => s.simSlotIndex === slotIndex)
      const carrier = (sim?.carrierName || sim?.displayName || '').trim()
      const id = sim?.subscriptionId
      return {
        slotIndex,
        present: Boolean(sim),
        carrier: carrier || undefined,
        subscriptionId: typeof id === 'number' && Number.isInteger(id) && id >= 0 ? id : undefined,
        phoneNumber: numbers.find((n) => n.slotIndex === slotIndex)?.phoneNumber,
      }
    })
}

/** The saved number for a slot, if any. */
export function simNumberForSlot(
  simNumbers: SimNumber[] | null | undefined,
  slotIndex: number | undefined
): string | undefined {
  if (!isSlot(slotIndex)) return undefined
  return savedSimNumbers(simNumbers).find((n) => n.slotIndex === slotIndex)?.phoneNumber
}
