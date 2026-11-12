import { createHash } from 'crypto'
import { FORMAT_3GPP, FORMAT_3GPP2 } from './carrier-verdict'
import { envBool } from './device-config'

// Per-part report fields; a bad field is dropped and the report still counts

// A long SMS has at most 255 parts (3GPP TS 23.040 section 9.2.3.24.1)
const MAX_PART_COUNT = 255
const MAX_PDU_HEX_LENGTH = 600
const INT32_MIN = -0x80000000
const INT32_MAX = 0x7fffffff

export type DeliveryReportInput = {
  format?: string
  status?: number
  // TP-SCTS through TP-Status only: no addresses, no user data
  pdu?: Buffer
  dischargeAt?: Date
}

export type PartReportInput = {
  partIndex?: number
  partCount?: number
  resultCode?: number
  radioErrorCode?: number
  deliveryReport?: DeliveryReportInput
  // short hash of a PDU sent without a readable status, for the report key
  pduHash?: string
}

function int32(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INT32_MIN &&
    value <= INT32_MAX
    ? value
    : undefined
}

function hexBytes(value: unknown): Buffer | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > MAX_PDU_HEX_LENGTH) return undefined
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(value)) return undefined
  return Buffer.from(value, 'hex')
}

// Two BCD digits with swapped nibbles, as in TP-SCTS and TP-DT
function swappedBcd(byte: number): number | undefined {
  const tens = byte & 0x0f
  const units = byte >> 4
  return tens > 9 || units > 9 ? undefined : tens * 10 + units
}

// TP-DT, 3GPP TS 23.040 section 9.2.3.11
export function readTimestamp(bytes: Buffer, offset: number): Date | undefined {
  if (offset + 7 > bytes.length) return undefined
  const [yy, mo, dd, hh, mi, ss] = Array.from(
    bytes.subarray(offset, offset + 6),
  ).map(swappedBcd)
  // bit 3 of the zone byte is its sign
  const zoneByte = bytes[offset + 6]
  const quarters = swappedBcd(zoneByte & ~0x08)
  if (
    [yy, mo, dd, hh, mi, ss, quarters].some((v) => v === undefined) ||
    mo < 1 ||
    mo > 12 ||
    dd < 1 ||
    dd > 31 ||
    hh > 23 ||
    mi > 59 ||
    ss > 59 ||
    quarters > 56
  ) {
    return undefined
  }
  const local = Date.UTC(2000 + yy, mo - 1, dd, hh, mi, ss)
  if (new Date(local).getUTCDate() !== dd) return undefined
  const offsetMs = (zoneByte & 0x08 ? -quarters : quarters) * 15 * 60 * 1000
  return new Date(local - offsetMs)
}

/** A 3GPP SMS-STATUS-REPORT with its SMSC address in front, or null. */
export function readStatusReportPdu(
  bytes: Buffer,
): { pdu: Buffer; status: number; dischargeAt?: Date } | null {
  let at = 0
  const smscLength = bytes[at]
  if (smscLength === undefined || smscLength > 11) return null
  at += 1 + smscLength
  const firstOctet = bytes[at]
  // TP-MTI 10 is SMS-STATUS-REPORT
  if (firstOctet === undefined || (firstOctet & 0x03) !== 0x02) return null
  // first octet, then TP-MR
  at += 2
  const digits = bytes[at]
  if (digits === undefined || digits > 20) return null
  // TP-RA: length in digits, type of address, then the digits
  at += 2 + Math.ceil(digits / 2)
  const scts = at
  const dt = scts + 7
  const st = dt + 7
  if (st >= bytes.length) return null
  return {
    pdu: Buffer.from(bytes.subarray(scts, st + 1)),
    status: bytes[st],
    dischargeAt: readTimestamp(bytes, dt),
  }
}

function resolveDeliveryReport(value: unknown): DeliveryReportInput | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const report: DeliveryReportInput = {}
  if (raw.format === FORMAT_3GPP || raw.format === FORMAT_3GPP2) {
    report.format = raw.format
  }
  const status = int32(raw.status)
  if (status !== undefined) report.status = status
  const bytes = hexBytes(raw.pdu)
  // Only a 3GPP report can be cut before its user data
  if (bytes && report.format === FORMAT_3GPP) {
    const read = readStatusReportPdu(bytes)
    if (read) {
      report.pdu = read.pdu
      // The phone's value wins when both exist
      if (report.status === undefined) report.status = read.status
      if (read.dischargeAt) report.dischargeAt = read.dischargeAt
    }
  }
  return Object.keys(report).length > 0 ? report : undefined
}

export function resolvePartReport(dto: Record<string, unknown>): PartReportInput {
  const input: PartReportInput = {}
  const partCount = int32(dto.partCount)
  if (partCount !== undefined && partCount >= 1 && partCount <= MAX_PART_COUNT) {
    input.partCount = partCount
  }
  const partIndex = int32(dto.partIndex)
  if (
    partIndex !== undefined &&
    partIndex >= 0 &&
    partIndex < (input.partCount ?? MAX_PART_COUNT)
  ) {
    input.partIndex = partIndex
  }
  const resultCode = int32(dto.resultCode)
  if (resultCode !== undefined) input.resultCode = resultCode
  const radioErrorCode = int32(dto.radioErrorCode)
  if (radioErrorCode !== undefined) input.radioErrorCode = radioErrorCode
  const deliveryReport = resolveDeliveryReport(dto.deliveryReport)
  if (deliveryReport) input.deliveryReport = deliveryReport
  const pdu = (dto.deliveryReport as Record<string, unknown> | undefined)?.pdu
  if (
    deliveryReport?.status === undefined &&
    typeof pdu === 'string' &&
    pdu.length > 0 &&
    pdu.length <= MAX_PDU_HEX_LENGTH
  ) {
    input.pduHash = createHash('sha1').update(pdu.toLowerCase()).digest('hex').slice(0, 8)
  }
  return input
}

// The same parts the app uses in the name of its upload job
export function partReportKey(
  status: string,
  input: PartReportInput & { partIndex: number },
): string {
  const delivery =
    input.deliveryReport?.status ?? (input.pduHash ? `none-${input.pduHash}` : 'none')
  return `${input.partIndex}_${status}_${delivery}`
}

export function partReportsStoreEnabled(): boolean {
  return envBool('PART_REPORTS_STORE_ENABLED', true)
}

export function multipartFailureFinalEnabled(): boolean {
  return envBool('MULTIPART_FAILURE_FINAL_ENABLED', true)
}
