import { WebhookController } from './webhook.controller'

describe('WebhookController signatureVersion', () => {
  const doc = (id: string) => ({
    toJSON: () => ({ _id: id, deliveryUrl: 'https://example.com/hook' }),
  })
  const webhookService: any = {
    findWebhooksForUser: jest.fn().mockResolvedValue([doc('w1'), doc('w2')]),
    findOne: jest.fn().mockResolvedValue(doc('w1')),
    create: jest.fn().mockResolvedValue(doc('w1')),
    update: jest.fn().mockResolvedValue(doc('w1')),
  }
  const controller = new WebhookController(webhookService)
  const req = { user: { _id: 'u1' } }

  it('adds signatureVersion 2 to every listed subscription', async () => {
    const { data } = await controller.getWebhooks(req)
    expect(data).toEqual([
      { _id: 'w1', deliveryUrl: 'https://example.com/hook', signatureVersion: 2 },
      { _id: 'w2', deliveryUrl: 'https://example.com/hook', signatureVersion: 2 },
    ])
  })

  it.each([
    ['get', () => controller.getWebhook(req, 'w1')],
    ['create', () => controller.createWebhook(req, {} as any)],
    ['update', () => controller.updateWebhook(req, 'w1', {} as any)],
  ])('adds signatureVersion 2 on %s', async (_name, call) => {
    const { data } = await call()
    expect(data).toMatchObject({ _id: 'w1', signatureVersion: 2 })
  })
})
