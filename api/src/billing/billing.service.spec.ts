import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { createHmac } from 'crypto'
import { errors } from '@polar-sh/sdk/2026-10'
import { Types } from 'mongoose'
import { BillingService } from './billing.service'
import { Plan } from './schemas/plan.schema'
import { Subscription } from './schemas/subscription.schema'
import { User } from '../users/schemas/user.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { PolarWebhookPayload } from './schemas/polar-webhook-payload.schema'
import { CheckoutSession } from './schemas/checkout-session.schema'
import { BillingNotificationsService } from './billing-notifications.service'
import { BillingNotificationType } from './schemas/billing-notification.schema'
import { UsersService } from '../users/users.service'
import { AnalyticsService } from '../analytics/analytics.service'

describe('BillingService - cancellation handling', () => {
  let service: BillingService

  // 24-hex string so `new Types.ObjectId(userId)` succeeds.
  const userId = '507f1f77bcf86cd799439011'
  const proPlan = { _id: 'plan_pro', name: 'pro' }
  const polarProductId = 'prod_pro_monthly'

  const mockPlanModel = {
    findOne: jest.fn(),
  }
  const mockSubscriptionModel = {
    updateOne: jest.fn(),
    updateMany: jest.fn(),
  }
  const emptyModel = {}
  const mockBillingNotifications = {}
  const mockUsersService = { markMilestone: jest.fn() }
  const mockAnalyticsService = {
    userRegistered: jest.fn(),
    checkoutStarted: jest.fn(),
    purchase: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
        {
          provide: getModelToken(Subscription.name),
          useValue: mockSubscriptionModel,
        },
        { provide: getModelToken(User.name), useValue: emptyModel },
        { provide: getModelToken(SMS.name), useValue: emptyModel },
        {
          provide: getModelToken(PolarWebhookPayload.name),
          useValue: emptyModel,
        },
        {
          provide: getModelToken(CheckoutSession.name),
          useValue: emptyModel,
        },
        {
          provide: BillingNotificationsService,
          useValue: mockBillingNotifications,
        },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)

    jest.clearAllMocks()
    mockUsersService.markMilestone.mockResolvedValue(false)
    mockPlanModel.findOne.mockResolvedValue(proPlan)
    mockSubscriptionModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
  })

  describe('cancelSubscription', () => {
    it('records the scheduled cancellation WITHOUT downgrading (keeps the plan active)', async () => {
      const currentPeriodEnd = new Date('2026-07-17T00:00:00.000Z')

      await service.cancelSubscription({
        userId,
        polarProductId,
        cancelAtPeriodEnd: true,
        currentPeriodEnd,
        status: 'active',
      })

      expect(mockSubscriptionModel.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update] = mockSubscriptionModel.updateOne.mock.calls[0]

      // Filter targets the user's active subscription for this plan.
      expect(filter).toEqual({
        user: expect.any(Types.ObjectId),
        plan: proPlan._id,
        isActive: true,
      })

      // The fix: the cancellation is recorded with the real period end, and
      // the subscription stays active. It must NOT flip isActive to false.
      expect(update).toEqual({
        cancelAtPeriodEnd: true,
        currentPeriodEnd,
        subscriptionEndDate: currentPeriodEnd,
        status: 'active',
      })
      expect(update).not.toHaveProperty('isActive')
    })

    it('defaults cancelAtPeriodEnd to true and omits period fields when not provided', async () => {
      await service.cancelSubscription({ userId, polarProductId })

      const [, update] = mockSubscriptionModel.updateOne.mock.calls[0]
      expect(update).toEqual({ cancelAtPeriodEnd: true })
      expect(update).not.toHaveProperty('currentPeriodEnd')
      expect(update).not.toHaveProperty('subscriptionEndDate')
      expect(update).not.toHaveProperty('isActive')
    })

    it('throws when no plan matches the Polar product id', async () => {
      mockPlanModel.findOne.mockResolvedValue(null)

      await expect(
        service.cancelSubscription({ userId, polarProductId: 'unknown' }),
      ).rejects.toThrow('No plan found for product ID: unknown')
      expect(mockSubscriptionModel.updateOne).not.toHaveBeenCalled()
    })

    it('writes the end cause on every row of the subscription, active or not', async () => {
      mockSubscriptionModel.updateMany.mockResolvedValue({})

      await service.cancelSubscription({
        userId,
        polarProductId,
        cancelAtPeriodEnd: false,
        status: 'canceled',
        churnCause: 'payment_failed',
        polarSubscriptionId: 'sub_1',
      })

      expect(mockSubscriptionModel.updateMany).toHaveBeenCalledWith(
        { polarSubscriptionId: 'sub_1' },
        { $set: { churnCause: 'payment_failed' } },
      )
      const [, update] = mockSubscriptionModel.updateOne.mock.calls[0]
      expect(update).not.toHaveProperty('churnCause')
    })

    it('keeps the end cause when the revoke arrives first', async () => {
      mockSubscriptionModel.updateMany.mockResolvedValue({})

      await service.revokeSubscription({ userId, polarProductId })
      // The revoke already deactivated the row, so the active-only update matches nothing.
      mockSubscriptionModel.updateOne.mockResolvedValue({ modifiedCount: 0 })
      await service.cancelSubscription({
        userId,
        polarProductId,
        churnCause: 'payment_failed',
        polarSubscriptionId: 'sub_1',
      })

      expect(mockSubscriptionModel.updateMany).toHaveBeenCalledWith(
        { polarSubscriptionId: 'sub_1' },
        { $set: { churnCause: 'payment_failed' } },
      )
    })

    it('leaves the end cause alone when the revoke arrives second', async () => {
      mockSubscriptionModel.updateMany.mockResolvedValue({})

      await service.cancelSubscription({
        userId,
        polarProductId,
        churnCause: 'payment_failed',
        polarSubscriptionId: 'sub_1',
      })
      await service.revokeSubscription({ userId, polarProductId })

      const revokeUpdate = mockSubscriptionModel.updateOne.mock.calls[1][1]
      expect(revokeUpdate).toEqual({ isActive: false, subscriptionEndDate: expect.any(Date) })
    })
  })

  describe('revokeSubscription', () => {
    it('performs the real downgrade by deactivating the subscription', async () => {
      await service.revokeSubscription({ userId, polarProductId })

      expect(mockSubscriptionModel.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update] = mockSubscriptionModel.updateOne.mock.calls[0]

      expect(filter).toEqual({
        user: expect.any(Types.ObjectId),
        plan: proPlan._id,
        isActive: true,
      })
      expect(update.isActive).toBe(false)
      expect(update.subscriptionEndDate).toBeInstanceOf(Date)
    })

    it('throws when no plan matches the Polar product id', async () => {
      mockPlanModel.findOne.mockResolvedValue(null)

      await expect(
        service.revokeSubscription({ userId, polarProductId: 'unknown' }),
      ).rejects.toThrow('No plan found for product ID: unknown')
      expect(mockSubscriptionModel.updateOne).not.toHaveBeenCalled()
    })
  })
})

// Pins apart three failures that used to share one misleading message.
describe('BillingService - checkout guards', () => {
  let service: BillingService

  const user = { _id: new Types.ObjectId('507f1f77bcf86cd799439011') }
  const req = { ip: '127.0.0.1' }

  const mockPlanModel = {
    findOne: jest.fn(),
  }
  const emptyModel = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
        { provide: getModelToken(Subscription.name), useValue: emptyModel },
        { provide: getModelToken(User.name), useValue: emptyModel },
        { provide: getModelToken(SMS.name), useValue: emptyModel },
        {
          provide: getModelToken(PolarWebhookPayload.name),
          useValue: emptyModel,
        },
        { provide: getModelToken(CheckoutSession.name), useValue: emptyModel },
        { provide: BillingNotificationsService, useValue: {} },
        { provide: UsersService, useValue: { markMilestone: jest.fn() } },
        { provide: AnalyticsService, useValue: { purchase: jest.fn(), checkoutStarted: jest.fn() } },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)
    jest.clearAllMocks()
  })

  it('names the real problem when the request carries no plan name', async () => {
    await expect(
      service.getCheckoutUrl({
        user,
        payload: { billingInterval: 'monthly' },
        req,
      }),
    ).rejects.toMatchObject({
      response: { code: 'PLAN_NAME_REQUIRED' },
    })

    // the plan is never looked up, so it can never be blamed
    expect(mockPlanModel.findOne).not.toHaveBeenCalled()
  })

  it('reports an unknown plan as not found, not as unpurchasable', async () => {
    mockPlanModel.findOne.mockResolvedValue(null)

    await expect(
      service.getCheckoutUrl({
        user,
        payload: { planName: 'enterprise', billingInterval: 'monthly' },
        req,
      }),
    ).rejects.toMatchObject({
      response: { code: 'PLAN_NOT_FOUND' },
    })
  })

  it('still rejects a real plan that has no Polar products', async () => {
    mockPlanModel.findOne.mockResolvedValue({ name: 'pro' })

    await expect(
      service.getCheckoutUrl({
        user,
        payload: { planName: 'pro', billingInterval: 'monthly' },
        req,
      }),
    ).rejects.toThrow('Plan cannot be purchased')
  })
})

describe('BillingService - syncCheckoutSessionStatus', () => {
  let service: BillingService

  const mockCheckoutSessionModel = {
    updateOne: jest.fn(),
  }
  const emptyModel = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: emptyModel },
        { provide: getModelToken(Subscription.name), useValue: emptyModel },
        { provide: getModelToken(User.name), useValue: emptyModel },
        { provide: getModelToken(SMS.name), useValue: emptyModel },
        {
          provide: getModelToken(PolarWebhookPayload.name),
          useValue: emptyModel,
        },
        {
          provide: getModelToken(CheckoutSession.name),
          useValue: mockCheckoutSessionModel,
        },
        { provide: BillingNotificationsService, useValue: {} },
        { provide: UsersService, useValue: { markMilestone: jest.fn() } },
        { provide: AnalyticsService, useValue: { purchase: jest.fn(), checkoutStarted: jest.fn() } },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)

    jest.clearAllMocks()
    mockCheckoutSessionModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
  })

  // Nothing wrote isCompleted before this existed, so a checkout the customer
  // had already paid for stayed reusable until it expired.
  it('marks a succeeded checkout completed', async () => {
    await service.syncCheckoutSessionStatus({
      checkoutSessionId: 'checkout_abc',
      status: 'succeeded',
    })

    expect(mockCheckoutSessionModel.updateOne).toHaveBeenCalledWith(
      { checkoutSessionId: 'checkout_abc' },
      expect.objectContaining({ isCompleted: true, completedAt: expect.any(Date) }),
    )
  })

  it('marks an expired checkout abandoned', async () => {
    await service.syncCheckoutSessionStatus({
      checkoutSessionId: 'checkout_abc',
      status: 'expired',
    })

    expect(mockCheckoutSessionModel.updateOne).toHaveBeenCalledWith(
      { checkoutSessionId: 'checkout_abc' },
      { isAbandoned: true },
    )
  })

  // open and confirmed are still in flight and failed is retryable, so the
  // cached checkout URL has to stay usable.
  it.each(['open', 'confirmed', 'failed'])(
    'leaves a %s checkout untouched',
    async (status) => {
      await service.syncCheckoutSessionStatus({
        checkoutSessionId: 'checkout_abc',
        status,
      })

      expect(mockCheckoutSessionModel.updateOne).not.toHaveBeenCalled()
    },
  )

  // The cache holds one row per user, so a late webhook for a checkout that has
  // since been replaced must match nothing rather than clobber the new row.
  it('keys on the checkout id, never on the user', async () => {
    await service.syncCheckoutSessionStatus({
      checkoutSessionId: 'checkout_stale',
      status: 'succeeded',
    })

    const [filter] = mockCheckoutSessionModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ checkoutSessionId: 'checkout_stale' })
    expect(filter).not.toHaveProperty('user')
  })

  it('ignores an event with no checkout id', async () => {
    await service.syncCheckoutSessionStatus({
      checkoutSessionId: undefined as any,
      status: 'succeeded',
    })

    expect(mockCheckoutSessionModel.updateOne).not.toHaveBeenCalled()
  })

  // A webhook handler that throws would make Polar retry the whole event.
  it('does not throw when the write fails', async () => {
    mockCheckoutSessionModel.updateOne.mockRejectedValue(new Error('db down'))

    await expect(
      service.syncCheckoutSessionStatus({
        checkoutSessionId: 'checkout_abc',
        status: 'succeeded',
      }),
    ).resolves.not.toThrow()
  })
})

describe('BillingService - canPerformAction account checks', () => {
  let service: BillingService

  const userId = '507f1f77bcf86cd799439011'
  const freePlan = { _id: 'plan_free', name: 'free', dailyLimit: 50, monthlyLimit: 300, bulkSendLimit: 50 }

  const select = jest.fn()
  const mockUserModel = { findById: jest.fn(() => ({ select })) }
  const mockSubscriptionModel = { findOne: jest.fn() }
  const mockPlanModel = { findOne: jest.fn(), findById: jest.fn() }
  const mockSmsModel = { countDocuments: jest.fn() }
  const mockBillingNotifications = { notifyOnce: jest.fn() }
  const emptyModel = {}

  const givenUser = (fields: Record<string, unknown> | null) =>
    select.mockResolvedValue(
      fields && { _id: userId, email: 'ada@example.com', isBanned: false, ...fields },
    )

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
        { provide: getModelToken(Subscription.name), useValue: mockSubscriptionModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(SMS.name), useValue: mockSmsModel },
        { provide: getModelToken(PolarWebhookPayload.name), useValue: emptyModel },
        { provide: getModelToken(CheckoutSession.name), useValue: emptyModel },
        { provide: BillingNotificationsService, useValue: mockBillingNotifications },
        { provide: UsersService, useValue: { markMilestone: jest.fn() } },
        { provide: AnalyticsService, useValue: { purchase: jest.fn(), checkoutStarted: jest.fn() } },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)

    jest.clearAllMocks()
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSubscriptionModel.findOne.mockResolvedValue(null)
    mockPlanModel.findOne.mockResolvedValue(freePlan)
    mockSmsModel.countDocuments.mockResolvedValue(0)
    mockBillingNotifications.notifyOnce.mockResolvedValue(undefined)
  })

  afterEach(() => jest.restoreAllMocks())

  it('loads the waiver field that is hidden by default', async () => {
    givenUser({ emailVerifiedAt: new Date() })

    await service.canPerformAction(userId, 'send_sms', 1)

    expect(select).toHaveBeenCalledWith('+emailVerificationWaivedAt')
  })

  it('blocks an account whose emailVerifiedAt was never written', async () => {
    givenUser({})

    await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
      response: { message: 'Please verify your email to continue' },
      status: 400,
    })
    expect(mockSmsModel.countDocuments).not.toHaveBeenCalled()
  })

  it('blocks an account whose emailVerifiedAt is null', async () => {
    givenUser({ emailVerifiedAt: null })

    await expect(service.canPerformAction(userId, 'receive_sms', 1)).rejects.toMatchObject({
      status: 400,
    })
  })

  it.each(['send_sms', 'bulk_send_sms', 'receive_sms'] as const)(
    'allows a verified account to %s',
    async (action) => {
      givenUser({ emailVerifiedAt: new Date() })

      await expect(service.canPerformAction(userId, action, 1)).resolves.toEqual({
        overLimit: false,
      })
    },
  )

  it('allows an unverified account with a waiver', async () => {
    givenUser({ emailVerificationWaivedAt: new Date() })

    await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
      overLimit: false,
    })
  })

  describe('LIMIT_EXEMPT_USER_IDS', () => {
    const originalExempt = process.env.LIMIT_EXEMPT_USER_IDS

    afterEach(() => {
      if (originalExempt === undefined) delete process.env.LIMIT_EXEMPT_USER_IDS
      else process.env.LIMIT_EXEMPT_USER_IDS = originalExempt
    })

    it.each(['send_sms', 'bulk_send_sms', 'receive_sms'] as const)(
      'skips usage limits for a listed account on %s',
      async (action) => {
        process.env.LIMIT_EXEMPT_USER_IDS = ` 64b000000000000000000001 , ${userId} `
        givenUser({ emailVerifiedAt: new Date() })
        mockSmsModel.countDocuments.mockResolvedValue(1000)

        await expect(service.canPerformAction(userId, action, 500)).resolves.toEqual({
          overLimit: false,
        })
        expect(mockSmsModel.countDocuments).not.toHaveBeenCalled()
      },
    )

    it('still enforces limits for an account that is not listed', async () => {
      process.env.LIMIT_EXEMPT_USER_IDS = '64b000000000000000000001'
      givenUser({ emailVerifiedAt: new Date() })
      mockSmsModel.countDocuments.mockResolvedValue(300)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
    })

    it('still requires a verified email for a listed account', async () => {
      process.env.LIMIT_EXEMPT_USER_IDS = userId
      givenUser({})

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 400,
      })
    })

    it('still blocks a banned listed account', async () => {
      process.env.LIMIT_EXEMPT_USER_IDS = userId
      givenUser({ emailVerifiedAt: new Date(), isBanned: true })

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 500,
      })
    })
  })

  it('still applies plan limits to a waived account', async () => {
    givenUser({ emailVerificationWaivedAt: new Date() })
    mockSmsModel.countDocuments.mockResolvedValue(freePlan.dailyLimit)

    await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
      status: 429,
    })
  })

  it('still blocks a banned account', async () => {
    givenUser({ emailVerifiedAt: new Date(), isBanned: true })

    await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
      status: 500,
    })
  })

  it('rejects an unknown user instead of allowing the action', async () => {
    givenUser(null)

    await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
      status: 404,
    })
  })

  describe('receives over the plan limit', () => {
    const originalSetting = process.env.RECEIVE_SMS_OVER_LIMIT

    beforeEach(() => {
      delete process.env.RECEIVE_SMS_OVER_LIMIT
      givenUser({ emailVerifiedAt: new Date() })
      mockSmsModel.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(freePlan.monthlyLimit)
    })

    afterEach(() => {
      if (originalSetting === undefined) delete process.env.RECEIVE_SMS_OVER_LIMIT
      else process.env.RECEIVE_SMS_OVER_LIMIT = originalSetting
    })

    it('allows the receive and marks it over the limit', async () => {
      await expect(service.canPerformAction(userId, 'receive_sms', 1)).resolves.toEqual({
        overLimit: true,
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
          emailKey: 'U2',
          recordHit: true,
        }),
      )
    })

    it('still allows the receive when the notification fails', async () => {
      mockBillingNotifications.notifyOnce.mockRejectedValue(new Error('queue unavailable'))

      await expect(service.canPerformAction(userId, 'receive_sms', 1)).resolves.toEqual({
        overLimit: true,
      })
    })

    it('still refuses an over-limit send when the notice fails', async () => {
      mockBillingNotifications.notifyOnce.mockRejectedValue(new Error('db down'))

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
      expect(console.error).toHaveBeenCalledWith(
        'canPerformAction: failed to record a limit notice',
        expect.objectContaining({ error: 'db down' }),
      )
    })

    it('rejects the receive when RECEIVE_SMS_OVER_LIMIT is reject', async () => {
      process.env.RECEIVE_SMS_OVER_LIMIT = 'reject'

      await expect(service.canPerformAction(userId, 'receive_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
    })

    it('still notifies when receives over the limit are rejected', async () => {
      process.env.RECEIVE_SMS_OVER_LIMIT = 'reject'

      await expect(service.canPerformAction(userId, 'receive_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(
        expect.objectContaining({ meta: expect.objectContaining({ limitTripped: 'monthly' }) }),
      )
    })

    it('still rejects a send over the limit', async () => {
      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
    })

    it('does not mark a paid receive inside the extended monthly allowance', async () => {
      const proPlan = { _id: 'plan_pro', name: 'pro', dailyLimit: -1, monthlyLimit: 5000, bulkSendLimit: -1 }
      mockSubscriptionModel.findOne.mockResolvedValue({ plan: proPlan._id })
      mockPlanModel.findById.mockResolvedValue(proPlan)
      mockSmsModel.countDocuments.mockReset()
      mockSmsModel.countDocuments
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(proPlan.monthlyLimit)

      await expect(service.canPerformAction(userId, 'receive_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
    })
  })

  describe('paid monthly allowance', () => {
    const proPlan = { _id: 'plan_pro', name: 'pro', dailyLimit: -1, monthlyLimit: 5000, bulkSendLimit: -1 }

    const givenPaid = (fields: Record<string, unknown> = {}) => {
      mockSubscriptionModel.findOne.mockResolvedValue({ plan: proPlan._id, ...fields })
      mockPlanModel.findById.mockResolvedValue(proPlan)
    }

    const givenCounts = (today: number, last30Days: number) =>
      mockSmsModel.countDocuments.mockResolvedValueOnce(today).mockResolvedValueOnce(last30Days)

    const originalSetting = process.env.RECEIVE_SMS_OVER_LIMIT

    beforeEach(() => {
      delete process.env.RECEIVE_SMS_OVER_LIMIT
      givenUser({ emailVerifiedAt: new Date() })
    })

    afterEach(() => {
      if (originalSetting === undefined) delete process.env.RECEIVE_SMS_OVER_LIMIT
      else process.env.RECEIVE_SMS_OVER_LIMIT = originalSetting
    })

    const monthlyReached = expect.objectContaining({
      type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
    })

    it('lets a paid plan send past its monthly limit within the allowance', async () => {
      givenPaid()
      givenCounts(10, 5000)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
      expect(mockBillingNotifications.notifyOnce).not.toHaveBeenCalledWith(monthlyReached)
    })

    it('allows a paid send that lands exactly on the allowance', async () => {
      givenPaid()
      givenCounts(10, 5499)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
    })

    it('blocks a paid send past the allowance and emails once', async () => {
      givenPaid()
      givenCounts(10, 5500)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledTimes(1)
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(monthlyReached)
    })

    it('stores a paid receive past the allowance as over the limit', async () => {
      givenPaid()
      givenCounts(10, 5500)

      await expect(service.canPerformAction(userId, 'receive_sms', 1)).resolves.toEqual({
        overLimit: true,
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(monthlyReached)
    })

    it('counts the whole batch against the allowance', async () => {
      givenPaid()
      givenCounts(10, 5400)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 200)).rejects.toMatchObject({
        status: 429,
      })
    })

    it('gives a free plan no allowance', async () => {
      givenCounts(10, 300)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(monthlyReached)
    })

    it('applies the allowance to a custom monthly limit', async () => {
      givenPaid({ customMonthlyLimit: 1000 })
      givenCounts(10, 1099)
      givenCounts(10, 1100)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
    })
  })

  describe('approaching limit notices', () => {
    const proPlan = { _id: 'plan_pro', name: 'pro', dailyLimit: -1, monthlyLimit: 5000, bulkSendLimit: -1 }

    const givenPaid = () => {
      mockSubscriptionModel.findOne.mockResolvedValue({ plan: proPlan._id })
      mockPlanModel.findById.mockResolvedValue(proPlan)
    }

    const givenCounts = (today: number, last30Days: number) =>
      mockSmsModel.countDocuments.mockResolvedValueOnce(today).mockResolvedValueOnce(last30Days)

    const noticeOf = (type: BillingNotificationType) =>
      mockBillingNotifications.notifyOnce.mock.calls
        .map(([input]) => input)
        .find((input) => input.type === type)

    beforeEach(() => givenUser({ emailVerifiedAt: new Date() }))

    it('warns when a send brings the account to 80% of its monthly limit', async () => {
      givenPaid()
      givenCounts(10, 3999)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
      expect(noticeOf(BillingNotificationType.MONTHLY_LIMIT_APPROACHING)).toMatchObject({
        meta: { processedSmsLastMonth: 4000, monthlyLimit: 5000, planName: 'pro' },
        emailKey: 'U1_paid',
      })
    })

    it('warns when a receive brings the account to 80% of its monthly limit', async () => {
      givenPaid()
      givenCounts(10, 3999)

      await service.canPerformAction(userId, 'receive_sms', 1)

      expect(noticeOf(BillingNotificationType.MONTHLY_LIMIT_APPROACHING)).toBeDefined()
    })

    it('does not warn below 80%', async () => {
      givenPaid()
      givenCounts(10, 3998)

      await service.canPerformAction(userId, 'send_sms', 1)

      expect(mockBillingNotifications.notifyOnce).not.toHaveBeenCalled()
    })

    it('does not send the 80% warning inside the paid allowance', async () => {
      givenPaid()
      givenCounts(10, 5000)

      await service.canPerformAction(userId, 'send_sms', 1)

      expect(mockBillingNotifications.notifyOnce).not.toHaveBeenCalled()
    })

    it('warns a free account nearing its daily limit', async () => {
      givenCounts(39, 39)

      await service.canPerformAction(userId, 'send_sms', 1)

      expect(noticeOf(BillingNotificationType.DAILY_LIMIT_APPROACHING)).toMatchObject({
        meta: { processedSmsToday: 40, dailyLimit: 50, planName: 'free' },
        emailKey: 'U3',
      })
      expect(noticeOf(BillingNotificationType.MONTHLY_LIMIT_APPROACHING)).toBeUndefined()
    })

    it('still allows the send when the notice fails', async () => {
      givenPaid()
      givenCounts(10, 3999)
      mockBillingNotifications.notifyOnce.mockRejectedValue(new Error('queue unavailable'))

      await expect(service.canPerformAction(userId, 'send_sms', 1)).resolves.toEqual({
        overLimit: false,
      })
    })
  })

  describe('limit check order and usage email variants', () => {
    const plans = {
      pro: { _id: 'plan_pro', name: 'pro', dailyLimit: -1, monthlyLimit: 5000, bulkSendLimit: -1 },
      scale: { _id: 'plan_scale', name: 'scale', dailyLimit: -1, monthlyLimit: 25000, bulkSendLimit: -1 },
      custom: { _id: 'plan_c', name: 'custom-acme', dailyLimit: 1000, monthlyLimit: 10000, bulkSendLimit: 500 },
    }
    const onPlan = (plan: any) => {
      mockSubscriptionModel.findOne.mockResolvedValue({ plan: plan._id })
      mockPlanModel.findById.mockResolvedValue(plan)
    }
    const givenCounts = (today: number, last30Days: number) =>
      mockSmsModel.countDocuments.mockResolvedValueOnce(today).mockResolvedValueOnce(last30Days)
    const notices = () => mockBillingNotifications.notifyOnce.mock.calls.map(([n]) => n)

    beforeEach(() => {
      delete process.env.RECEIVE_SMS_OVER_LIMIT
      givenUser({ emailVerifiedAt: new Date() })
    })

    it('reports a batch over the batch limit as U5 and nothing else', async () => {
      givenCounts(0, 0)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 60)).rejects.toMatchObject({
        status: 429,
      })

      expect(notices()).toHaveLength(1)
      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.BULK_SMS_LIMIT_REACHED,
        emailKey: 'U5',
        recordHit: false,
        meta: { limitTripped: 'bulk', attempted: 60 },
      })
    })

    it('checks the monthly limit before the daily one', async () => {
      givenCounts(50, 300)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })

      expect(notices()).toHaveLength(1)
      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
        emailKey: 'U2',
      })
    })

    it('reports the daily limit as U4 on the free plan', async () => {
      givenCounts(50, 120)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })

      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.DAILY_LIMIT_REACHED,
        emailKey: 'U4',
        recordHit: true,
        meta: { limitTripped: 'daily', processedSmsToday: 50 },
      })
    })

    it('reports the batch size version of U5 without a limit hit', async () => {
      givenCounts(0, 0)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 60)).rejects.toThrow()

      expect(notices()[0]).toMatchObject({ emailKey: 'U5', recordHit: false })
      expect(notices()[0].meta).not.toHaveProperty('roomWindow')
    })

    it('counts a batch larger than the room left today as a daily hit and sends U5', async () => {
      givenCounts(49, 100)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 5)).rejects.toMatchObject({
        status: 429,
        response: {
          message: 'This batch had 5 recipients and your account has 1 message left today. Nothing was sent.',
        },
      })

      expect(notices()).toHaveLength(1)
      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.DAILY_LIMIT_REACHED,
        title: 'Your batch did not fit',
        message: 'This batch had 5 recipients and your account has 1 message left today. Nothing was sent.',
        emailKey: 'U5',
        recordHit: true,
        meta: { roomWindow: 'daily', roomLeft: 1, attempted: 5 },
      })
    })

    it('counts a batch larger than the monthly room as a monthly hit', async () => {
      givenCounts(0, 290)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 20)).rejects.toThrow()

      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
        title: 'Your batch did not fit',
        message:
          'This batch had 20 recipients and your account has 10 messages left in its monthly allowance. Nothing was sent.',
        emailKey: 'U5',
        recordHit: true,
        meta: { roomWindow: 'monthly', roomLeft: 10 },
      })
    })

    it('uses the window with less room when both are short', async () => {
      givenCounts(45, 290)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 12)).rejects.toThrow()

      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.DAILY_LIMIT_REACHED,
        meta: { roomWindow: 'daily', roomLeft: 5 },
      })
    })

    it('reports a reached daily limit as U4 even when the monthly room is also short', async () => {
      givenCounts(50, 290)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 20)).rejects.toThrow()

      expect(notices()[0]).toMatchObject({ emailKey: 'U4', recordHit: true })
    })

    it('records the hit and notice but no email for a paid plan whose batch does not fit', async () => {
      onPlan(plans.pro)
      givenCounts(10, 5450)

      await expect(service.canPerformAction(userId, 'bulk_send_sms', 100)).rejects.toMatchObject({
        status: 429,
      })

      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.MONTHLY_LIMIT_REACHED,
        title: 'Your batch did not fit',
        emailKey: null,
        recordHit: true,
        meta: { roomWindow: 'monthly', roomLeft: 50 },
      })
    })

    it.each([
      ['pro', 'U2_paid'],
      ['scale', 'U2_top'],
    ])('picks the monthly email for %s', async (name, key) => {
      const plan = plans[name]
      onPlan(plan)
      givenCounts(10, Math.floor(plan.monthlyLimit * 1.1))

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })

      expect(notices()[0]).toMatchObject({ emailKey: key, meta: { planName: name } })
    })

    it('sends no daily or batch email to a custom plan', async () => {
      onPlan(plans.custom)
      givenCounts(1000, 2000)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
      })
      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.DAILY_LIMIT_REACHED,
        emailKey: null,
      })

      jest.clearAllMocks()
      givenCounts(0, 0)
      await expect(service.canPerformAction(userId, 'bulk_send_sms', 600)).rejects.toMatchObject({
        status: 429,
      })
      expect(notices()[0]).toMatchObject({
        type: BillingNotificationType.BULK_SMS_LIMIT_REACHED,
        emailKey: null,
      })
    })

    it('counts today from midnight UTC', async () => {
      givenCounts(0, 0)

      await service.canPerformAction(userId, 'send_sms', 1)

      const since = mockSmsModel.countDocuments.mock.calls[0][0].createdAt.$gte as Date
      expect(since.getUTCHours()).toBe(0)
      expect(since.getUTCMinutes()).toBe(0)
      expect(Date.now() - since.getTime()).toBeLessThan(24 * 3600 * 1000)
    })
  })

  describe('billing period', () => {
    const signedUp = new Date('2026-01-17T22:15:00.000Z')
    const proPlan = { _id: 'plan_pro', name: 'pro', dailyLimit: -1, monthlyLimit: 5000, bulkSendLimit: -1 }
    const monthlySince = () =>
      mockSmsModel.countDocuments.mock.calls[1][0].createdAt.$gte as Date

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-04T08:00:00.000Z') })
      givenUser({ emailVerifiedAt: new Date(), createdAt: signedUp })
    })

    afterEach(() => jest.useRealTimers())

    it('counts a free account from its last signup anniversary', async () => {
      await service.canPerformAction(userId, 'send_sms', 1)

      expect(monthlySince().toISOString()).toBe('2026-09-17T22:15:00.000Z')
    })

    it('counts a paid account from its last subscription anniversary and ignores stored period ends', async () => {
      mockSubscriptionModel.findOne.mockResolvedValue({
        plan: proPlan._id,
        subscriptionStartDate: new Date('2026-06-03T08:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-03T08:00:00.000Z'),
        subscriptionEndDate: new Date('2026-07-03T08:00:00.000Z'),
      })
      mockPlanModel.findById.mockResolvedValue(proPlan)

      await service.canPerformAction(userId, 'send_sms', 1)

      expect(monthlySince().toISOString()).toBe('2026-10-03T08:00:00.000Z')
    })

    it('falls back to the user id time when the signup date is missing', async () => {
      givenUser({ emailVerifiedAt: new Date(), createdAt: undefined })

      await service.canPerformAction(userId, 'send_sms', 1)

      // 507f1f77... was generated on 2012-10-17T21:13:27Z.
      expect(monthlySince().toISOString()).toBe('2026-09-17T21:13:27.000Z')
    })

    it('says when the allowance resets', async () => {
      mockSmsModel.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(300)

      await expect(service.canPerformAction(userId, 'send_sms', 1)).rejects.toMatchObject({
        status: 429,
        response: {
          monthlyResetAt: new Date('2026-10-17T22:15:00.000Z'),
          message: expect.stringContaining(
            'Sending starts again when the allowance resets on 17 October at 22:15 UTC',
          ),
        },
      })
      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({
            monthlyPeriodStart: new Date('2026-09-17T22:15:00.000Z'),
            monthlyResetAt: new Date('2026-10-17T22:15:00.000Z'),
          }),
        }),
      )
    })

    it('passes the period to the approaching notice', async () => {
      mockSmsModel.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(250)

      await service.canPerformAction(userId, 'send_sms', 1)

      expect(mockBillingNotifications.notifyOnce).toHaveBeenCalledWith(
        expect.objectContaining({
          type: BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
          message:
            'Your account has used 251 of its 300 messages for this billing period, counting sent and received. 49 are left. The allowance resets on 17 October at 22:15 UTC.',
          meta: expect.objectContaining({
            monthlyPeriodStart: new Date('2026-09-17T22:15:00.000Z'),
          }),
        }),
      )
    })
  })
})

/*
 * Reporting a sale to an ad platform more than once teaches it to bid on the
 * wrong thing, so the first-payment event has to survive the shapes Polar
 * actually sends: created then active for one signup, an upgrade that creates a
 * second subscription row, a renewal, and a re-subscribe after a revoke.
 */
describe('BillingService - first payment reporting', () => {
  let service: BillingService

  const userId = '507f1f77bcf86cd799439011'
  const proPlan = { _id: 'plan_pro', name: 'pro' }

  const mockPlanModel = { findOne: jest.fn() }
  const mockSubscriptionModel = { updateMany: jest.fn(), updateOne: jest.fn() }
  const mockUserModel = { findById: jest.fn() }
  const mockUsersService = { markMilestone: jest.fn() }
  const mockAnalyticsService = { purchase: jest.fn(), checkoutStarted: jest.fn() }
  const emptyModel = {}

  const activePayment = {
    userId,
    newPlanName: 'pro',
    status: 'active',
    amount: 1200,
    currency: 'usd',
    polarSubscriptionId: 'sub_1',
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
        {
          provide: getModelToken(Subscription.name),
          useValue: mockSubscriptionModel,
        },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(SMS.name), useValue: emptyModel },
        {
          provide: getModelToken(PolarWebhookPayload.name),
          useValue: emptyModel,
        },
        { provide: getModelToken(CheckoutSession.name), useValue: emptyModel },
        { provide: BillingNotificationsService, useValue: {} },
        { provide: UsersService, useValue: mockUsersService },
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)

    jest.clearAllMocks()
    mockPlanModel.findOne.mockResolvedValue(proPlan)
    mockSubscriptionModel.updateMany.mockResolvedValue({ modifiedCount: 0 })
    mockSubscriptionModel.updateOne.mockResolvedValue({ upsertedCount: 1 })
    mockUserModel.findById.mockResolvedValue({
      _id: userId,
      email: 'ada@example.com',
    })
    mockUsersService.markMilestone.mockResolvedValue(true)
  })

  it('clears the end cause when the subscription runs again', async () => {
    await service.switchPlan(activePayment)

    const [filter, update] = mockSubscriptionModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ user: expect.any(Types.ObjectId), plan: proPlan._id })
    expect(update.$unset).toEqual({ churnCause: 1 })
    expect(update.isActive).toBe(true)
  })

  it.each([
    ['scheduled to cancel', { cancelAtPeriodEnd: true }],
    ['not active', { status: 'canceled' }],
  ])('keeps the end cause while the subscription is %s', async (_l, change) => {
    await service.switchPlan({ ...activePayment, ...change })

    expect(mockSubscriptionModel.updateOne.mock.calls[0][1]).not.toHaveProperty('$unset')
  })

  it('reports the sale the first time an account pays', async () => {
    await service.switchPlan(activePayment)

    expect(mockUsersService.markMilestone).toHaveBeenCalledWith(
      userId,
      'firstPaidAt',
    )
    expect(mockAnalyticsService.purchase).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com' }),
      expect.objectContaining({
        amount: 1200,
        currency: 'usd',
        plan: 'pro',
        subscriptionId: 'sub_1',
      }),
    )
  })

  it('reports nothing on a renewal, an upgrade, or a re-subscribe', async () => {
    // The milestone is already stamped, so every later payment is a no-op
    // regardless of whether the subscription row was created or updated.
    mockUsersService.markMilestone.mockResolvedValue(false)

    mockSubscriptionModel.updateOne.mockResolvedValue({ upsertedCount: 0 })
    await service.switchPlan(activePayment)

    // An upgrade creates a second {user, plan} row, which upsertedCount would
    // have treated as a brand new sale.
    mockSubscriptionModel.updateOne.mockResolvedValue({ upsertedCount: 1 })
    await service.switchPlan({ ...activePayment, newPlanName: 'scale' })

    expect(mockAnalyticsService.purchase).not.toHaveBeenCalled()
  })

  it('ignores a subscription that is not active yet', async () => {
    // subscription.created can arrive before the card is charged.
    await service.switchPlan({ ...activePayment, status: 'incomplete' })
    await service.switchPlan({ ...activePayment, status: 'trialing' })

    expect(mockUsersService.markMilestone).not.toHaveBeenCalled()
    expect(mockAnalyticsService.purchase).not.toHaveBeenCalled()
  })

  it('ignores an event that carries no money', async () => {
    await service.switchPlan({ ...activePayment, amount: undefined })
    await service.switchPlan({ ...activePayment, amount: 0 })

    expect(mockUsersService.markMilestone).not.toHaveBeenCalled()
    expect(mockAnalyticsService.purchase).not.toHaveBeenCalled()
  })

  it('still switches the plan when reporting fails', async () => {
    mockUsersService.markMilestone.mockRejectedValue(new Error('mongo down'))

    await expect(service.switchPlan(activePayment)).resolves.toEqual({
      success: true,
      plan: 'pro',
    })
  })
})

describe('BillingService - reads raise no usage notices', () => {
  it('getCurrentSubscription does not notify at 100% usage', async () => {
    const notifyOnce = jest.fn()
    const freePlan = { name: 'free', dailyLimit: 50, monthlyLimit: 300, bulkSendLimit: 50 }
    const service = new BillingService(
      { findOne: jest.fn().mockResolvedValue(freePlan) } as any,
      { findOne: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(null) })) } as any,
      {} as any,
      { countDocuments: jest.fn().mockResolvedValue(300) } as any,
      {} as any,
      {} as any,
      { notifyOnce } as any,
      {} as any,
      {} as any,
    )

    const result = await service.getCurrentSubscription({
      _id: '507f1f77bcf86cd799439011',
      createdAt: new Date('2020-01-17T22:15:00.000Z'),
    })

    expect(result.usage.monthlyRemaining).toBe(0)
    expect(result.usage.monthlyResetAt.getTime()).toBeGreaterThan(Date.now())
    expect(result.usage.monthlyPeriodStart.getUTCDate()).toBe(17)
    expect(notifyOnce).not.toHaveBeenCalled()
  })
})

describe('BillingService - payment retry state and end cause', () => {
  const eventAt = new Date('2026-09-20T12:00:00Z')
  const build = ({ pastDue = null as any, storedPastDue = null as any } = {}) => {
    const subscriptionModel = {
      updateMany: jest.fn().mockResolvedValue({}),
      exists: jest.fn().mockResolvedValue(pastDue),
    }
    const payloadModel = { exists: jest.fn().mockResolvedValue(storedPastDue) }
    const service = new BillingService(
      {} as any,
      subscriptionModel as any,
      {} as any,
      {} as any,
      payloadModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )
    return { service, subscriptionModel, payloadModel }
  }
  const failedCancel = {
    polarSubscriptionId: 'sub_1',
    status: 'canceled',
    cancelAtPeriodEnd: false,
    endsAt: new Date('2026-09-20T13:00:00Z'),
    eventAt,
  }

  const newer = {
    polarSubscriptionId: 'sub_1',
    $or: [{ statusEventAt: null }, { statusEventAt: { $lt: eventAt } }],
  }

  it('keeps the first retry period start when the provider gives none', async () => {
    const { service, subscriptionModel } = build()

    await service.syncPastDue({ polarSubscriptionId: 'sub_1', status: 'past_due', eventAt })

    expect(subscriptionModel.updateMany).toHaveBeenNthCalledWith(
      1,
      { ...newer, isActive: true, pastDueAt: null },
      { $set: { pastDueAt: eventAt, statusEventAt: eventAt } },
    )
    expect(subscriptionModel.updateMany).toHaveBeenNthCalledWith(
      2,
      { ...newer, isActive: true },
      { $set: { statusEventAt: eventAt } },
    )
  })

  it('uses the provider time when present', async () => {
    const { service, subscriptionModel } = build()

    await service.syncPastDue({
      polarSubscriptionId: 'sub_1',
      status: 'past_due',
      pastDueAt: '2026-09-18T00:00:00Z',
      eventAt,
    })

    expect(subscriptionModel.updateMany).toHaveBeenCalledWith(
      { ...newer, isActive: true },
      { $set: { pastDueAt: new Date('2026-09-18T00:00:00Z'), statusEventAt: eventAt } },
    )
  })

  it('clears the retry period only for an event newer than the last one applied', async () => {
    const { service, subscriptionModel } = build()

    await service.syncPastDue({ polarSubscriptionId: 'sub_1', status: 'active', eventAt })

    expect(subscriptionModel.updateMany).toHaveBeenCalledWith(newer, {
      $set: { statusEventAt: eventAt },
      $unset: { pastDueAt: 1 },
    })
  })

  it('ignores other statuses', async () => {
    const { service, subscriptionModel } = build()

    await service.syncPastDue({ polarSubscriptionId: 'sub_1', status: 'canceled', eventAt })

    expect(subscriptionModel.updateMany).not.toHaveBeenCalled()
  })

  it('reads an immediate end after a retry period as payment_failed', async () => {
    const { service } = build({ pastDue: { _id: 's' } })

    await expect(service.churnCause(failedCancel)).resolves.toBe('payment_failed')
  })

  it('falls back to a stored past_due payload from the last 35 days', async () => {
    const { service, payloadModel } = build({ storedPastDue: { _id: 'p' } })

    await expect(service.churnCause(failedCancel)).resolves.toBe('payment_failed')
    const filter = payloadModel.exists.mock.calls[0][0]
    expect(filter).toMatchObject({
      'payload.data.id': 'sub_1',
      'payload.data.status': 'past_due',
    })
    expect(eventAt.getTime() - filter.createdAt.$gte.getTime()).toBe(35 * 86400000)
  })

  it.each([
    ['a scheduled cancellation', { cancelAtPeriodEnd: true }],
    ['a status that is still active', { status: 'active' }],
    ['an end more than 3 hours away', { endsAt: new Date('2026-09-20T15:30:00Z') }],
    ['no end date', { endsAt: null }],
  ])('reads %s as customer', async (_label, change) => {
    const { service } = build({ pastDue: { _id: 's' } })

    await expect(service.churnCause({ ...failedCancel, ...change })).resolves.toBe('customer')
  })

  it('reads an immediate end without a retry period as customer', async () => {
    const { service } = build()

    await expect(service.churnCause(failedCancel)).resolves.toBe('customer')
  })

  it('clears the cancellation and cause on uncancel', async () => {
    const { service, subscriptionModel } = build()

    await service.uncancelSubscription({ polarSubscriptionId: 'sub_1' })

    expect(subscriptionModel.updateMany).toHaveBeenCalledWith(
      { polarSubscriptionId: 'sub_1', isActive: true },
      { $set: { cancelAtPeriodEnd: false }, $unset: { churnCause: 1 } },
    )
  })
})

describe('BillingService - new checkout session', () => {
  it('restarts the stored session on every new checkout', async () => {
    const plan = { name: 'pro', polarMonthlyProductId: 'prod_m', polarYearlyProductId: 'prod_y' }
    const checkoutSessionModel = {
      findOne: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn().mockReturnValue({ catch: jest.fn() }),
    }
    const service = new BillingService(
      { findOne: jest.fn().mockResolvedValue(plan) } as any,
      { findOne: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(null) })) } as any,
      {} as any,
      {} as any,
      {} as any,
      checkoutSessionModel as any,
      {} as any,
      {} as any,
      { checkoutStarted: jest.fn() } as any,
    )
    ;(service as any).polarApi = {
      checkouts: {
        create: jest.fn().mockResolvedValue({
          id: 'co_2',
          url: 'https://pay.test/co_2',
          expires_at: '2026-09-28T00:00:00Z',
        }),
      },
      discounts: { get: jest.fn() },
    }
    delete process.env.POLAR_DEFAULT_DISCOUNT_ID

    await service.getCheckoutUrl({
      user: { _id: new Types.ObjectId('507f1f77bcf86cd799439011'), email: 'a@example.com' },
      payload: { planName: 'pro', billingInterval: 'monthly' },
      req: { ip: '127.0.0.1', headers: {} },
    })

    expect((service as any).polarApi.checkouts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        products: ['prod_m', 'prod_y'],
        external_customer_id: '507f1f77bcf86cd799439011',
        customer_email: 'a@example.com',
        customer_ip_address: '127.0.0.1',
        success_url: expect.stringContaining('checkout-success=1'),
      }),
    )

    const [filter, update, options] = checkoutSessionModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ user: expect.any(Types.ObjectId) })
    expect(update.$set).toMatchObject({
      checkoutSessionId: 'co_2',
      isCompleted: false,
      isAbandoned: false,
    })
    expect(update.$set.sessionStartedAt).toBeInstanceOf(Date)
    expect(update.$set.expiresAt).toEqual(new Date('2026-09-28T00:00:00Z'))
    expect(update.$unset).toEqual({ completedAt: 1 })
    expect(options).toEqual({ upsert: true })
  })
})

describe('BillingService - Polar SDK calls', () => {
  const env = { ...process.env }
  const userId = new Types.ObjectId('507f1f77bcf86cd799439011')

  const build = ({ plan = null as any, current = null as any } = {}) => {
    const subscriptionModel = {
      findOne: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(current) })),
      updateOne: jest.fn().mockReturnValue({ catch: jest.fn() }),
    }
    const checkoutSessionModel = {
      updateOne: jest.fn().mockReturnValue({ catch: jest.fn() }),
    }
    const service = new BillingService(
      { findOne: jest.fn().mockResolvedValue(plan) } as any,
      subscriptionModel as any,
      {} as any,
      {} as any,
      {} as any,
      checkoutSessionModel as any,
      {} as any,
      {} as any,
      {} as any,
    )
    return { service, subscriptionModel }
  }

  afterEach(() => {
    process.env = env
    jest.restoreAllMocks()
  })

  describe('webhook validation', () => {
    const secret = 'whsec_test_secret'

    const signed = (event: Record<string, any>, key = secret) => {
      const body = Buffer.from(JSON.stringify(event))
      const id = 'msg_1'
      const timestamp = Math.floor(Date.now() / 1000).toString()
      // The previous SDK signed with the UTF-8 bytes of the whole secret
      const signature = createHmac('sha256', Buffer.from(key, 'utf8'))
        .update(`${id}.${timestamp}.${body.toString()}`)
        .digest('base64')
      return {
        body,
        headers: {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${signature}`,
        },
      }
    }

    beforeEach(() => {
      process.env = { ...env, POLAR_WEBHOOK_SECRET: secret }
      jest.spyOn(console, 'log').mockImplementation(() => undefined)
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    })

    it('returns the raw event for a valid signature', async () => {
      const { service } = build()
      const event = {
        type: 'subscription.updated',
        timestamp: '2026-09-29T00:00:00Z',
        data: { id: 'sub_1', cancel_at_period_end: true },
      }
      const { body, headers } = signed(event)

      await expect(service.validatePolarWebhookPayload(body, headers)).resolves.toEqual(event)
    })

    it('returns null for a signed event type the SDK does not know', async () => {
      const { service } = build()
      const { body, headers } = signed({ type: 'something.new', data: {} })

      await expect(service.validatePolarWebhookPayload(body, headers)).resolves.toBeNull()
    })

    it('rejects a payload signed with another secret', async () => {
      const { service } = build()
      const { body, headers } = signed({ type: 'subscription.updated', data: {} }, 'whsec_other')

      await expect(service.validatePolarWebhookPayload(body, headers)).rejects.toThrow(
        'Invalid webhook payload',
      )
    })
  })

  describe('plan change', () => {
    const plan = { name: 'pro', polarMonthlyProductId: 'prod_pro_m', polarYearlyProductId: 'prod_pro_y' }
    const current = {
      _id: 'local_sub',
      plan: { name: 'starter' },
      recurringInterval: 'month',
      polarSubscriptionId: 'sub_1',
    }
    const polarSubscription = {
      id: 'sub_1',
      status: 'active',
      product_id: 'prod_starter_m',
      customer_id: 'cus_1',
      cancel_at_period_end: true,
    }
    const updated = {
      ...polarSubscription,
      product_id: 'prod_pro_m',
      cancel_at_period_end: false,
      current_period_start: '2026-09-01T00:00:00Z',
      current_period_end: '2026-10-01T00:00:00Z',
      started_at: '2026-08-01T00:00:00Z',
      created_at: '2026-07-31T00:00:00Z',
      canceled_at: null,
      amount: 1499,
      currency: 'usd',
      recurring_interval: 'month',
    }

    it('updates the subscription by id and stores dates as Date values', async () => {
      const { service } = build({ plan, current })
      const update = jest.fn().mockResolvedValue(updated)
      ;(service as any).polarApi = {
        subscriptions: { get: jest.fn().mockResolvedValue(polarSubscription), update },
      }
      const switchPlan = jest.spyOn(service, 'switchPlan').mockResolvedValue({} as any)

      await service.changePlan({
        user: { _id: userId },
        payload: { planName: 'pro', billingInterval: 'monthly' },
      })

      expect((service as any).polarApi.subscriptions.get).toHaveBeenCalledWith('sub_1')
      expect(update).toHaveBeenNthCalledWith(1, 'sub_1', { cancel_at_period_end: false })
      expect(update).toHaveBeenNthCalledWith(2, 'sub_1', { product_id: 'prod_pro_m' })
      expect(switchPlan).toHaveBeenCalledWith({
        userId: userId.toString(),
        newPlanPolarProductId: 'prod_pro_m',
        currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
        subscriptionStartDate: new Date('2026-08-01T00:00:00Z'),
        subscriptionEndDate: null,
        status: 'active',
        amount: 1499,
        currency: 'usd',
        recurringInterval: 'month',
        polarSubscriptionId: 'sub_1',
        polarCustomerId: 'cus_1',
        cancelAtPeriodEnd: false,
      })
    })

    it('flags a scheduled cancellation on the plan change screen', async () => {
      const { service } = build({ plan, current })
      ;(service as any).polarApi = {
        subscriptions: { get: jest.fn().mockResolvedValue(polarSubscription) },
      }

      const result: any = await service.getCheckoutUrl({
        user: { _id: userId },
        payload: { planName: 'pro', billingInterval: 'monthly' },
        req: { headers: {} },
      })

      expect(result.planChange.cancelAtPeriodEnd).toBe(true)
    })

    it('maps a failed prorated charge to PAYMENT_ISSUE', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const { service } = build({ plan, current })
      ;(service as any).polarApi = {
        subscriptions: {
          get: jest.fn().mockResolvedValue({ ...polarSubscription, cancel_at_period_end: false }),
          update: jest.fn().mockRejectedValue(new errors.SubscriptionsUpdate402Error(402, {} as any)),
        },
      }

      await expect(
        service.changePlan({
          user: { _id: userId },
          payload: { planName: 'pro', billingInterval: 'monthly' },
        }),
      ).rejects.toMatchObject({ response: { code: 'PAYMENT_ISSUE' } })
    })

    it('finds the subscription by external customer id when the stored id fails', async () => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      const { service, subscriptionModel } = build({ plan, current })
      const list = jest.fn().mockResolvedValue({ items: [polarSubscription], pagination: {} })
      ;(service as any).polarApi = {
        subscriptions: {
          get: jest.fn().mockRejectedValue(new Error('not found')),
          list,
          update: jest.fn().mockResolvedValue(updated),
        },
      }
      jest.spyOn(service, 'switchPlan').mockResolvedValue({} as any)

      await service.changePlan({
        user: { _id: userId },
        payload: { planName: 'pro', billingInterval: 'monthly' },
      })

      expect(list).toHaveBeenCalledWith({
        external_customer_id: userId.toString(),
        active: true,
        limit: 1,
      })
      expect(subscriptionModel.updateOne).toHaveBeenCalledWith(
        { _id: 'local_sub' },
        { polarSubscriptionId: 'sub_1', polarCustomerId: 'cus_1' },
      )
    })
  })
})
