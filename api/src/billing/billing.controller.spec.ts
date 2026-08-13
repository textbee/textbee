import { Test, TestingModule } from '@nestjs/testing'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'
import { BillingNotificationsService } from './billing-notifications.service'
import { AuthGuard } from '../auth/guards/auth.guard'

describe('BillingController - handlePolarWebhook', () => {
  let controller: BillingController

  const mockBillingService = {
    validatePolarWebhookPayload: jest.fn(),
    storePolarWebhookPayload: jest.fn(),
    switchPlan: jest.fn(),
    cancelSubscription: jest.fn(),
    revokeSubscription: jest.fn(),
    syncCheckoutSessionStatus: jest.fn(),
    // Real implementation, not a stub: the controller's skip guard and the
    // metadata/externalId fallback order are both under test here.
    resolvePolarUserId: (data: any) =>
      data?.metadata?.userId || data?.customer?.externalId || undefined,
  }
  const mockBillingNotifications = {
    listForUser: jest.fn(),
  }

  const req = { headers: { 'webhook-id': 'wh_1' } }

  // Builds a Polar webhook payload. `data` overrides let each test tweak
  // the event type, ids, and the cancel/period fields under test.
  const makePayload = (type: string, data: Record<string, any> = {}) => ({
    type,
    data: {
      id: 'sub_123',
      product: { id: 'prod_pro_monthly' },
      customer: { externalId: 'user_ext_1' },
      metadata: { userId: 'user_meta_1' },
      status: 'active',
      currentPeriodStart: '2026-06-17T00:00:00.000Z',
      currentPeriodEnd: '2026-07-17T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      createdAt: '2026-06-17T00:00:00.000Z',
      canceledAt: null,
      amount: 1900,
      currency: 'usd',
      recurringInterval: 'month',
      customerId: 'cust_1',
      ...data,
    },
  })

  const handle = async (payload: any) => {
    mockBillingService.validatePolarWebhookPayload.mockResolvedValue(payload)
    await controller.handlePolarWebhook({ any: 'rawBody' }, req)
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: mockBillingService },
        {
          provide: BillingNotificationsService,
          useValue: mockBillingNotifications,
        },
      ],
    })
      // The webhook route is unguarded, but the controller's other routes use
      // AuthGuard (JwtService/UsersService/AuthService). Override it so the
      // test module doesn't need to wire up the whole auth stack.
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get<BillingController>(BillingController)

    jest.clearAllMocks()
    mockBillingService.storePolarWebhookPayload.mockResolvedValue(undefined)
    mockBillingService.switchPlan.mockResolvedValue({ success: true })
    mockBillingService.cancelSubscription.mockResolvedValue({ success: true })
    mockBillingService.revokeSubscription.mockResolvedValue({ success: true })
    mockBillingService.syncCheckoutSessionStatus.mockResolvedValue(undefined)
  })

  it('validates and stores every incoming payload', async () => {
    await handle(makePayload('subscription.created'))

    expect(mockBillingService.validatePolarWebhookPayload).toHaveBeenCalledWith(
      { any: 'rawBody' },
      req.headers,
    )
    expect(mockBillingService.storePolarWebhookPayload).toHaveBeenCalledTimes(1)
  })

  it('routes subscription.created to switchPlan with the period fields', async () => {
    await handle(makePayload('subscription.created'))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_meta_1',
        newPlanPolarProductId: 'prod_pro_monthly',
        currentPeriodEnd: '2026-07-17T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      }),
    )
    expect(mockBillingService.cancelSubscription).not.toHaveBeenCalled()
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
  })

  it('routes subscription.updated to switchPlan, forwarding cancelAtPeriodEnd', async () => {
    await handle(makePayload('subscription.updated', { cancelAtPeriodEnd: true }))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-07-17T00:00:00.000Z',
      }),
    )
  })

  it('routes subscription.canceled to cancelSubscription, forwarding the cancel/period fields and NOT downgrading', async () => {
    await handle(
      makePayload('subscription.canceled', { cancelAtPeriodEnd: true }),
    )

    expect(mockBillingService.cancelSubscription).toHaveBeenCalledWith({
      userId: 'user_meta_1',
      polarProductId: 'prod_pro_monthly',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: '2026-07-17T00:00:00.000Z',
      status: 'active',
    })
    // A scheduled cancellation must not route to the downgrade or switchPlan.
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
  })

  it('routes the alternate spelling subscription.cancelled to cancelSubscription', async () => {
    await handle(makePayload('subscription.cancelled'))

    expect(mockBillingService.cancelSubscription).toHaveBeenCalledTimes(1)
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
  })

  it('routes subscription.revoked to revokeSubscription (the real downgrade)', async () => {
    await handle(makePayload('subscription.revoked'))

    expect(mockBillingService.revokeSubscription).toHaveBeenCalledWith({
      userId: 'user_meta_1',
      polarProductId: 'prod_pro_monthly',
    })
    expect(mockBillingService.cancelSubscription).not.toHaveBeenCalled()
  })

  // Polar was already sending checkout.updated, but it fell through to the
  // default case, so isCompleted was never written for anyone.
  it('routes checkout.updated to syncCheckoutSessionStatus', async () => {
    await handle(
      makePayload('checkout.updated', {
        id: 'checkout_abc',
        status: 'succeeded',
      }),
    )

    expect(mockBillingService.syncCheckoutSessionStatus).toHaveBeenCalledWith({
      checkoutSessionId: 'checkout_abc',
      status: 'succeeded',
    })
    // A checkout event must never touch the subscription itself.
    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
  })

  it('forwards a non-terminal checkout status and lets the service decide', async () => {
    await handle(
      makePayload('checkout.updated', { id: 'checkout_abc', status: 'open' }),
    )

    expect(mockBillingService.syncCheckoutSessionStatus).toHaveBeenCalledWith({
      checkoutSessionId: 'checkout_abc',
      status: 'open',
    })
  })

  // new Types.ObjectId(undefined) mints a fresh random id rather than throwing,
  // so an unresolvable event would write a subscription against a user that
  // does not exist.
  it('skips a subscription event that names no user', async () => {
    await handle(makePayload('subscription.updated', { metadata: {}, customer: {} }))

    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
    expect(mockBillingService.cancelSubscription).not.toHaveBeenCalled()
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
    // The payload is still audited even though it was not acted on.
    expect(mockBillingService.storePolarWebhookPayload).toHaveBeenCalledTimes(1)
  })

  it('still handles checkout events, which carry no user', async () => {
    await handle(
      makePayload('checkout.updated', {
        metadata: {},
        customer: {},
        id: 'checkout_abc',
        status: 'succeeded',
      }),
    )

    expect(mockBillingService.syncCheckoutSessionStatus).toHaveBeenCalled()
  })

  it('does not mutate any subscription for an unhandled event type', async () => {
    await handle(makePayload('checkout.created'))

    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
    expect(mockBillingService.cancelSubscription).not.toHaveBeenCalled()
    expect(mockBillingService.revokeSubscription).not.toHaveBeenCalled()
    // ...but the payload is still validated and stored.
    expect(mockBillingService.storePolarWebhookPayload).toHaveBeenCalledTimes(1)
  })

  it('falls back to customer.externalId when metadata.userId is absent', async () => {
    await handle(makePayload('subscription.revoked', { metadata: {} }))

    expect(mockBillingService.revokeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_ext_1' }),
    )
  })
})
