import * as mongoose from 'mongoose'
import {
  PART_REPORT_TTL_SECONDS,
  SMSPartReportSchema,
} from './sms-part-report.schema'

describe('SMSPartReportSchema', () => {
  it('stores a report once per message and key', () => {
    expect(SMSPartReportSchema.indexes()).toContainEqual([
      { sms: 1, key: 1 },
      expect.objectContaining({ unique: true }),
    ])
  })

  it('deletes a report 90 days after it arrived', () => {
    expect(PART_REPORT_TTL_SECONDS).toBe(90 * 24 * 60 * 60)
    expect(SMSPartReportSchema.indexes()).toContainEqual([
      { receivedAt: 1 },
      expect.objectContaining({ expireAfterSeconds: PART_REPORT_TTL_SECONDS }),
    ])
  })

  it('stores the delivery report without an id of its own', () => {
    const Model = mongoose.model('SmsPartReportSchemaSpec', SMSPartReportSchema)
    const pdu = Buffer.from('6211210103000000', 'hex')
    const report = new Model({ deliveryReport: { format: '3gpp', status: 0, pdu } })

    const stored = report.toObject().deliveryReport
    expect(stored).toEqual({ format: '3gpp', status: 0, pdu: expect.anything() })
    expect((stored.pdu as any).toString('hex')).toBe(pdu.toString('hex'))
  })
})
