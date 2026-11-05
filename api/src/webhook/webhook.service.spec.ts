import { HttpException } from '@nestjs/common'
import * as crypto from 'crypto'
import axios from 'axios'
import * as dns from 'dns'
import { WebhookService, redactDeliveryUrl } from './webhook.service'

jest.mock('axios')
jest.mock('dns')
const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedDnsLookup = dns.lookup as unknown as jest.Mock

const build = () => {
  const webhookSubscriptionModel: any = {
    findById: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn().mockResolvedValue(undefined),
  }
  const webhookNotificationModel: any = { findOneAndUpdate: jest.fn() }

  const service = new WebhookService(
    webhookSubscriptionModel,
    webhookNotificationModel,
    {} as any, // webhookQueueService
    {} as any, // mailService
    {} as any, // usersService
  )

  return { service, webhookSubscriptionModel, webhookNotificationModel }
}

describe('redactDeliveryUrl', () => {
  it('drops userinfo and the query string', () => {
    expect(redactDeliveryUrl('https://user:pass@example.com/hook?token=secret')).toBe(
      'https://example.com/hook',
    )
  })

  it('keeps origin and path when there is nothing sensitive', () => {
    expect(redactDeliveryUrl('https://example.com/hook')).toBe(
      'https://example.com/hook',
    )
  })

  it('returns a placeholder for an unparseable url', () => {
    expect(redactDeliveryUrl('not-a-url')).toBe('[unparseable url]')
  })

  it('returns an empty string for an empty url', () => {
    expect(redactDeliveryUrl('')).toBe('')
  })
})

describe('WebhookService', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('validateDeliveryUrl (SSRF guard)', () => {
    const validate = (service: WebhookService, url: string) =>
      (service as any).validateDeliveryUrl(url)

    it('accepts a normal https URL', () => {
      const { service } = build()
      expect(() => validate(service, 'https://example.com/hook')).not.toThrow()
    })

    it.each([
      'ftp://example.com/hook',
      'file:///etc/passwd',
      'not-a-url',
    ])('rejects a non-http(s) or malformed URL: %s', (url) => {
      const { service } = build()
      expect(() => validate(service, url)).toThrow(HttpException)
    })

    it.each([
      'http://localhost/hook',
      'http://127.0.0.1/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://169.254.169.254/latest/meta-data', // cloud metadata IP
      'http://172.16.0.1/hook',
      'http://[::ffff:7f00:1]/hook', // hex IPv4-mapped loopback
      'http://[::ffff:127.0.0.1]/hook',
      'http://[fe81::1]/hook',
      'http://[febf::1]/hook',
      'http://0.0.0.0/hook',
      'http://224.0.0.1/hook',
    ])('rejects a private or loopback host: %s', (url) => {
      const { service } = build()
      expect(() => validate(service, url)).toThrow(HttpException)
    })
  })

  describe('isBlockedIpAddress', () => {
    const blocked = (service: WebhookService, ip: string) =>
      (service as any).isBlockedIpAddress(ip)

    it.each([
      '10.0.0.5',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.10',
      '100.64.0.1',
      '::1',
      'fe80::1',
      'fd00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a00:1',
      'fe81::1',
      'febf:ffff::1',
      'fc00::1',
      'fec0::1',
      'feff:ffff::1',
      '198.18.0.0',
      '198.19.255.255',
    ])('blocks private, loopback or link-local address: %s', (ip) => {
      const { service } = build()
      expect(blocked(service, ip)).toBe(true)
    })

    it.each([
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '::ffff:808:808',
      'fe7f::1',
      '198.17.255.255',
      '198.20.0.0',
      '2606:4700::1',
      'example.com',
    ])(
      'allows a public address: %s',
      (ip) => {
        const { service } = build()
        expect(blocked(service, ip)).toBe(false)
      },
    )
  })

  describe('guardedLookup (connection-time DNS guard)', () => {
    const resolveTo = (addresses: { address: string; family: number }[]) =>
      mockedDnsLookup.mockImplementation((_host, _opts, cb) =>
        cb(null, addresses),
      )

    it('refuses a connection when the hostname resolves to a private address', (done) => {
      const { service } = build()
      resolveTo([{ address: '10.99.0.50', family: 4 }])
      ;(service as any).guardedLookup('internal.example.com', {}, (err: any) => {
        expect(err).toBeInstanceOf(Error)
        done()
      })
    })

    it('allows a connection when the hostname resolves to a public address', (done) => {
      const { service } = build()
      resolveTo([{ address: '93.184.216.34', family: 4 }])
      ;(service as any).guardedLookup(
        'example.com',
        {},
        (err: any, address: string, family: number) => {
          expect(err).toBeNull()
          expect(address).toBe('93.184.216.34')
          expect(family).toBe(4)
          done()
        },
      )
    })

    it('returns address records when the caller asks for all addresses', (done) => {
      const { service } = build()
      resolveTo([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1::1', family: 6 },
      ])
      ;(service as any).guardedLookup(
        'example.com',
        { all: true },
        (err: any, addresses: { address: string; family: number }[]) => {
          expect(err).toBeNull()
          expect(addresses).toEqual([
            { address: '93.184.216.34', family: 4 },
            { address: '2606:2800:220:1::1', family: 6 },
          ])
          done()
        },
      )
    })

    it('refuses when any resolved address is private (rebinding across records)', (done) => {
      const { service } = build()
      resolveTo([
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])
      ;(service as any).guardedLookup('mixed.example.com', {}, (err: any) => {
        expect(err).toBeInstanceOf(Error)
        done()
      })
    })
  })

  describe('signing secret validation', () => {
    it('rejects a create with a secret shorter than 20 characters', async () => {
      const { service } = build()
      await expect(
        service.create({
          user: { _id: 'user_1' },
          createWebhookDto: {
            name: 'w',
            events: ['message.received'],
            deliveryUrl: 'https://example.com/hook',
            signingSecret: 'too-short',
          },
        }),
      ).rejects.toThrow(HttpException)
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
          updateWebhookDto: { signingSecret: 'short' },
        }),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('findWebhookNotificationsForUser', () => {
    it('removes device push tokens, serials and signing secrets from each page', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } =
        build()
      webhookSubscriptionModel.distinct = jest
        .fn()
        .mockResolvedValue(['664a9b8cd0e1f2a3b4c5d6e7'])
      webhookNotificationModel.aggregate = jest
        .fn()
        .mockResolvedValue([{ data: [], totalCount: 0 }])

      await service.findWebhookNotificationsForUser({ user: { _id: 'user_1' } })

      const pipeline = webhookNotificationModel.aggregate.mock.calls[0][0]
      const facet = pipeline.find((stage: any) => stage.$facet).$facet
      expect(facet.data).toContainEqual({
        $project: {
          'deviceData.fcmToken': 0,
          'deviceData.serial': 0,
          'webhookSubscriptionData.signingSecret': 0,
        },
      })
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

    it('signs the payload with HMAC-SHA256 of the signing secret', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const sub = activeSubscription()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(sub)
      mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

      await service.attemptWebhookDelivery('wn_1')

      const expected = crypto
        .createHmac('sha256', sub.signingSecret)
        .update(JSON.stringify(notif.payload))
        .digest('hex')

      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      const [, , config] = mockedAxios.post.mock.calls[0]
      expect((config as any).headers['X-Signature']).toBe(expected)
    })

    describe('timestamped signature', () => {
      const deliver = async () => {
        const { service, webhookSubscriptionModel, webhookNotificationModel } =
          build()
        const sub = activeSubscription()
        const notif = notification()
        webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
        webhookSubscriptionModel.findById.mockResolvedValue(sub)
        mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

        await service.attemptWebhookDelivery('wn_1')

        const [, body, config] = mockedAxios.post.mock.calls[0]
        return { sub, notif, body, headers: (config as any).headers, config: config as any }
      }

      afterEach(() => jest.restoreAllMocks())

      it('sends X-Textbee-Timestamp and X-Textbee-Signature', async () => {
        jest
          .spyOn(Date, 'now')
          .mockReturnValue(Date.parse('2026-11-05T12:00:00.000Z'))
        const { headers } = await deliver()

        const t = String(Date.parse('2026-11-05T12:00:00.000Z') / 1000)
        expect(headers['X-Textbee-Timestamp']).toBe(t)
        expect(headers['X-Textbee-Signature']).toMatch(
          new RegExp(`^t=${t},v1=[0-9a-f]{64}$`),
        )
      })

      it('v1 is the HMAC-SHA256 of "<t>.<body>" with the signing secret', async () => {
        const { sub, body, headers } = await deliver()

        const [tPart, v1Part] = headers['X-Textbee-Signature'].split(',')
        const t = tPart.slice('t='.length)
        const v1 = v1Part.slice('v1='.length)
        const expected = crypto
          .createHmac('sha256', sub.signingSecret)
          .update(`${t}.${body}`)
          .digest('hex')

        expect(t).toBe(headers['X-Textbee-Timestamp'])
        expect(v1).toBe(expected)
      })

      it('keeps the legacy X-Signature as the HMAC of the body alone', async () => {
        const { sub, body, headers } = await deliver()

        expect(headers['X-Signature']).toBe(
          crypto
            .createHmac('sha256', sub.signingSecret)
            .update(body as string)
            .digest('hex'),
        )
      })

      it('posts the exact signed string as a JSON body', async () => {
        const { notif, body, headers, config } = await deliver()

        expect(typeof body).toBe('string')
        expect(body).toBe(JSON.stringify(notif.payload))
        expect(headers['Content-Type']).toBe('application/json')
        // axios must pass the string through without re-serializing it
        for (const transform of config.transformRequest) {
          expect(transform(body, {})).toBe(body)
        }
      })

      it('signs each attempt with a fresh timestamp', async () => {
        const now = jest
          .spyOn(Date, 'now')
          .mockReturnValue(Date.parse('2026-11-05T12:00:00.000Z'))
        const first = (await deliver()).headers['X-Textbee-Timestamp']
        mockedAxios.post.mockClear()
        now.mockReturnValue(Date.parse('2026-11-05T12:05:00.000Z'))
        const second = (await deliver()).headers['X-Textbee-Timestamp']

        expect(Number(second) - Number(first)).toBe(300)
      })
    })

    it('follows redirects through the guarded agents', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
      mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

      await service.attemptWebhookDelivery('wn_1')

      const [, , config] = mockedAxios.post.mock.calls[0]
      expect((config as any).maxRedirects).toBe(5)
      expect(typeof (config as any).beforeRedirect).toBe('function')
      expect((config as any).proxy).toBe(false)
      expect((config as any).httpAgent).toBe((service as any).deliveryHttpAgent)
      expect((config as any).httpsAgent).toBe((service as any).deliveryHttpsAgent)
    })

    it('produces a different signature when the secret differs', async () => {
      const payload = { hello: 'world' }
      const sig = (secret: string) =>
        crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
      expect(sig('a-signing-secret-of-enough-length')).not.toBe(
        sig('a-different-secret-of-enough-length'),
      )
    })

    it.each(['127.0.0.1', '::ffff:7f00:1', '10.0.0.5', 'localhost'])(
      'refuses a redirect hop to %s',
      async (hostname) => {
        const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
        webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notification())
        webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
        mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

        await service.attemptWebhookDelivery('wn_1')

        const [, , config] = mockedAxios.post.mock.calls[0]
        expect(() => (config as any).beforeRedirect({ hostname })).toThrow()
      },
    )

    it('allows a redirect hop to a public host', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notification())
      webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
      mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

      await service.attemptWebhookDelivery('wn_1')

      const [, , config] = mockedAxios.post.mock.calls[0]
      expect(() =>
        (config as any).beforeRedirect({ hostname: 'script.googleusercontent.com' }),
      ).not.toThrow()
    })

    it('classifies an unfollowed 3xx like a 4xx', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
      mockedAxios.post.mockRejectedValue({ response: { status: 302, data: '' } })

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.errorType).toBe('non-retryable')
      expect(notif.httpStatusCode).toBe(302)
    })

    it.each([
      [0, false],
      [1, false],
      [2, true],
    ])(
      'retries a 4xx until the 3rd attempt (attempts before: %i, aborted: %s)',
      async (before, aborted) => {
        const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
        const notif = { ...notification(), deliveryAttemptCount: before }
        webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
        webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
        mockedAxios.post.mockRejectedValue({ response: { status: 404, data: 'nope' } })

        await service.attemptWebhookDelivery('wn_1')

        expect(notif.errorType).toBe('non-retryable')
        expect(notif.deliveryAttemptCount).toBe(before + 1)
        if (aborted) {
          expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
          expect(notif.nextDeliveryAttemptAt).toBeUndefined()
        } else {
          expect(notif.deliveryAttemptAbortedAt).toBeUndefined()
          expect(notif.nextDeliveryAttemptAt).toBeInstanceOf(Date)
        }
      },
    )

    it('still aborts a 5xx after the 10th attempt', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = { ...notification(), deliveryAttemptCount: 9 }
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
      mockedAxios.post.mockRejectedValue({ response: { status: 503, data: '' } })

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.errorType).toBe('retryable')
      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
    })

    it('does not deliver to a stored URL whose host is a private IP literal', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(
        activeSubscription({ deliveryUrl: 'http://[::ffff:7f00:1]:3001/' }),
      )

      await service.attemptWebhookDelivery('wn_1')

      expect(mockedAxios.post).not.toHaveBeenCalled()
      expect(notif.deliveredAt).toBeUndefined()
    })

    it('aborts delivery without calling axios when the subscription is inactive', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(
        activeSubscription({ isActive: false }),
      )

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
      expect(notif.save).toHaveBeenCalledTimes(1)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })

    it('aborts delivery when the subscription has been soft-deleted', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(
        activeSubscription({ deletedAt: new Date() }),
      )

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })

    it('claims only a pending notification that is due', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notification())
      webhookSubscriptionModel.findById.mockResolvedValue(activeSubscription())
      mockedAxios.post.mockResolvedValue({ status: 200, data: 'ok' })

      await service.attemptWebhookDelivery('wn_1')

      const [filter, update] = webhookNotificationModel.findOneAndUpdate.mock.calls[0]
      expect(filter).toMatchObject({
        _id: 'wn_1',
        deliveredAt: null,
        deliveryAttemptAbortedAt: null,
      })
      expect(filter.$or).toEqual([
        { nextDeliveryAttemptAt: null },
        { nextDeliveryAttemptAt: { $lte: expect.any(Date) } },
      ])
      expect(update.$set.nextDeliveryAttemptAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('sends nothing when the notification is already delivered or claimed', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(null)

      await service.attemptWebhookDelivery('wn_1')

      expect(webhookSubscriptionModel.findById).not.toHaveBeenCalled()
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })

    it('aborts a notification whose subscription no longer exists', async () => {
      const { service, webhookSubscriptionModel, webhookNotificationModel } = build()
      const notif = notification()
      webhookNotificationModel.findOneAndUpdate.mockResolvedValue(notif)
      webhookSubscriptionModel.findById.mockResolvedValue(null)

      await service.attemptWebhookDelivery('wn_1')

      expect(notif.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
      expect(mockedAxios.post).not.toHaveBeenCalled()
    })
  })
})

describe('WebhookService repeated reports', () => {
  const setup = (notifiedSubscriptionIds: string[]) => {
    const webhookSubscriptionModel: any = {
      find: jest.fn().mockResolvedValue([
        { _id: 'ws_1', deliveryUrl: 'https://example.com/a' },
        { _id: 'ws_2', deliveryUrl: 'https://example.com/b' },
      ]),
    }
    const webhookNotificationModel: any = {
      distinct: jest.fn().mockResolvedValue(notifiedSubscriptionIds),
      create: jest.fn().mockResolvedValue({ _id: 'wn_new' }),
    }
    const webhookQueueService: any = {
      addWebhookDeliveryJob: jest.fn().mockResolvedValue(undefined),
    }
    const service = new WebhookService(
      webhookSubscriptionModel,
      webhookNotificationModel,
      webhookQueueService,
      {} as any,
      {} as any,
    )
    return { service, webhookNotificationModel }
  }

  it('skips subscriptions already notified about this message and event', async () => {
    const { service, webhookNotificationModel } = setup(['ws_1'])

    await service.deliverNotification({
      sms: { _id: 's1', status: 'delivered' },
      user: { _id: 'u1' },
      event: 'MESSAGE_DELIVERED',
    })

    expect(webhookNotificationModel.distinct).toHaveBeenCalledWith('webhookSubscription', {
      sms: 's1',
      event: 'MESSAGE_DELIVERED',
      webhookSubscription: { $in: ['ws_1', 'ws_2'] },
      deliveryAttemptAbortedAt: null,
    })
    expect(webhookNotificationModel.create).toHaveBeenCalledTimes(1)
    expect(webhookNotificationModel.create.mock.calls[0][0].webhookSubscription).toBe('ws_2')
  })

  it('still sends every unknown-state report', async () => {
    const { service, webhookNotificationModel } = setup(['ws_1', 'ws_2'])

    await service.deliverNotification({
      sms: { _id: 's1', status: 'queued' },
      user: { _id: 'u1' },
      event: 'UNKNOWN_STATE',
    })

    expect(webhookNotificationModel.distinct).not.toHaveBeenCalled()
    expect(webhookNotificationModel.create).toHaveBeenCalledTimes(2)
  })

  it('leaves a notification due for retry when its job cannot be queued', async () => {
    const webhookSubscriptionModel: any = {
      find: jest.fn().mockResolvedValue([{ _id: 'ws_1', deliveryUrl: 'https://example.com/a' }]),
    }
    const webhookNotificationModel: any = {
      distinct: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ _id: 'wn_new' }),
      updateOne: jest.fn().mockResolvedValue(undefined),
    }
    const service = new WebhookService(
      webhookSubscriptionModel,
      webhookNotificationModel,
      { addWebhookDeliveryJob: jest.fn().mockRejectedValue(new Error('redis down')) } as any,
      {} as any,
      {} as any,
    )
    jest.spyOn(console, 'log').mockImplementation(() => undefined)

    await service.deliverNotification({
      sms: { _id: 's1', status: 'sent' },
      user: { _id: 'u1' },
      event: 'MESSAGE_SENT',
    })

    expect(webhookNotificationModel.updateOne).toHaveBeenCalledWith(
      { _id: 'wn_new' },
      { $set: { nextDeliveryAttemptAt: expect.any(Date) } },
    )
  })

  it('creates nothing when every subscription was already notified', async () => {
    const { service, webhookNotificationModel } = setup(['ws_1', 'ws_2'])

    await service.deliverNotification({
      sms: { _id: 's1', status: 'delivered' },
      user: { _id: 'u1' },
      event: 'MESSAGE_DELIVERED',
    })

    expect(webhookNotificationModel.create).not.toHaveBeenCalled()
  })
})

describe('WebhookService payload simUsed', () => {
  const setup = () => {
    const webhookSubscriptionModel: any = {
      find: jest.fn().mockResolvedValue([
        { _id: 'ws_1', deliveryUrl: 'https://example.com/hook' },
      ]),
    }
    const webhookNotificationModel: any = {
      distinct: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ _id: 'wn_1' }),
    }
    const webhookQueueService: any = {
      addWebhookDeliveryJob: jest.fn().mockResolvedValue(undefined),
    }
    const service = new WebhookService(
      webhookSubscriptionModel,
      webhookNotificationModel,
      webhookQueueService,
      {} as any,
      {} as any,
    )
    const payloadFor = async (sms: Record<string, unknown>, event: string) => {
      await service.deliverNotification({ sms, user: { _id: 'u1' }, event })
      return webhookNotificationModel.create.mock.calls[0][0].payload
    }
    return { payloadFor }
  }

  it('adds the SIM the phone reported', async () => {
    const payload = await setup().payloadFor(
      { _id: 's1', status: 'sent', simUsed: { subscriptionId: 19, slotIndex: 1 } },
      'MESSAGE_SENT',
    )

    expect(payload.simUsed).toEqual({ subscriptionId: 19, slotIndex: 1 })
  })

  it('passes every stored SIM detail through', async () => {
    const simUsed = {
      subscriptionId: 19,
      slotIndex: 1,
      carrierName: 'Smart',
      displayName: 'Work',
      countryIso: 'ph',
      mcc: '515',
      mnc: '03',
    }
    const payload = await setup().payloadFor(
      { _id: 's1', status: 'sent', simUsed },
      'MESSAGE_SENT',
    )

    expect(payload.simUsed).toEqual(simUsed)
  })

  it('adds it to received messages too', async () => {
    const payload = await setup().payloadFor(
      { _id: 's1', sender: '+15550100', simUsed: { slotIndex: 0 } },
      'MESSAGE_RECEIVED',
    )

    expect(payload.simUsed).toEqual({ slotIndex: 0 })
  })

  it('leaves the payload unchanged when no SIM was reported', async () => {
    const payload = await setup().payloadFor(
      { _id: 's1', status: 'sent', simSubscriptionId: 19 },
      'MESSAGE_SENT',
    )

    expect(payload).not.toHaveProperty('simUsed')
  })
})
