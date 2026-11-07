import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SMS_ERRORS,
  findSmsError,
  presentSms,
  smsErrorCatalogJson,
  smsErrorFields,
} from './sms-errors'
import { STATUS_TIMEOUT_DISPATCHED_MESSAGE } from './error-history'

const OLD_CODE_7_TEXT =
  'Short code not allowed on this carrier. Use a full phone number.'
const OLD_CODE_1_TEXT =
  'SMS failed on device. Common causes: no SMS credit on SIM, weak signal, or carrier blocked. Check SIM balance and signal, then try again.'
const failedAt = new Date('2026-11-01T10:00:00Z')

describe('SMS_ERRORS', () => {
  it('has one entry per source and code', () => {
    const keys = SMS_ERRORS.map(
      (entry) => `${entry.source}:${!!entry.deliveryReport}:${entry.code}`,
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('has unique names', () => {
    const names = SMS_ERRORS.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('covers every Android send result code', () => {
    const codes = [
      ...Array.from({ length: 33 }, (_, i) => i + 1),
      ...Array.from({ length: 39 }, (_, i) => i + 100),
    ]
    for (const code of codes) {
      expect(findSmsError('device', String(code))).toBeDefined()
    }
  })

  it('uses no em or en dashes', () => {
    for (const entry of SMS_ERRORS) {
      expect(entry.message).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('matches the committed api/sms-errors.json', () => {
    const file = readFileSync(
      join(__dirname, '..', '..', 'sms-errors.json'),
      'utf8',
    )
    expect(file).toBe(smsErrorCatalogJson())
  })

  it('writes the same keys for every entry in the JSON', () => {
    const entries = JSON.parse(smsErrorCatalogJson())
    for (const entry of entries) {
      const { deliveryReport, matchPrefix, ...rest } = entry
      expect(Object.keys(rest)).toEqual([
        'source',
        'code',
        'name',
        'message',
        'docsAnchor',
        'retryable',
      ])
      expect([undefined, true]).toContain(deliveryReport)
      expect([undefined, true]).toContain(matchPrefix)
    }
  })
})

describe('findSmsError', () => {
  it('reads Android codes from the phone', () => {
    expect(findSmsError('device', '7')?.name).toBe('SHORT_CODE_CANCELLED')
    expect(findSmsError('device', '8')?.name).toBe('SHORT_CODE_NEVER_ALLOWED')
    expect(findSmsError('device', ' 111 ')?.name).toBe('RIL_MODEM_ERR')
    expect(findSmsError('device', 'PERMISSION_DENIED')?.retryable).toBe(false)
  })

  it('reads a numeric code only when the phone sent it', () => {
    expect(findSmsError('push', '7')).toBeUndefined()
    expect(findSmsError('server', '1')).toBeUndefined()
  })

  it('reads delivery reports apart from send results', () => {
    expect(findSmsError('device', '0')).toBeUndefined()
    expect(findSmsError('device', '0', { deliveryReport: true })?.name).toBe(
      'DELIVERY_REPORT_CANCELLED',
    )
  })

  it('reads carrier delivery reports by TP-Status, then by prefix', () => {
    expect(findSmsError('device', 'CARRIER_0x41')?.name).toBe(
      'CARRIER_INCOMPATIBLE_DESTINATION',
    )
    expect(findSmsError('device', 'CARRIER_0x62')?.name).toBe(
      'CARRIER_NO_RESPONSE',
    )
    expect(findSmsError('device', 'CARRIER_0x5A')?.name).toBe(
      'CARRIER_DELIVERY_FAILED',
    )
    expect(findSmsError('device', 'CARRIER_3GPP2_0x05')?.name).toBe(
      'CARRIER_DELIVERY_FAILED',
    )
    // only from the phone
    expect(findSmsError('server', 'CARRIER_0x41')).toBeUndefined()
  })

  it('gives a carrier failure its catalog text', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: 'CARRIER_0x43',
      errorMessage:
        'The carrier could not deliver the message and stopped trying (TP-Status 0x43).',
      failedAt: new Date('2026-11-07T10:00:00Z'),
      issueHistory: [
        {
          code: 'CARRIER_0x43',
          at: new Date('2026-11-07T10:00:00Z'),
          source: 'device',
          message:
            'The carrier could not deliver the message and stopped trying (TP-Status 0x43).',
        },
      ],
    })
    expect(fields.errorName).toBe('CARRIER_NOT_OBTAINABLE')
    expect(fields.issueHistory?.[0]).toMatchObject({
      name: 'CARRIER_NOT_OBTAINABLE',
      deviceMessage:
        'The carrier could not deliver the message and stopped trying (TP-Status 0x43).',
    })
  })

  it('matches push codes exactly first, then by prefix', () => {
    expect(
      findSmsError(
        'push',
        'FCM_DELIVERY_FAILED_messaging/message-rate-exceeded',
      )?.name,
    ).toBe('PUSH_RATE_LIMITED')
    expect(
      findSmsError('push', 'FCM_DELIVERY_FAILED_messaging/internal-error')
        ?.name,
    ).toBe('PUSH_FAILED')
    expect(findSmsError('push', 'FCM_DELIVERY_FAILED')?.name).toBe(
      'PUSH_FAILED',
    )
    expect(findSmsError('fcm', 'FCM_SEND_TIMEOUT')?.name).toBe('PUSH_TIMEOUT')
    expect(findSmsError('push', 'FCM_DELIVERY_FAILEDX')).toBeUndefined()
  })

  it('reads server codes', () => {
    expect(findSmsError('server', 'DISPATCH_FAILED')?.name).toBe(
      'DISPATCH_FAILED',
    )
  })

  it('knows nothing of empty or unknown codes', () => {
    expect(findSmsError('device', '')).toBeUndefined()
    expect(findSmsError('device', undefined)).toBeUndefined()
    expect(findSmsError('device', 'UNKNOWN')).toBeUndefined()
    expect(findSmsError('device', '999')).toBeUndefined()
  })
})

describe('smsErrorFields', () => {
  it('replaces old phone text and keeps it as deviceMessage', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '7',
      errorMessage: OLD_CODE_7_TEXT,
      failedAt,
    })

    expect(fields.errorName).toBe('SHORT_CODE_CANCELLED')
    expect(fields.errorMessage).toBe(findSmsError('device', '7').message)
    expect(fields.deviceMessage).toBe(OLD_CODE_7_TEXT)
  })

  it('keeps the radio code of a code 1 failure', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '1',
      errorMessage: `${OLD_CODE_1_TEXT} (code 21)`,
      failedAt,
    })

    expect(fields.errorMessage).toBe(
      `${findSmsError('device', '1').message} (code 21)`,
    )
    expect(fields.deviceMessage).toBe(`${OLD_CODE_1_TEXT} (code 21)`)
  })

  it('leaves out deviceMessage when the phone sent no text', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '124',
      errorMessage: 'Unknown error',
      failedAt,
    })

    expect(fields.errorMessage).toBe(findSmsError('device', '124').message)
    expect(fields).not.toHaveProperty('deviceMessage')
  })

  it('gives catalog text to a failure stored without text', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '4',
      failedAt,
    })

    expect(fields.errorMessage).toBe(findSmsError('device', '4').message)
    expect(fields).not.toHaveProperty('deviceMessage')
  })

  it('keeps the stored text of an unknown code', () => {
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '999',
      errorMessage: 'SmsManager.RESULT_SOMETHING_NEW',
      failedAt,
    })

    expect(fields).toEqual({})
  })

  it('keeps the timeout note, which is not about the code', () => {
    const fields = smsErrorFields({
      status: 'unknown',
      errorCode: 'FCM_SEND_SKIPPED',
      errorMessage: STATUS_TIMEOUT_DISPATCHED_MESSAGE,
    })

    expect(fields).toEqual({ errorName: 'PUSH_SKIPPED' })
  })

  it('adds no text to a code that came without it', () => {
    const fields = smsErrorFields({
      status: 'dispatched',
      errorCode: 'FCM_SEND_SKIPPED',
    })

    expect(fields).toEqual({ errorName: 'PUSH_SKIPPED' })
  })

  it('gives push and server failures no deviceMessage', () => {
    const push = smsErrorFields({
      status: 'failed',
      errorCode: 'FCM_DELIVERY_FAILED_messaging/internal-error',
      errorMessage: 'FCM_DELIVERY_FAILED: Internal error occurred.',
      failedAt,
    })
    const server = smsErrorFields({
      status: 'failed',
      errorCode: 'DISPATCH_FAILED',
      errorMessage: 'connect ECONNREFUSED',
      failedAt,
    })

    expect(push.errorName).toBe('PUSH_FAILED')
    expect(push).not.toHaveProperty('deviceMessage')
    expect(server.errorName).toBe('DISPATCH_FAILED')
    expect(server).not.toHaveProperty('deviceMessage')
  })

  it('takes the source of the current failure from the trail', () => {
    // A numeric code the trail records as a push failure is not a phone code
    const fields = smsErrorFields({
      status: 'failed',
      errorCode: '7',
      errorMessage: 'something',
      failedAt,
      issueHistory: [
        { code: '7', message: 'something', at: failedAt, source: 'push' },
      ],
    })

    expect(fields).not.toHaveProperty('errorName')
    expect(fields).not.toHaveProperty('errorMessage')
  })

  it('translates every trail entry by its own source', () => {
    const at = new Date('2026-11-01T09:00:00Z')
    const fields = smsErrorFields({
      status: 'delivered',
      issueHistory: [
        { code: '7', message: OLD_CODE_7_TEXT, at, source: 'device' },
        {
          code: '0',
          message: 'Delivery report was canceled.',
          at,
          source: 'device',
          deliveryReport: true,
        },
        {
          code: 'FCM_SEND_TIMEOUT',
          message: 'FCM_SEND_TIMEOUT: timed out',
          at,
          source: 'push',
        },
        { code: 'UNKNOWN', message: 'Cancelled by user', at, source: 'device' },
      ],
    })

    expect(fields).not.toHaveProperty('errorMessage')
    expect(fields.issueHistory).toEqual([
      {
        code: '7',
        name: 'SHORT_CODE_CANCELLED',
        message: findSmsError('device', '7').message,
        deviceMessage: OLD_CODE_7_TEXT,
        docsUrl: 'https://textbee.dev/docs/sending-sms/sending-sms#short-codes',
        at,
        source: 'device',
      },
      {
        code: '0',
        name: 'DELIVERY_REPORT_CANCELLED',
        message: findSmsError('device', '0', { deliveryReport: true }).message,
        deviceMessage: 'Delivery report was canceled.',
        at,
        source: 'device',
        deliveryReport: true,
      },
      {
        code: 'FCM_SEND_TIMEOUT',
        name: 'PUSH_TIMEOUT',
        message: findSmsError('push', 'FCM_SEND_TIMEOUT').message,
        at,
        source: 'push',
      },
      { code: 'UNKNOWN', message: 'Cancelled by user', at, source: 'device' },
    ])
  })
})

describe('presentSms', () => {
  it('merges the fields over a lean message and keeps the rest', () => {
    const sms = {
      _id: 's1',
      recipient: '+15555550100',
      status: 'failed',
      errorCode: '8',
      failedAt,
    }

    expect(presentSms(sms)).toEqual({
      ...sms,
      errorName: 'SHORT_CODE_NEVER_ALLOWED',
      errorMessage: findSmsError('device', '8').message,
      docsUrl: 'https://textbee.dev/docs/sending-sms/sending-sms#short-codes',
    })
  })

  it('leaves out docsUrl when the entry has no docs section', () => {
    const presented: any = presentSms({
      status: 'failed',
      errorCode: '4',
      failedAt,
    })

    expect(presented.errorName).toBe('NO_SERVICE')
    expect(presented).not.toHaveProperty('docsUrl')
  })

  it('reads a document through toObject', () => {
    const doc = {
      status: 'failed',
      errorCode: '2',
      errorMessage: 'Radio off',
      failedAt,
      toObject() {
        return {
          _id: 's1',
          status: this.status,
          errorCode: '2',
          errorMessage: 'Radio off',
          failedAt,
        }
      },
    }

    const presented: any = presentSms(doc)
    expect(presented).not.toHaveProperty('toObject')
    expect(presented.errorName).toBe('RADIO_OFF')
    expect(presented.deviceMessage).toBe('Radio off')
  })

  it('returns a missing message as it is', () => {
    expect(presentSms(null)).toBeNull()
  })
})
