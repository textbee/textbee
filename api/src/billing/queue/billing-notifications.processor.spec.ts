import { Types } from 'mongoose'
import { BillingNotificationsProcessor } from './billing-notifications.processor'
import { BillingNotificationType } from '../schemas/billing-notification.schema'

const chain = (value: any) => {
  const c: any = {
    sort: jest.fn(() => c),
    select: jest.fn(() => c),
    lean: jest.fn().mockResolvedValue(value),
  }
  return c
}

describe('BillingNotificationsProcessor', () => {
  const userId = new Types.ObjectId()
  const now = new Date('2026-09-27T12:00:00Z')

  let mail: { sendTemplated: jest.Mock }
  let notifications: { updateOne: jest.Mock }
  let users: { findById: jest.Mock }
  let sentEmails: { findOne: jest.Mock; countDocuments: jest.Mock }
  let plans: { find: jest.Mock }
  let sms: { findOne: jest.Mock }
  let devices: { findOne: jest.Mock }
  let processor: BillingNotificationsProcessor

  const job = (emailKey: string | undefined, meta: Record<string, any> = {}) =>
    ({
      data: {
        notificationId: 'n1',
        userId,
        type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
        title: 'title',
        message: 'message',
        meta,
        createdAt: now,
        sendEmail: true,
        emailKey,
      },
    }) as any

  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['nextTick', 'setImmediate'] })
    mail = { sendTemplated: jest.fn().mockResolvedValue('sent') }
    notifications = { updateOne: jest.fn().mockResolvedValue(undefined) }
    users = { findById: jest.fn(() => chain({ signupCountry: 'GB' })) }
    sentEmails = {
      findOne: jest.fn(() => chain(null)),
      countDocuments: jest.fn().mockResolvedValue(0),
    }
    plans = {
      find: jest.fn(() =>
        chain([
          { name: 'pro', monthlyLimit: 5000, deviceLimit: 5 },
          { name: 'scale', monthlyLimit: 25000, deviceLimit: 15 },
        ]),
      ),
    }
    sms = { findOne: jest.fn(() => chain({ createdAt: new Date('2026-09-02T08:00:00Z') })) }
    devices = { findOne: jest.fn(() => chain({ name: 'Pixel\u0000 6a' })) }
    processor = new BillingNotificationsProcessor(
      mail as any,
      notifications as any,
      users as any,
      sentEmails as any,
      plans as any,
      sms as any,
      devices as any,
    )
  })

  afterEach(() => jest.useRealTimers())

  it('sends U2 with plan limits and the date the next slot opens', async () => {
    await processor.handleSend(
      job('U2', { processedSmsLastMonth: 300, monthlyLimit: 300, planName: 'free' }),
    )

    const sent = mail.sendTemplated.mock.calls[0][0]
    expect(sent).toMatchObject({
      key: 'U2',
      userId,
      meta: { billingNotificationId: 'n1' },
      vars: {
        used: '300',
        limit: '300',
        proMonthlyLimit: '5,000',
        proDeviceLimit: '5',
        usageLabel: 'Messages in the last 30 days',
        upgradeUrl: 'https://app.textbee.dev/checkout/pro?billingInterval=monthly',
        // window 27 Aug to 27 Sep is 31 days; oldest message 2 Sep
        resetDate: '3 October',
      },
    })
    expect(notifications.updateOne).toHaveBeenCalledWith(
      { _id: 'n1' },
      {
        $set: {
          lastEmailKey: 'U2',
          lastEmailAttemptAt: now,
          lastEmailResult: 'sent',
          lastEmailSentAt: now,
        },
        $inc: { sentEmailCount: 1 },
      },
    )
  })

  it('names the paid plan and its headroom', async () => {
    await processor.handleSend(
      job('U1_paid', { processedSmsLastMonth: 4100, monthlyLimit: 5000, planName: 'pro' }),
    )

    expect(mail.sendTemplated.mock.calls[0][0].vars).toMatchObject({
      planName: 'Pro',
      used: '4,100',
      limit: '5,000',
      left: '900',
      headroomPercent: '10%',
    })
  })

  it('adds local midnight for a single time zone country', async () => {
    await processor.handleSend(
      job('U4', { processedSmsToday: 50, dailyLimit: 50, planName: 'free' }),
    )

    expect(mail.sendTemplated.mock.calls[0][0].vars).toMatchObject({
      used: '50',
      limit: '50',
      localMidnight: '01:00',
      usageLabel: 'Messages used today',
    })
  })

  it('fills the batch size version of U5', async () => {
    await processor.handleSend(job('U5', { attempted: 120, bulkSendLimit: 50 }))

    expect(mail.sendTemplated.mock.calls[0][0].vars).toMatchObject({
      attempted: '120',
      bulkLimit: '50',
      roomLeft: '',
      roomWindow: '',
      roomResetNote: '',
    })
  })

  it.each([
    ['daily', 1, '1 message', 'left today', 'midnight UTC'],
    ['monthly', 10, '10 messages', 'left in your 30-day allowance', 'older messages leave the 30-day count'],
  ])('fills the %s room version of U5', async (roomWindow, roomLeft, left, windowText, note) => {
    await processor.handleSend(
      job('U5', { attempted: 5, bulkSendLimit: 50, roomWindow, roomLeft }),
    )

    expect(mail.sendTemplated.mock.calls[0][0].vars).toMatchObject({
      attempted: '5',
      bulkLimit: '',
      roomLeft: left,
      roomWindow: windowText,
      roomResetNote: note,
    })
  })

  it('shares the U5 window between both versions', async () => {
    const lastSent = new Date(now.getTime() - 2 * 86400000)
    sentEmails.findOne.mockImplementation(() => chain({ sentAt: lastSent }))

    await processor.handleSend(job('U5', { attempted: 5, roomWindow: 'daily', roomLeft: 1 }))

    expect(mail.sendTemplated).not.toHaveBeenCalled()
    expect(sentEmails.findOne.mock.calls[0][0]).toMatchObject({ type: 'U5', status: 'sent' })
  })

  it('cleans the device name for U6', async () => {
    await processor.handleSend(job('U6', { deviceLimit: 1, planName: 'free' }))

    expect(mail.sendTemplated.mock.calls[0][0].vars.deviceName).toBe('Pixel 6a')
  })

  it('falls back to "your phone" without a named device', async () => {
    devices.findOne.mockImplementation(() => chain(null))

    await processor.handleSend(job('U6', { planName: 'free' }))

    expect(mail.sendTemplated.mock.calls[0][0].vars.deviceName).toBe('your phone')
  })

  it.each([
    ['U2', 30],
    ['U6_paid', 30],
    ['U3', 7],
    ['U5', 7],
  ])('skips %s already sent in the last %i days and records when', async (key, days) => {
    const lastSent = new Date(now.getTime() - 86400000)
    sentEmails.findOne.mockImplementation(() => chain({ sentAt: lastSent }))

    await processor.handleSend(job(key, {}))

    expect(mail.sendTemplated).not.toHaveBeenCalled()
    const filter = sentEmails.findOne.mock.calls[0][0]
    expect(filter).toMatchObject({ type: key, status: 'sent' })
    expect(now.getTime() - filter.sentAt.$gte.getTime()).toBe(days * 86400000)
    expect(notifications.updateOne).toHaveBeenCalledWith(
      { _id: 'n1' },
      { $set: { lastEmailKey: key, lastEmailAttemptAt: lastSent, lastEmailResult: 'skipped' } },
    )
  })

  it('sends U4 at most three times in 90 days', async () => {
    sentEmails.countDocuments.mockResolvedValue(3)

    await processor.handleSend(job('U4', {}))

    expect(mail.sendTemplated).not.toHaveBeenCalled()
    const filter = sentEmails.countDocuments.mock.calls[0][0]
    expect(now.getTime() - filter.sentAt.$gte.getTime()).toBe(90 * 86400000)
  })

  it('sends U4 when two went out in 90 days and none this week', async () => {
    sentEmails.countDocuments.mockResolvedValue(2)

    await processor.handleSend(job('U4', { processedSmsToday: 50, dailyLimit: 50 }))

    expect(mail.sendTemplated).toHaveBeenCalledTimes(1)
  })

  it('drops a job without a template key', async () => {
    await processor.handleSend(job(undefined))

    expect(mail.sendTemplated).not.toHaveBeenCalled()
  })

  it.each(['skipped', 'failed'])(
    'records a %s attempt without marking the notice as emailed',
    async (result) => {
      mail.sendTemplated.mockResolvedValue(result)

      await processor.handleSend(job('U5', { attempted: 120, bulkSendLimit: 50 }))

      expect(notifications.updateOne).toHaveBeenCalledWith(
        { _id: 'n1' },
        { $set: { lastEmailKey: 'U5', lastEmailAttemptAt: now, lastEmailResult: result } },
      )
    },
  )

  it('logs a failed email job', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    processor.onFailed(job('U2'), new Error('smtp down'))

    expect(error).toHaveBeenCalledWith(
      'billing notification email failed',
      expect.objectContaining({ notificationId: 'n1', error: 'smtp down' }),
    )
    error.mockRestore()
  })
})
