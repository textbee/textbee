// Phone number labels the account owner types for each SIM slot. textbee never
// checks them and never sends by them.

export type SimNumber = { slotIndex: number; phoneNumber: string }

export const SIM_NUMBERS_SLOT_ERROR =
  'simNumbers needs one entry per SIM slot, with slotIndex from 0 to 7.'
export const SIM_NUMBERS_PHONE_ERROR =
  'Enter the phone number with digits only, for example +15555550123.'

const MAX_SLOT_INDEX = 7
const SEPARATORS = /[\s\-.()[\]]/g
const PHONE_NUMBER = /^\+?\d{3,15}$/

/**
 * The stored labels after applying a request. A slot in the request replaces
 * the stored one, an empty phoneNumber removes it, and slots left out keep
 * their stored value.
 */
export function mergeSimNumbers(
  stored: SimNumber[] | null | undefined,
  input: unknown,
): { ok: true; simNumbers: SimNumber[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: SIM_NUMBERS_SLOT_ERROR }

  const seen = new Set<number>()
  for (const entry of input) {
    const slot = entry?.slotIndex
    if (
      typeof slot !== 'number' ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot > MAX_SLOT_INDEX ||
      seen.has(slot)
    ) {
      return { ok: false, error: SIM_NUMBERS_SLOT_ERROR }
    }
    seen.add(slot)
  }

  const bySlot = new Map<number, string>()
  for (const entry of Array.isArray(stored) ? stored : []) {
    bySlot.set(entry.slotIndex, entry.phoneNumber)
  }
  for (const entry of input) {
    if (typeof entry.phoneNumber !== 'string') {
      return { ok: false, error: SIM_NUMBERS_PHONE_ERROR }
    }
    const phoneNumber = entry.phoneNumber.replace(SEPARATORS, '')
    if (phoneNumber === '') {
      bySlot.delete(entry.slotIndex)
      continue
    }
    if (!PHONE_NUMBER.test(phoneNumber)) {
      return { ok: false, error: SIM_NUMBERS_PHONE_ERROR }
    }
    bySlot.set(entry.slotIndex, phoneNumber)
  }

  const simNumbers = [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slotIndex, phoneNumber]) => ({ slotIndex, phoneNumber }))
  return { ok: true, simNumbers }
}
