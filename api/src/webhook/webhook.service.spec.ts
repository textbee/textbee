import { HttpException } from '@nestjs/common'
import * as crypto from 'crypto'
import axios from 'axios'
import { WebhookService } from './webhook.service'
import { WebhookEvent } from './webhook-event.enum'

jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

const build = () => {
  const webhookSubscriptionModel: any = {
    find: jest.fn(),
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

    it('rejects create with null signingSecret', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: [WebhookEvent.MESSAGE_RECEIVED],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: null as any,
          },
        }),
      ).rejects.toThrow(HttpException)
    })

    it('rejects create with non-string signingSecret', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: [WebhookEvent.MESSAGE_RECEIVED],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: 12345678901234567890 as any,
          },
        }),
      ).rejects.toThrow(HttpException)
    })

    it('rejects create with whitespace-only signingSecret', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: [WebhookEvent.MESSAGE_RECEIVED],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: '                    ',
          },
        }),
      ).rejects.toThrow(HttpException)
    })

    it('rejects create with secret whose trimmed length is < 20', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: [WebhookEvent.MESSAGE_RECEIVED],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: '   short-secret   ',
          },
        }),
      ).rejects.toThrow(HttpException)
    })

    it('auto-generates a secure 64-char hex secret if signingSecret is omitted on create, persists encrypted, returns plaintext', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.countDocuments.mockResolvedValue(0)
      webhookSubscriptionModel.create.mockImplementation((args: any) =>
        Promise.resolve({ ...args, _id: 'ws_new' }),
      )

      const result = await service.create({
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
      expect(createdArgs.signingSecret.startsWith('enc:')).toBe(true)

      expect(result.signingSecret).toBeDefined()
      expect(result.signingSecret).toHaveLength(64)
      expect(/^[0-9a-f]{64}$/.test(result.signingSecret)).toBe(true)
    })

    it('accepts trimmed valid custom secret >= 20 characters on create', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.countDocuments.mockResolvedValue(0)
      webhookSubscriptionModel.create.mockImplementation((args: any) =>
        Promise.resolve({ ...args, _id: 'ws_new' }),
      )

      const customSecret = '   my-very-secure-custom-signing-secret-value   '
      const result = await service.create({
        user: { _id: 'user_1' },
        createWebhookDto: {
          name: 'custom secret webhook',
          events: [WebhookEvent.MESSAGE_RECEIVED],
          deliveryUrl: 'https://example.com/hook',
          signingSecret: customSecret,
        },
      })

      const createdArgs = webhookSubscriptionModel.create.mock.calls[0][0]
      expect(createdArgs.signingSecret.startsWith('enc:')).toBe(true)
      expect(result.signingSecret).toBe(customSecret.trim())
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

    it('rejects an update with null, non-string, or whitespace-only signingSecret', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.findOne.mockResolvedValue({
        signingSecret: 'a'.repeat(20),
        save: jest.fn(),
      })

      await expect(
        service.update({
          user: { _id: 'user_1' },
          webhookId: 'wh_1',
          updateWebhookDto: { signingSecret: null } as any,
        }),
      ).rejects.toThrow(HttpException)

      await expect(
        service.update({
          user: { _id: 'user_1' },
          webhookId: 'wh_1',
          updateWebhookDto: { signingSecret: 99999999999999999999 } as any,
        }),
      ).rejects.toThrow(HttpException)

      await expect(
        service.update({
          user: { _id: 'user_1' },
          webhookId: 'wh_1',
          updateWebhookDto: { signingSecret: '     ' } as any,
        }),
      ).rejects.toThrow(HttpException)
    })

    it('encrypts secret and redacts signingSecret on update', async () => {
      const { service, webhookSubscriptionModel } = build()
      const mockDoc: any = {
        _id: 'wh_1',
        name: 'test',
        signingSecret: 'enc:old',
        save: jest.fn().mockResolvedValue(undefined),
        toObject: function () {
          return { ...this }
        },
      }
      webhookSubscriptionModel.findOne.mockResolvedValue(mockDoc)

      const result = await service.update({
        user: { _id: 'user_1' },
        webhookId: 'wh_1',
        updateWebhookDto: {
          signingSecret: 'new-valid-secret-of-enough-length',
        } as any,
      })

      expect(mockDoc.signingSecret.startsWith('enc:')).toBe(true)
      expect(result.signingSecret).toBeUndefined()
    })
  })

  describe('redaction in read and list operations', () => {
    it('redacts signingSecret from findOne', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.findOne.mockResolvedValue({
        _id: 'ws_1',
        name: 'Webhook 1',
        signingSecret: 'enc:something',
        toObject: () => ({
          _id: 'ws_1',
          name: 'Webhook 1',
          signingSecret: 'enc:something',
        }),
      })

      const result = await service.findOne({
        user: { _id: 'user_1' },
        webhookId: 'ws_1',
      })

      expect(result.signingSecret).toBeUndefined()
      expect(result.name).toBe('Webhook 1')
    })

    it('redacts signingSecret from findWebhooksForUser', async () => {
      const { service, webhookSubscriptionModel } = build()
      webhookSubscriptionModel.find.mockResolvedValue([
        {
          _id: 'ws_1',
          name: 'Webhook 1',
          signingSecret: 'enc:something',
          toObject: () => ({
            _id: 'ws_1',
            name: 'Webhook 1',
            signingSecret: 'enc:something',
          }),
        },
      ])

      const result = await service.findWebhooksForUser({
        user: { _id: 'user_1' },
      })

      expect(result).toHaveLength(1)
      expect(result[0].signingSecret).toBeUndefined()
      expect(result[0].name).toBe('Webhook 1')
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

    it('signs the payload with timestamped X-TextBee-Signature and legacy X-Signature headers using encrypted secret', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      const rawSecret = 'a-signing-secret-of-enough-length'
      const encryptedSecret = (service as any).encryptSigningSecret(rawSecret)

      const sub = activeSubscription({ signingSecret: encryptedSecret })
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
        .createHmac('sha256', rawSecret)
        .update(`${timestamp}.${rawPayload}`)
        .digest('hex')

      const expectedLegacySig = crypto
        .createHmac('sha256', rawSecret)
        .update(rawPayload)
        .digest('hex')

      expect(headers['X-TextBee-Signature']).toBe(
        `t=${timestamp},v1=${expectedTimestampedSig}`,
      )
      expect(headers['X-Signature']).toBe(expectedLegacySig)
    })

    it('signs correctly with legacy unencrypted secret', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      const rawSecret = 'a-signing-secret-of-enough-length'
      const sub = activeSubscription({ signingSecret: rawSecret })
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

      const expectedTimestampedSig = crypto
        .createHmac('sha256', rawSecret)
        .update(`${timestamp}.${rawPayload}`)
        .digest('hex')

      expect(headers['X-TextBee-Signature']).toBe(
        `t=${timestamp},v1=${expectedTimestampedSig}`,
      )
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
