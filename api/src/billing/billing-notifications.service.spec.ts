import { Types } from 'mongoose'
import {
  BillingNotificationsService,
  emailAttemptCovers,
} from './billing-notifications.service'
import { BillingNotificationType } from './schemas/billing-notification.schema'

describe('BillingNotificationsService - notifyOnce', () => {
  const userId = new Types.ObjectId().toString()
  const type = BillingNotificationType.MONTHLY_LIMIT_REACHED
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600 * 1000)
  const today = () => new Date().toISOString().slice(0, 10)

  let model: { findOne: jest.Mock; findOneAndUpdate: jest.Mock }
  let queue: { add: jest.Mock }
  let service: BillingNotificationsService

  const storedDoc = (fields: Record<string, any> = {}) => ({
    _id: 'n1',
    user: userId,
    type,
    title: 'title',
    message: 'message',
    meta: {},
    updatedAt: hoursAgo(2),
    ...fields,
  })

  const notify = (extra: Record<string, any> = {}) =>
    service.notifyOnce({
      userId,
      type,
      title: 'title',
      message: 'message',
      emailKey: 'U2',
      ...extra,
    })

  beforeEach(() => {
    model = { findOne: jest.fn(), findOneAndUpdate: jest.fn() }
    queue = { add: jest.fn().mockResolvedValue(undefined) }
    service = new BillingNotificationsService(model as any, queue as any)
  })

  it('creates the notice and queues the first email', async () => {
    model.findOne.mockResolvedValue(null)
    model.findOneAndUpdate.mockResolvedValue(storedDoc())

    await notify()

    expect(model.findOneAndUpdate.mock.calls[0][1].$set).toEqual({
      title: 'title',
      message: 'message',
      meta: {},
    })
    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(queue.add.mock.calls[0][1]).toMatchObject({ emailKey: 'U2', sendEmail: true })
    expect(queue.add.mock.calls[0][2]).toMatchObject({
      jobId: 'n1:U2:0',
      removeOnComplete: true,
      removeOnFail: true,
    })
  })

  it('refreshes the in-app notice at most once an hour', async () => {
    model.findOne.mockResolvedValue(storedDoc({ updatedAt: hoursAgo(0.5) }))

    await notify({ emailKey: null })

    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('refreshes the in-app notice at once when its text changed', async () => {
    model.findOne.mockResolvedValue(
      storedDoc({ updatedAt: hoursAgo(0.1), title: 'Your batch did not fit' }),
    )
    model.findOneAndUpdate.mockResolvedValue(storedDoc())

    await notify({ emailKey: null })

    expect(model.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
      title: 'title',
      message: 'message',
    })
  })

  it('keeps an in-app notice without queueing an email when there is no template', async () => {
    model.findOne.mockResolvedValue(null)
    model.findOneAndUpdate.mockResolvedValue(storedDoc())

    await notify({ emailKey: null })

    expect(model.findOneAndUpdate).toHaveBeenCalled()
    expect(queue.add).not.toHaveBeenCalled()
  })

  it.each([
    ['sent 10 days ago', 'sent', 240],
    ['skipped 10 days ago', 'skipped', 240],
    ['failed 30 minutes ago', 'failed', 0.5],
  ])('does not queue U2 again when it was %s', async (_l, result, hours) => {
    model.findOne.mockResolvedValue(
      storedDoc({
        updatedAt: hoursAgo(0.1),
        lastEmailKey: 'U2',
        lastEmailResult: result,
        lastEmailAttemptAt: hoursAgo(hours),
      }),
    )

    await notify()

    expect(queue.add).not.toHaveBeenCalled()
  })

  it('retries a failed email after an hour', async () => {
    const attempt = hoursAgo(2)
    model.findOne.mockResolvedValue(
      storedDoc({
        updatedAt: hoursAgo(0.1),
        lastEmailKey: 'U2',
        lastEmailResult: 'failed',
        lastEmailAttemptAt: attempt,
      }),
    )

    await notify()

    expect(queue.add.mock.calls[0][2].jobId).toBe(`n1:U2:${attempt.getTime()}`)
  })

  it('does not let one plan variant hold back another', async () => {
    model.findOne.mockResolvedValue(
      storedDoc({
        updatedAt: hoursAgo(0.1),
        lastEmailKey: 'U2',
        lastEmailResult: 'sent',
        lastEmailAttemptAt: hoursAgo(24),
      }),
    )

    await notify({ emailKey: 'U2_paid' })

    expect(queue.add.mock.calls[0][1].emailKey).toBe('U2_paid')
  })

  it('records the hit day even when the notice is fresh and the email is covered', async () => {
    const covered = storedDoc({
      updatedAt: hoursAgo(0.1),
      lastEmailKey: 'U2',
      lastEmailResult: 'sent',
      lastEmailAttemptAt: hoursAgo(1),
    })
    model.findOne.mockResolvedValue(covered)
    model.findOneAndUpdate.mockResolvedValue(covered)

    await notify({ recordHit: true })

    const [filter, update, options] = model.findOneAndUpdate.mock.calls[0]
    expect(filter).toEqual({ user: expect.any(Types.ObjectId), type })
    expect(update.$addToSet).toEqual({ hitDays: today() })
    expect(update.$set).toEqual({ lastHitAt: expect.any(Date) })
    expect(update.$setOnInsert).toMatchObject({ title: 'title', message: 'message' })
    expect(options).toMatchObject({ upsert: true })
    expect(queue.add).not.toHaveBeenCalled()
  })

  it('creates the row with the hit day when it is missing', async () => {
    model.findOne.mockResolvedValue(null)
    model.findOneAndUpdate.mockResolvedValue(storedDoc())

    await notify({
      type: BillingNotificationType.DAILY_LIMIT_REACHED,
      title: 'Your batch did not fit',
      recordHit: true,
      emailKey: 'U5',
    })

    const [filter, update, options] = model.findOneAndUpdate.mock.calls[0]
    expect(filter.type).toBe(BillingNotificationType.DAILY_LIMIT_REACHED)
    expect(update.$set).toMatchObject({ title: 'Your batch did not fit', lastHitAt: expect.any(Date) })
    expect(update.$addToSet).toEqual({ hitDays: today() })
    expect(update.$setOnInsert).toMatchObject({ type: BillingNotificationType.DAILY_LIMIT_REACHED })
    expect(options).toMatchObject({ upsert: true })
  })

  it('queues the figures of this event, not the stored notice', async () => {
    model.findOne.mockResolvedValue(storedDoc({ updatedAt: hoursAgo(0.1), meta: { old: true } }))

    await notify({ emailKey: 'U5', meta: { roomWindow: 'daily', roomLeft: 1 } })

    expect(queue.add.mock.calls[0][1].meta).toEqual({ roomWindow: 'daily', roomLeft: 1 })
  })

  it('skips the hit write when the day is recorded and the last hit is recent', async () => {
    model.findOne.mockResolvedValue(
      storedDoc({
        updatedAt: hoursAgo(0.1),
        hitDays: [today()],
        lastHitAt: new Date(Date.now() - 10_000),
      }),
    )

    await notify({ recordHit: true, emailKey: null })

    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })
})

describe('emailAttemptCovers', () => {
  const now = new Date('2026-09-27T12:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)

  it('uses each template window', () => {
    const doc = (key: string, days: number) => ({
      lastEmailKey: key,
      lastEmailResult: 'sent' as const,
      lastEmailAttemptAt: daysAgo(days),
    })
    expect(emailAttemptCovers(doc('U4', 6), 'U4', now)).toBe(true)
    expect(emailAttemptCovers(doc('U4', 8), 'U4', now)).toBe(false)
    expect(emailAttemptCovers(doc('U1', 29), 'U1', now)).toBe(true)
    expect(emailAttemptCovers(doc('U1', 31), 'U1', now)).toBe(false)
    expect(emailAttemptCovers(null, 'U1', now)).toBe(false)
  })
})
