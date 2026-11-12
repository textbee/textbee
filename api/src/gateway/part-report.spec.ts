import { createHash } from 'crypto'
import {
  multipartFailureFinalEnabled,
  partReportKey,
  partReportsStoreEnabled,
  readStatusReportPdu,
  resolvePartReport,
} from './part-report'

// SMS-STATUS-REPORT with its SMSC address in front, as Android hands it over
const SMSC = '07911326040000F0'
const FIRST_OCTET = '06'
const MESSAGE_REFERENCE = '0D'
// 11 digits, international, +1 555 555 0100
const RECIPIENT = '0B915155550501F0'
const SCTS = '62112101030000'
// 2026-11-12 10:30:15 at +02:00
const DISCHARGE = '62112101035180'
const TP_STATUS = '00'
const HEAD = SMSC + FIRST_OCTET + MESSAGE_REFERENCE + RECIPIENT + SCTS + DISCHARGE + TP_STATUS
// TP-PI with TP-UDL, then five bytes of user data
const USER_DATA = '0405C8329BFD06'
// what is stored: TP-SCTS through TP-Status
const KEPT = SCTS + DISCHARGE + TP_STATUS
const hexOf = (bytes: Buffer) => bytes.toString('hex').toUpperCase()

describe('readStatusReportPdu', () => {
  it('keeps no address and no user data, and reads the status and discharge time', () => {
    const read = readStatusReportPdu(Buffer.from(HEAD + USER_DATA, 'hex'))

    expect(hexOf(read.pdu)).toBe(KEPT)
    expect(hexOf(read.pdu)).not.toContain('5155550501F0')
    expect(hexOf(read.pdu)).not.toContain('1326040000F0')
    expect(read.status).toBe(0)
    expect(read.dischargeAt).toEqual(new Date(Date.UTC(2026, 10, 12, 8, 30, 15)))
  })

  it('reads TP-Status', () => {
    const failed = HEAD.slice(0, -2) + '41'
    expect(readStatusReportPdu(Buffer.from(failed, 'hex')).status).toBe(0x41)
  })

  it('reads a zone west of UTC', () => {
    const west = HEAD.replace(DISCHARGE, '62112101035188')
    expect(readStatusReportPdu(Buffer.from(west, 'hex')).dischargeAt).toEqual(
      new Date(Date.UTC(2026, 10, 12, 12, 30, 15)),
    )
  })

  it('reads a report without an SMSC address or user data', () => {
    const bare = '00' + HEAD.slice(SMSC.length)
    const read = readStatusReportPdu(Buffer.from(bare, 'hex'))
    expect(hexOf(read.pdu)).toBe(KEPT)
  })

  it('keeps the bytes but no time when the discharge time is not a date', () => {
    // month 13
    const bad = HEAD.replace(DISCHARGE, '62312101035180')
    const read = readStatusReportPdu(Buffer.from(bad, 'hex'))
    expect(read.pdu).toBeDefined()
    expect(read.dischargeAt).toBeUndefined()
    // 31 November
    const noDay = HEAD.replace(DISCHARGE, '62111301035180')
    expect(readStatusReportPdu(Buffer.from(noDay, 'hex')).dischargeAt).toBeUndefined()
  })

  it('reads nothing from a PDU that is not a status report or is cut short', () => {
    // an SMS-DELIVER, which carries user data
    const deliver = SMSC + '04' + HEAD.slice(SMSC.length + 2)
    expect(readStatusReportPdu(Buffer.from(deliver, 'hex'))).toBeNull()
    expect(readStatusReportPdu(Buffer.from(HEAD.slice(0, -2), 'hex'))).toBeNull()
    expect(readStatusReportPdu(Buffer.from('', 'hex'))).toBeNull()
    expect(readStatusReportPdu(Buffer.from('FF' + HEAD, 'hex'))).toBeNull()
  })

  it('never throws on random bytes', () => {
    for (let n = 0; n < 200; n++) {
      const bytes = Buffer.from(
        Array.from({ length: n % 60 }, (_, i) => (i * 37 + n * 11) & 0xff),
      )
      expect(() => readStatusReportPdu(bytes)).not.toThrow()
    }
  })
})

describe('resolvePartReport', () => {
  it('takes every valid field', () => {
    expect(
      resolvePartReport({
        partIndex: 1,
        partCount: 3,
        resultCode: -1,
        radioErrorCode: 0,
        perPartUpload: true,
        deliveryReport: { format: '3gpp', status: 0, pdu: HEAD + USER_DATA },
      }),
    ).toEqual({
      partIndex: 1,
      partCount: 3,
      resultCode: -1,
      perPartUpload: true,
      radioErrorCode: 0,
      deliveryReport: {
        format: '3gpp',
        status: 0,
        pdu: Buffer.from(KEPT, 'hex'),
        dischargeAt: new Date(Date.UTC(2026, 10, 12, 8, 30, 15)),
      },
    })
  })

  it('takes the status from TP-Status when the phone sent none', () => {
    const failed = HEAD.slice(0, -2) + '41'
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', pdu: failed } }).deliveryReport
        .status,
    ).toBe(0x41)
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', status: 'x', pdu: failed } })
        .deliveryReport.status,
    ).toBe(0x41)
  })

  it('keeps the phone status when it differs from TP-Status', () => {
    const failed = HEAD.slice(0, -2) + '41'
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', status: 0, pdu: failed } })
        .deliveryReport.status,
    ).toBe(0)
  })

  it('returns nothing for a report from an older build', () => {
    expect(resolvePartReport({ smsId: 'x', status: 'sent' })).toEqual({})
  })

  it('drops fields of the wrong type or range', () => {
    expect(
      resolvePartReport({
        partIndex: '1',
        partCount: 0,
        resultCode: 1.5,
        radioErrorCode: 2 ** 40,
        perPartUpload: 'true',
        deliveryReport: 'delivered',
      }),
    ).toEqual({})
    expect(resolvePartReport({ partCount: 256 })).toEqual({})
    expect(resolvePartReport({ partCount: '3' })).toEqual({})
    expect(resolvePartReport({ partIndex: -1, partCount: 2 })).toEqual({ partCount: 2 })
    expect(resolvePartReport({ partIndex: 2, partCount: 2 })).toEqual({ partCount: 2 })
    expect(resolvePartReport({ deliveryReport: [] })).toEqual({})
    for (const perPartUpload of [false, 1, 'yes', {}]) {
      expect(resolvePartReport({ perPartUpload })).toEqual({})
    }
  })

  it('drops bad delivery report fields one by one', () => {
    expect(
      resolvePartReport({
        partCount: 1,
        deliveryReport: { format: 'gsm', status: '0', pdu: 'XYZ' },
      }),
    ).toEqual({ partCount: 1, pduHash: expect.any(String) })
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', status: 'x' } }),
    ).toEqual({ deliveryReport: { format: '3gpp' } })
  })

  it('stores no PDU that is too long, not hex, odd, or not readable', () => {
    for (const pdu of [
      HEAD + USER_DATA + '00'.repeat(300),
      HEAD.replace('F0', 'G0'),
      HEAD + '0',
      'DEADBEEF',
      123,
    ]) {
      expect(
        resolvePartReport({ deliveryReport: { format: '3gpp', status: 0, pdu } }),
      ).toEqual({ deliveryReport: { format: '3gpp', status: 0 } })
    }
  })

  it('stores no PDU of a 3GPP2 report or of an unknown format', () => {
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp2', status: 0, pdu: HEAD } }),
    ).toEqual({ deliveryReport: { format: '3gpp2', status: 0 } })
    expect(resolvePartReport({ deliveryReport: { status: 0, pdu: HEAD } })).toEqual({
      deliveryReport: { status: 0 },
    })
  })
})

describe('PDU hash for the report key', () => {
  const sha1 = (text: string) => createHash('sha1').update(text).digest('hex').slice(0, 8)

  it('hashes a PDU that gave no status', () => {
    const unreadable = '0011223344'
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', pdu: unreadable } }).pduHash,
    ).toBe(sha1(unreadable))
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp2', pdu: 'ABCDEF' } }).pduHash,
    ).toBe(sha1('abcdef'))
  })

  it('hashes nothing when a status is known or no PDU was sent', () => {
    expect(
      resolvePartReport({ deliveryReport: { format: '3gpp', status: 0, pdu: '0011' } }).pduHash,
    ).toBeUndefined()
    expect(resolvePartReport({ deliveryReport: { format: '3gpp', pdu: HEAD } }).pduHash).toBeUndefined()
    expect(resolvePartReport({ deliveryReport: { format: '3gpp' } }).pduHash).toBeUndefined()
    expect(resolvePartReport({ partIndex: 0, partCount: 1 }).pduHash).toBeUndefined()
  })
})

describe('partReportKey', () => {
  it('joins the part, the status and the carrier status', () => {
    expect(
      partReportKey('delivered', { partIndex: 2, deliveryReport: { status: 0 } }),
    ).toBe('2_delivered_0')
  })

  it('marks a missing carrier status', () => {
    expect(partReportKey('sent', { partIndex: 0, partCount: 3 })).toBe('0_sent_none')
  })

  it('tells two unreadable delivery reports of one part apart', () => {
    const first = resolvePartReport({
      partIndex: 1,
      partCount: 2,
      deliveryReport: { format: '3gpp', pdu: '0011223344' },
    })
    const second = resolvePartReport({
      partIndex: 1,
      partCount: 2,
      deliveryReport: { format: '3gpp', pdu: '0011223355' },
    })
    const firstKey = partReportKey('delivered', { ...first, partIndex: 1 })
    expect(firstKey).toBe(`1_delivered_none-${first.pduHash}`)
    expect(firstKey).not.toBe(partReportKey('delivered', { ...second, partIndex: 1 }))
  })
})

describe('part report switches', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('are on when unset', () => {
    delete process.env.PART_REPORTS_STORE_ENABLED
    delete process.env.MULTIPART_FAILURE_FINAL_ENABLED
    expect(partReportsStoreEnabled()).toBe(true)
    expect(multipartFailureFinalEnabled()).toBe(true)
  })

  it('follow the environment on every call', () => {
    process.env.PART_REPORTS_STORE_ENABLED = 'false'
    process.env.MULTIPART_FAILURE_FINAL_ENABLED = '0'
    expect(partReportsStoreEnabled()).toBe(false)
    expect(multipartFailureFinalEnabled()).toBe(false)
  })
})
