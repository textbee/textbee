import { Test, TestingModule } from '@nestjs/testing'
import { getModelToken } from '@nestjs/mongoose'
import { Types } from 'mongoose'
import { BillingService } from './billing.service'
import { Plan } from './schemas/plan.schema'
import { Subscription } from './schemas/subscription.schema'
import { User } from '../users/schemas/user.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { PolarWebhookPayload } from './schemas/polar-webhook-payload.schema'
import { CheckoutSession } from './schemas/checkout-session.schema'
import { BillingNotificationsService } from './billing-notifications.service'

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
  }
  const emptyModel = {}
  const mockBillingNotifications = {}

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
      ],
    }).compile()

    service = module.get<BillingService>(BillingService)

    jest.clearAllMocks()
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

describe('BillingService - resolvePolarUserId', () => {
  let service: BillingService
  const emptyModel = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: emptyModel },
        { provide: getModelToken(Subscription.name), useValue: emptyModel },
        { provide: getModelToken(User.name), useValue: emptyModel },
        { provide: getModelToken(SMS.name), useValue: emptyModel },
        { provide: getModelToken(PolarWebhookPayload.name), useValue: emptyModel },
        { provide: getModelToken(CheckoutSession.name), useValue: emptyModel },
        { provide: BillingNotificationsService, useValue: {} },
      ],
    }).compile()
    service = module.get<BillingService>(BillingService)
  })

  // Subscriptions created before externalCustomerId existed only carry
  // metadata, and their customers can never be given an external id.
  it('resolves a pre-externalId subscription from metadata alone', () => {
    expect(
      service.resolvePolarUserId({ metadata: { userId: 'u1' }, customer: {} }),
    ).toBe('u1')
  })

  it('resolves from customer.externalId when metadata is absent', () => {
    expect(
      service.resolvePolarUserId({ metadata: {}, customer: { externalId: 'u2' } }),
    ).toBe('u2')
  })

  it('prefers metadata, the field with fuller coverage', () => {
    expect(
      service.resolvePolarUserId({
        metadata: { userId: 'u3' },
        customer: { externalId: 'u3' },
      }),
    ).toBe('u3')
  })

  // Must be undefined, not null or '': the caller guards on falsiness before
  // anything reaches new Types.ObjectId().
  it('returns undefined when neither is present', () => {
    expect(service.resolvePolarUserId({ metadata: {}, customer: {} })).toBeUndefined()
    expect(service.resolvePolarUserId({})).toBeUndefined()
    expect(service.resolvePolarUserId(undefined)).toBeUndefined()
  })
})

describe('BillingService - switchPlan activation', () => {
  let service: BillingService
  const userId = '507f1f77bcf86cd799439011'
  const plan = { _id: 'plan_pro', name: 'pro' }
  const mockPlanModel = { findOne: jest.fn() }
  const mockSubscriptionModel = { updateOne: jest.fn(), updateMany: jest.fn() }

  const run = (status?: string, extra: Record<string, any> = {}) =>
    service.switchPlan({
      userId,
      newPlanPolarProductId: 'prod_pro_monthly',
      status,
      amount: 999,
      polarSubscriptionId: 'sub_1',
      ...extra,
    })

  const writtenIsActive = () =>
    mockSubscriptionModel.updateOne.mock.calls[0][1].isActive

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getModelToken(Plan.name), useValue: mockPlanModel },
        { provide: getModelToken(Subscription.name), useValue: mockSubscriptionModel },
        { provide: getModelToken(User.name), useValue: {} },
        { provide: getModelToken(SMS.name), useValue: {} },
        { provide: getModelToken(PolarWebhookPayload.name), useValue: {} },
        { provide: getModelToken(CheckoutSession.name), useValue: {} },
        { provide: BillingNotificationsService, useValue: {} },
      ],
    }).compile()
    service = module.get<BillingService>(BillingService)
    jest.clearAllMocks()
    mockPlanModel.findOne.mockResolvedValue(plan)
    mockSubscriptionModel.updateMany.mockResolvedValue({ modifiedCount: 0 })
    mockSubscriptionModel.updateOne.mockResolvedValue({ upsertedCount: 0 })
  })

  it.each(['active', 'trialing', 'past_due'])(
    'keeps access on %s',
    async (status) => {
      await run(status)
      expect(writtenIsActive()).toBe(true)
    },
  )

  // The regression: Polar emits a trailing "canceled" subscription.updated
  // after subscription.revoked. This used to write isActive: true and restore
  // the subscription that had just been revoked.
  it.each(['canceled', 'unpaid', 'incomplete_expired', 'incomplete'])(
    'does not restore access on %s',
    async (status) => {
      await run(status)
      expect(writtenIsActive()).toBe(false)
    },
  )

  // A payload that simply omits status must not be read as a revocation.
  it('treats a missing status as active', async () => {
    await run(undefined)
    expect(writtenIsActive()).toBe(true)
  })

  it('still records the status it was given', async () => {
    await run('canceled')
    expect(mockSubscriptionModel.updateOne.mock.calls[0][1].status).toBe('canceled')
  })

  it('warns when activating a paid plan with no polar subscription id', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    await run('active', { polarSubscriptionId: undefined })
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no polarSubscriptionId'),
    )
    warn.mockRestore()
  })
})
