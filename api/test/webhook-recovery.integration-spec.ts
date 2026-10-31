import axios from 'axios'
import { randomUUID } from 'crypto'
import { Connection, createConnection, Model, Types } from 'mongoose'
import { WebhookEvent } from '../src/webhook/webhook-event.enum'
import { WebhookService } from '../src/webhook/webhook.service'
import {
  WebhookNotificationDocument,
  WebhookNotificationSchema,
} from '../src/webhook/schemas/webhook-notification.schema'
import {
  WebhookSubscriptionDocument,
  WebhookSubscriptionSchema,
} from '../src/webhook/schemas/webhook-subscription.schema'

// Run against a disposable MongoDB server; Redis and HTTP delivery are mocked:
// WEBHOOK_TEST_MONGO_URI=mongodb://127.0.0.1:27017 pnpm exec jest \
//   --config test/jest-webhook-recovery.json --runInBand
// Each run creates and drops its own randomly named database.
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>
const minute = 60 * 1000
const day = 24 * 60 * minute
const ago = (milliseconds: number) => new Date(Date.now() - milliseconds)

describe('Webhook retry recovery with MongoDB', () => {
  let connection: Connection
  let notifications: Model<WebhookNotificationDocument>
  let subscriptions: Model<WebhookSubscriptionDocument>
  let subscription: WebhookSubscriptionDocument
  let service: WebhookService
  const queue = { addWebhookDeliveryJob: jest.fn() }

  beforeAll(async () => {
    const uri = process.env.WEBHOOK_TEST_MONGO_URI
    if (!uri) {
      throw new Error(
        'Set WEBHOOK_TEST_MONGO_URI to a disposable MongoDB server',
      )
    }
    connection = createConnection(uri, {
      dbName: `textbee_webhook_recovery_${randomUUID().replace(/-/g, '')}`,
      serverSelectionTimeoutMS: 5000,
    })
    await connection.asPromise()
    notifications = connection.model<WebhookNotificationDocument>(
      'WebhookNotification',
      WebhookNotificationSchema,
    )
    subscriptions = connection.model<WebhookSubscriptionDocument>(
      'WebhookSubscription',
      WebhookSubscriptionSchema,
    )
    service = new WebhookService(
      subscriptions,
      notifications,
      queue as any,
      {} as any,
      {} as any,
    )
  })

  beforeEach(async () => {
    await notifications.deleteMany({})
    await subscriptions.deleteMany({})
    queue.addWebhookDeliveryJob.mockReset().mockResolvedValue(undefined)
    mockedAxios.post.mockReset().mockResolvedValue({ status: 200, data: 'ok' })
    subscription = await subscriptions.create({
      user: new Types.ObjectId(),
      deliveryUrl: 'https://example.com/hook',
      signingSecret: 'test-signing-secret-at-least-20-characters',
      events: [WebhookEvent.MESSAGE_SENT],
    })
  })

  afterAll(async () => {
    if (connection?.readyState === 1) {
      await connection.dropDatabase()
    }
    await connection?.close()
  })

  const insertNotification = async (
    overrides: Record<string, unknown> = {},
  ) => {
    // Use raw inserts to retain the distinction between null and missing dates,
    // and to set creation times without Mongoose's timestamp middleware.
    const document = {
      _id: new Types.ObjectId(),
      webhookSubscription: subscription._id,
      event: WebhookEvent.MESSAGE_SENT,
      payload: {},
      deliveryAttemptCount: 0,
      createdAt: ago(10 * minute),
      ...overrides,
    }
    await notifications.collection.insertOne(document)
    return document._id.toString()
  }

  it.each(['missing', 'null'])(
    'recovers a lost first job with a %s retry date',
    async (dateState) => {
      await service.deliverNotification({
        user: { _id: subscription.user },
        sms: { _id: new Types.ObjectId(), message: 'hello', status: 'sent' },
        event: WebhookEvent.MESSAGE_SENT,
      })
      const notification = await notifications.findOne().lean()
      expect(notification.nextDeliveryAttemptAt).toBeUndefined()
      expect(queue.addWebhookDeliveryJob).toHaveBeenCalledTimes(1)

      // The initial job was accepted, but never reached the worker.
      queue.addWebhookDeliveryJob.mockClear()
      await notifications.collection.updateOne(
        { _id: notification._id },
        {
          $set: {
            createdAt: ago(10 * minute),
            ...(dateState === 'null' ? { nextDeliveryAttemptAt: null } : {}),
          },
        },
      )

      await service.checkForNotificationsToDeliver()

      const id = notification._id.toString()
      expect(queue.addWebhookDeliveryJob.mock.calls).toEqual([[id]])
      // The recovered job and a late copy of the original must share the claim.
      await Promise.all([
        service.attemptWebhookDelivery(id),
        service.attemptWebhookDelivery(id),
      ])
      expect(mockedAxios.post).toHaveBeenCalledTimes(1)
      const delivered = await notifications.findById(id).lean()
      expect(delivered.deliveredAt).toBeInstanceOf(Date)
      expect(delivered.idempotencyKey).toBe(notification.idempotencyKey)
      expect(delivered.deliveryAttemptCount).toBe(1)
    },
  )

  it('still queues an overdue retry after an HTTP delivery failure', async () => {
    const id = await insertNotification({
      deliveryAttemptCount: 2,
      nextDeliveryAttemptAt: ago(10 * minute),
    })

    await service.checkForNotificationsToDeliver()

    expect(queue.addWebhookDeliveryJob.mock.calls).toEqual([[id]])
  })

  it.each([
    ['recent first attempt', () => ({ createdAt: ago(minute) })],
    [
      'recent first attempt with null date',
      () => ({ createdAt: ago(minute), nextDeliveryAttemptAt: null }),
    ],
    ['delivered notification', () => ({ deliveredAt: ago(minute) })],
    ['aborted notification', () => ({ deliveryAttemptAbortedAt: ago(minute) })],
    [
      'exhausted retries',
      () => ({
        deliveryAttemptCount: 10,
        nextDeliveryAttemptAt: ago(10 * minute),
      }),
    ],
    [
      'future retry',
      () => ({ deliveryAttemptCount: 1, nextDeliveryAttemptAt: ago(-minute) }),
    ],
    [
      'retry within the grace period',
      () => ({ deliveryAttemptCount: 1, nextDeliveryAttemptAt: ago(minute) }),
    ],
    [
      'first attempt claimed by a worker',
      () => ({ nextDeliveryAttemptAt: ago(-minute) }),
    ],
    [
      'attempted notification with no retry date',
      () => ({ deliveryAttemptCount: 1 }),
    ],
    [
      'attempted notification with null retry date',
      () => ({ deliveryAttemptCount: 1, nextDeliveryAttemptAt: null }),
    ],
  ] as const)('does not queue a %s', async (_name, fields) => {
    await insertNotification(fields())

    await service.checkForNotificationsToDeliver()

    expect(queue.addWebhookDeliveryJob).not.toHaveBeenCalled()
  })

  it.each(['missing', 'null', 'overdue'])(
    'aborts a month-old pending notification with a %s retry date',
    async (dateState) => {
      const id = await insertNotification({
        createdAt: ago(31 * day),
        ...(dateState === 'null' ? { nextDeliveryAttemptAt: null } : {}),
        ...(dateState === 'overdue'
          ? { nextDeliveryAttemptAt: ago(10 * minute), deliveryAttemptCount: 1 }
          : {}),
      })

      await service.checkForNotificationsToDeliver()

      expect(queue.addWebhookDeliveryJob).not.toHaveBeenCalled()
      const expired = await notifications.findById(id).lean()
      expect(expired.deliveryAttemptAbortedAt).toBeInstanceOf(Date)
    },
  )

  it('keeps the sweep limited to 200 notifications', async () => {
    for (let i = 0; i < 201; i++) {
      await insertNotification()
    }

    await service.checkForNotificationsToDeliver()

    expect(queue.addWebhookDeliveryJob).toHaveBeenCalledTimes(200)
    const ids = queue.addWebhookDeliveryJob.mock.calls.map(([id]) => id)
    expect(new Set(ids).size).toBe(200)
  })
})
