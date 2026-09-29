import { PolarWebhookPayloadSchema } from './polar-webhook-payload.schema'

describe('PolarWebhookPayloadSchema', () => {
  it('indexes events by provider object id and time', () => {
    expect(PolarWebhookPayloadSchema.indexes()).toContainEqual([
      { 'payload.data.id': 1, createdAt: -1 },
      expect.anything(),
    ])
  })
})
