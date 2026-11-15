import { messageDirection } from './group'
import type { SmsMessage } from './types'

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

// The SIM the phone reported, e.g. "SIM 2". Undefined for messages handled by
// app versions that do not report it, so those rows show nothing.
export function simName(message: SmsMessage): string | undefined {
  const slot = message.simUsed?.slotIndex
  const id = message.simUsed?.subscriptionId
  if (isNumber(slot)) return `SIM ${slot + 1}`
  if (isNumber(id)) return `SIM ID ${id}`
  return text(message.simUsed?.carrierName)
}

// The carrier the phone reported for that SIM, e.g. "Smart".
export function simCarrier(message: SmsMessage): string | undefined {
  return text(message.simUsed?.carrierName)
}

// The name plus the carrier when known, e.g. "SIM 2 · Smart". A saved number
// label for the slot goes between them: "SIM 2 · +15555550123 · Smart".
export function simNameWithCarrier(
  message: SmsMessage,
  phoneNumber?: string
): string | undefined {
  const name = simName(message)
  if (!name) return undefined
  const carrier = simCarrier(message)
  const number = isNumber(message.simUsed?.slotIndex) ? text(phoneNumber) : undefined
  return [name, number, carrier && carrier !== name ? carrier : undefined]
    .filter(Boolean)
    .join(' · ')
}

// "Sent from SIM 2" or "Received on SIM 2".
export function simLabel(message: SmsMessage): string | undefined {
  const name = simName(message)
  if (!name) return undefined
  return messageDirection(message) === 'sent'
    ? `Sent from ${name}`
    : `Received on ${name}`
}

// The label with the carrier and the subscription ID when the slot named the
// SIM, e.g. "Sent from SIM 2 · Smart (ID 19)". Used where there is room.
export function simFullLabel(
  message: SmsMessage,
  phoneNumber?: string
): string | undefined {
  const name = simNameWithCarrier(message, phoneNumber)
  if (!name) return undefined
  const label =
    messageDirection(message) === 'sent'
      ? `Sent from ${name}`
      : `Received on ${name}`
  const slot = message.simUsed?.slotIndex
  const id = message.simUsed?.subscriptionId
  if (isNumber(slot) && isNumber(id)) return `${label} (ID ${id})`
  return label
}

// Tooltip lines with every part the phone reported.
export function simDetails(message: SmsMessage): string[] {
  const sim = message.simUsed
  const slot = sim?.slotIndex
  const id = sim?.subscriptionId
  const lines: string[] = []
  if (isNumber(slot)) lines.push(`Slot: SIM ${slot + 1} (slotIndex ${slot})`)
  if (isNumber(id)) lines.push(`Subscription ID: ${id}`)
  const carrier = text(sim?.carrierName)
  if (carrier) lines.push(`Carrier: ${carrier}`)
  const displayName = text(sim?.displayName)
  if (displayName && displayName !== carrier) lines.push(`Name on phone: ${displayName}`)
  const country = text(sim?.countryIso)
  if (country) lines.push(`Country: ${country.toUpperCase()}`)
  const mcc = text(sim?.mcc)
  const mnc = text(sim?.mnc)
  if (mcc && mnc) lines.push(`Network code: ${mcc}-${mnc}`)
  else if (mcc) lines.push(`Mobile country code: ${mcc}`)
  else if (mnc) lines.push(`Mobile network code: ${mnc}`)
  return lines
}

// The SIM the caller asked for, e.g. "Requested SIM 2" or "Requested SIM ID 19".
export function simRequested(message: SmsMessage): string | undefined {
  if (isNumber(message.simSlotIndex)) return `Requested SIM ${message.simSlotIndex + 1}`
  if (isNumber(message.simSubscriptionId)) return `Requested SIM ID ${message.simSubscriptionId}`
  return undefined
}

// True when the caller asked for one SIM ID and the phone reports another,
// which happens when the requested ID matches no SIM in the phone.
export function simMismatch(message: SmsMessage): boolean {
  if (isNumber(message.simSlotIndex)) return false
  const requested = message.simSubscriptionId
  const used = message.simUsed?.subscriptionId
  return isNumber(requested) && isNumber(used) && requested !== used
}

// True when the caller asked for one slot and the phone reports another.
export function simSlotMismatch(message: SmsMessage): boolean {
  const requested = message.simSlotIndex
  const used = message.simUsed?.slotIndex
  return isNumber(requested) && isNumber(used) && requested !== used
}
