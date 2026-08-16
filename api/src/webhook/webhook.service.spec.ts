import { HttpException } from '@nestjs/common'
import * as crypto from 'crypto'
import axios from 'axios'
import { WebhookService } from './webhook.service'
import { WebhookEvent } from './webhook-event.enum'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const build = () => {
  const webhookSubscriptionModel: any = {
    findById: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue(undefined),
  }
  const webhookNotificationModel: any = { findById: jest.fn() }

  const service = new WebhookService(
    webhookSubscriptionModel,
    webhookNotificationModel,
    {} as any, // webhookQueueService
    {} as any, // mailService
    {} as any, // usersService
  )

  return { service, webhookSubscriptionModel, webhookNotificationModel }
}

describe('WebhookService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('validateDeliveryUrl (SSRF guard)', () => {
    const validate = (service: WebhookService, url: string) =>
      (service as any).validateDeliveryUrl(url)

    it('accepts a normal https URL', () => {
      const { service } = build()
      expect(() => validate(service, 'https://example.com/hook')).not.toThrow()
    })

    it.each(['ftp://example.com/hook', 'file:///etc/passwd', 'not-a-url'])(
      'rejects a non-http(s) or malformed URL: %s',
      (url) => {
        const { service } = build()
        expect(() => validate(service, url)).toThrow(HttpException)
      },
    )

    it.each([
      'http://localhost/hook',
      'http://127.0.0.1/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://169.254.169.254/latest/meta-data', // cloud metadata IP
      'http://172.16.0.1/hook',
    ])('rejects a private or loopback host: %s', (url) => {
      const { service } = build()
      expect(() => validate(service, url)).toThrow(HttpException)
    })
  })

  describe('signing secret validation and generation', () => {
    it('rejects a create with a secret shorter than 20 characters', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: [WebhookEvent.MESSAGE_RECEIVED],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: 'too-short',
          },
        }),
      ).rejects.toThrow(HttpException)
    })

    it('auto-generates a secure 64-char hex secret if signingSecret is omitted on create', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.countDocuments.mockResolvedValue(0)
      webhookSubscriptionModel.create.mockImplementation((args: any) =>
        Promise.resolve({ ...args, _id: 'ws_new' }),
      )

      await service.create({
        user: { _id: 'user_1' },
        createWebhookDto: {
          name: 'auto-gen webhook',
          events: [WebhookEvent.MESSAGE_RECEIVED],
          deliveryUrl: 'https://example.com/hook',
        },
      })

      expect(webhookSubscriptionModel.create).toHaveBeenCalledTimes(1)
      const createdArgs = webhookSubscriptionModel.create.mock.calls[0][0]
      expect(createdArgs.signingSecret).toBeDefined()
      expect(createdArgs.signingSecret).toHaveLength(64)
      expect(/^[0-9a-f]{64}$/.test(createdArgs.signingSecret)).toBe(true)
    })

    it('rejects an update that sets a secret shorter than 20 characters', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.findOne.mockResolvedValue({
        signingSecret: 'a'.repeat(20),
        save: jest.fn(),
      })

      await expect(
        service.update({
          user: { _id: 'user_1' },
          webhookId: 'wh_1',
          updateWebhookDto: { signingSecret: 'short' } as any,
        }),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('attemptWebhookDelivery', () => {
    const activeSubscription = (overrides: Record<string, unknown> = {}) => ({
      _id: 'ws_1',
      isActive: true,
      deletedAt: null,
      deliveryUrl: 'https://example.com/hook',
      signingSecret: 'a-signing-secret-of-enough-length',
      ...overrides,
    })

    const notification = (): any => ({
      _id: 'wn_1',
      webhookSubscription: 'ws_1',
      payload: { hello: 'world' },
      deliveryAttemptCount: 0,
      save: jest.fn().mockResolvedValue(undefined),
    })

    it('signs the payload with timestamped X-TextBee-Signature and legacy X-Signature headers', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      const sub = activeSubscription()
      const notif = notification()
      webhookNotificationModel.findById.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(sub)
      mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

      await service.attemptWebhookDelivery('wn_1')

      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      const [, , config] = mockedAxios.post.mock.calls[0]
      const headers = (config as any).headers

      const rawPayload = JSON.stringify(notif.payload)
      const timestamp = headers['X-Signature-Timestamp']
      expect(timestamp).toBeDefined()
      expect(Number(timestamp)).toBeGreaterThan(0)

      const expectedTimestampedSig = crypto
        .createHmac('sha256', sub.signingSecret)
        .update(`${timestamp}.${rawPayload}`)
        .digest('hex')

      const expectedLegacySig = crypto
        .createHmac('sha256', sub.signingSecret)
        .update(rawPayload)
        .digest('hex')

      expect(headers['X-TextBee-Signature']).toBe(
        `t=${timestamp},v1=${expectedTimestampedSig}`,
      )
      expect(headers['X-Signature']).toBe(expectedLegacySig)
    })

    it('produces a different signature when the secret differs', async () => {
      const payload = { hello: 'world' }
      const sig = (secret: string) =>
        crypto
          .createHmac('sha256', secret)
          .update(JSON.stringify(payload))
          .digest('hex')
      expect(sig('a-signing-secret-of-enough-length')).not.toBe(
        sig('a-different-secret-of-enough-length'),
      )
    })

    it('aborts delivery without calling axios when the subscription is inactive', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      const notif = notification()
      webhookNotificationModel.findById.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(
        activeSubscription({ isActive: false }),
      )

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
      expect(notif.save).toHaveBeenCalledTimes(1)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })

    it('aborts delivery when the subscription has been soft-deleted', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      const notif = notification()
      webhookNotificationModel.findById.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(
        activeSubscription({ deletedAt: new Date() }),
      )

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })
  })
})
