import * as mongoose from 'mongoose'
import { SMSSchema } from './sms.schema'

describe('SMSSchema simUsed', () => {
  const SmsModel = mongoose.model('SmsSchemaSimUsedSpec', SMSSchema)

  it('stores the used SIM without an id of its own', () => {
    const sms = new SmsModel({ simUsed: { subscriptionId: 19, slotIndex: 1 } })

    expect(sms.toObject().simUsed).toEqual({ subscriptionId: 19, slotIndex: 1 })
  })

  it('drops keys the schema does not define', () => {
    const sms = new SmsModel({ simUsed: { subscriptionId: 19, carrier: 'x' } })

    expect(sms.toObject().simUsed).toEqual({ subscriptionId: 19 })
  })
})
