import { messageDirection } from './group'
import type { SmsMessage } from './types'

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

// The SIM the phone reported, e.g. "SIM 2". Undefined for messages handled by
// app versions that do not report it, so those rows show nothing.
export function simName(message: SmsMessage): string | undefined {
  const slot = message.simUsed?.slotIndex
  const id = message.simUsed?.subscriptionId
  if (isNumber(slot)) return `SIM ${slot + 1}`
  if (isNumber(id)) return `SIM ID ${id}`
  return undefined
}

// "Sent from SIM 2" or "Received on SIM 2".
export function simLabel(message: SmsMessage): string | undefined {
  const name = simName(message)
  if (!name) return undefined
  return messageDirection(message) === 'sent'
    ? `Sent from ${name}`
    : `Received on ${name}`
}

// Tooltip lines with every part the phone reported.
export function simDetails(message: SmsMessage): string[] {
  const slot = message.simUsed?.slotIndex
  const id = message.simUsed?.subscriptionId
  const lines: string[] = []
  if (isNumber(slot)) lines.push(`Slot: SIM ${slot + 1} (slotIndex ${slot})`)
  if (isNumber(id)) lines.push(`Subscription ID: ${id}`)
  return lines
}

// True when the caller asked for one SIM and the phone reports another,
// which happens when the requested ID matches no SIM in the phone.
export function simMismatch(message: SmsMessage): boolean {
  const requested = message.simSubscriptionId
  const used = message.simUsed?.subscriptionId
  return isNumber(requested) && isNumber(used) && requested !== used
}
