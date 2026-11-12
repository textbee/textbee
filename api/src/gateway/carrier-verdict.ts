import { envBool } from './device-config'

// The carrier's verdict, read from the status value of a delivery report

export const FORMAT_3GPP = '3gpp'
export const FORMAT_3GPP2 = '3gpp2'
export const CARRIER_CODE_PREFIX = 'CARRIER_'

export type CarrierVerdict =
  | { kind: 'delivered' }
  // the carrier is still trying; a later report decides
  | { kind: 'still_trying' }
  | { kind: 'failed'; code: string }

const INT32_MIN = -0x80000000
const INT32_MAX = 0x7fffffff

const hex = (value: number) =>
  `0x${value.toString(16).toUpperCase().padStart(2, '0')}`

// TP-Status, 3GPP TS 23.040 section 9.2.3.15
export function gsmVerdict(status: number): CarrierVerdict | null {
  if (!Number.isInteger(status) || status < 0 || status > 0xff) return null
  if (status < 0x20) return { kind: 'delivered' }
  if (status < 0x40) return { kind: 'still_trying' }
  return { kind: 'failed', code: `${CARRIER_CODE_PREFIX}${hex(status)}` }
}

// Class 0 status codes: accepted, deposited, delivered, cancelled
function cdmaNoErrorVerdict(code: number): CarrierVerdict | null {
  if (code === 0x00) return { kind: 'still_trying' }
  if (code === 0x01 || code === 0x02) return { kind: 'delivered' }
  if (code === 0x03) return { kind: 'failed', code: `${CARRIER_CODE_PREFIX}3GPP2_${hex(code)}` }
  return null
}

// Error class in bits 25-24, cause code in bits 23-16 (3GPP2 C.S0015-B 4.5.21)
export function cdmaVerdict(status: number): CarrierVerdict | null {
  if (!Number.isInteger(status) || status < INT32_MIN || status > INT32_MAX) {
    return null
  }
  const errorClass = (status >> 24) & 0x03
  const cause = (status >> 16) & 0xff
  if (errorClass === 0) return cdmaNoErrorVerdict(cause)
  if (errorClass === 2) return { kind: 'still_trying' }
  return { kind: 'failed', code: `${CARRIER_CODE_PREFIX}3GPP2_${hex(cause)}` }
}

export function carrierVerdict(
  format: unknown,
  status: unknown,
): CarrierVerdict | null {
  if (typeof status !== 'number') return null
  if (format === FORMAT_3GPP) return gsmVerdict(status)
  if (format === FORMAT_3GPP2) return cdmaVerdict(status)
  return null
}

// Server only: the override lives in configOverrides but is never sent to the phone
export function carrierVerdictEnabled(
  device: { configOverrides?: Record<string, unknown> | null } | null | undefined,
): boolean {
  const override = device?.configOverrides?.carrierVerdictEnabled
  if (typeof override === 'boolean') return override
  return envBool('CARRIER_VERDICT_ENABLED', false)
}
