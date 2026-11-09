import mongoose, { Types } from 'mongoose'
import { SMSBatchSchema } from './schemas/sms-batch.schema'
import { presentSmsBatch } from './sms-batch-response'

const Batch = mongoose.model('SmsBatchResponseSpec', SMSBatchSchema.clone())

// Every stored field the API defines, as real documents hold them
const stored = {
  _id: new Types.ObjectId(),
  user: new Types.ObjectId(),
  device: new Types.ObjectId(),
  message: 'Your code is 1234',
  encrypted: false,
  encryptedMessage: 'abc',
  recipientCount: 2,
  recipientPreview: '+15555550100, +15555550101',
  successCount: 1,
  failureCount: 1,
  pendingCount: 0,
  dispatchedCount: 2,
  sentCount: 1,
  deliveredCount: 1,
  unknownCount: 0,
  status: 'completed',
  error: 'one failed',
  completedAt: new Date('2026-11-01T10:05:00Z'),
  statusCheckedAt: new Date('2026-11-01T10:06:00Z'),
  metadata: { source: 'api', nested: { a: 1 } },
  createdAt: new Date('2026-11-01T10:00:00Z'),
  updatedAt: new Date('2026-11-01T10:06:00Z'),
  __v: 0,
}

describe('presentSmsBatch', () => {
  it('leaves the JSON of a document with only defined fields byte-identical', () => {
    const doc = Batch.hydrate({ ...stored })
    expect(JSON.stringify(presentSmsBatch(doc))).toBe(JSON.stringify(doc))
  })

  it('keeps every field the schema defines', () => {
    const output = presentSmsBatch(Batch.hydrate({ ...stored }))
    for (const key of Object.keys(stored)) {
      expect(output).toHaveProperty(key)
    }
  })

  it('keeps schema defaults on a sparse legacy document', () => {
    const sparse = { _id: stored._id, device: stored.device }
    const doc = Batch.hydrate(sparse)
    expect(JSON.stringify(presentSmsBatch(doc))).toBe(JSON.stringify(doc))
  })

  it('drops a stored field the schema does not define', () => {
    const doc = Batch.hydrate({ ...stored, internalNote: { value: 1 } })
    // the document itself would serialize it
    expect(JSON.parse(JSON.stringify(doc))).toHaveProperty('internalNote')

    const output = JSON.parse(JSON.stringify(presentSmsBatch(doc)))
    expect(output).not.toHaveProperty('internalNote')
    expect(output.message).toBe(stored.message)
  })

  it('accepts a plain object', () => {
    expect(presentSmsBatch({ _id: 'a', status: 'sent', internalNote: 1 })).toEqual({
      _id: 'a',
      status: 'sent',
    })
  })
})
