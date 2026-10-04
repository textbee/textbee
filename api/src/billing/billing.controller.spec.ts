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
    recordChurnCause: jest.fn(),
    syncCheckoutSessionStatus: jest.fn(),
    syncPastDue: jest.fn(),
    churnCause: jest.fn(),
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
      customer: { external_id: 'user_ext_1' },
      metadata: { userId: 'user_meta_1' },
      status: 'active',
      current_period_start: '2026-06-17T00:00:00.000Z',
      current_period_end: '2026-07-17T00:00:00.000Z',
      cancel_at_period_end: false,
      created_at: '2026-06-17T00:00:00.000Z',
      canceled_at: null,
      amount: 1900,
      currency: 'usd',
      recurring_interval: 'month',
      customer_id: 'cust_1',
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
    mockBillingService.recordChurnCause.mockResolvedValue(undefined)
    mockBillingService.syncCheckoutSessionStatus.mockResolvedValue(undefined)
    mockBillingService.syncPastDue.mockResolvedValue(undefined)
    mockBillingService.churnCause.mockResolvedValue('customer')
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

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith({
      userId: 'user_meta_1',
      newPlanPolarProductId: 'prod_pro_monthly',
      currentPeriodStart: new Date('2026-06-17T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-07-17T00:00:00.000Z'),
      status: 'active',
      subscriptionStartDate: new Date('2026-06-17T00:00:00.000Z'),
      endsAt: undefined,
      endedAt: undefined,
      modifiedAt: undefined,
      amount: 1900,
      currency: 'usd',
      recurringInterval: 'month',
      polarSubscriptionId: 'sub_123',
      polarCustomerId: 'cust_1',
      cancelAtPeriodEnd: false,
    })
    expect(mockBillingService.recordChurnCause).not.toHaveBeenCalled()
  })

  it('prefers the start time and forwards the end and modification times', async () => {
    await handle(
      makePayload('subscription.updated', {
        started_at: '2026-06-16T00:00:00.000Z',
        ends_at: '2026-07-17T00:00:00.000Z',
        ended_at: '2026-07-17T00:00:00.000Z',
        modified_at: '2026-07-17T00:00:01.000Z',
      }),
    )

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionStartDate: new Date('2026-06-16T00:00:00.000Z'),
        endsAt: new Date('2026-07-17T00:00:00.000Z'),
        endedAt: new Date('2026-07-17T00:00:00.000Z'),
        modifiedAt: new Date('2026-07-17T00:00:01.000Z'),
      }),
    )
  })

  it('routes subscription.updated to switchPlan, forwarding cancelAtPeriodEnd', async () => {
    await handle(makePayload('subscription.updated', { cancel_at_period_end: true }))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date('2026-07-17T00:00:00.000Z'),
      }),
    )
  })

  it('applies subscription.canceled through the same sync, then records the end cause', async () => {
    await handle(
      makePayload('subscription.canceled', { cancel_at_period_end: true }),
    )

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ cancelAtPeriodEnd: true, polarSubscriptionId: 'sub_123' }),
    )
    expect(mockBillingService.switchPlan.mock.calls[0][0]).not.toHaveProperty('revoked')
    expect(mockBillingService.recordChurnCause).toHaveBeenCalledWith({
      polarSubscriptionId: 'sub_123',
      churnCause: 'customer',
    })
  })

  it('routes the alternate spelling subscription.cancelled the same way', async () => {
    await handle(makePayload('subscription.cancelled'))

    expect(mockBillingService.switchPlan).toHaveBeenCalledTimes(1)
    expect(mockBillingService.recordChurnCause).toHaveBeenCalledTimes(1)
  })

  it('marks subscription.revoked as the end, whatever its status', async () => {
    await handle(makePayload('subscription.revoked', { status: 'past_due' }))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_meta_1', polarSubscriptionId: 'sub_123', revoked: true }),
    )
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

  it('does not mutate any subscription for an unhandled event type', async () => {
    await handle(makePayload('checkout.created'))

    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
    // ...but the payload is still validated and stored.
    expect(mockBillingService.storePolarWebhookPayload).toHaveBeenCalledTimes(1)
  })

  it('falls back to customer.external_id when metadata.userId is absent', async () => {
    await handle(makePayload('subscription.revoked', { metadata: {} }))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_ext_1' }),
    )
  })

  it('passes the cancel fields and event time to the end cause rule', async () => {
    const payload: any = makePayload('subscription.canceled', {
      status: 'canceled',
      ends_at: '2026-07-01T10:00:00.000Z',
    })
    payload.timestamp = '2026-07-01T09:00:00.000Z'
    mockBillingService.churnCause.mockResolvedValue('payment_failed')

    await handle(payload)

    expect(mockBillingService.churnCause).toHaveBeenCalledWith({
      polarSubscriptionId: 'sub_123',
      status: 'canceled',
      cancelAtPeriodEnd: false,
      endsAt: '2026-07-01T10:00:00.000Z',
      eventAt: new Date('2026-07-01T09:00:00.000Z'),
    })
    expect(mockBillingService.recordChurnCause).toHaveBeenCalledWith(
      expect.objectContaining({ churnCause: 'payment_failed' }),
    )
  })

  it.each(['subscription.updated', 'subscription.past_due'])(
    'records the retry period start on %s',
    async (type) => {
      await handle(makePayload(type, { status: 'past_due' }))

      expect(mockBillingService.syncPastDue).toHaveBeenCalledWith(
        expect.objectContaining({ polarSubscriptionId: 'sub_123', status: 'past_due' }),
      )
    },
  )

  it('orders status changes by the provider modification time', async () => {
    const payload: any = makePayload('subscription.updated', {
      status: 'past_due',
      modified_at: '2026-07-01T08:00:00.000Z',
    })
    payload.timestamp = '2026-07-01T09:00:00.000Z'

    await handle(payload)

    expect(mockBillingService.syncPastDue).toHaveBeenCalledWith(
      expect.objectContaining({ eventAt: new Date('2026-07-01T08:00:00.000Z') }),
    )
  })

  it('forwards the retry period start from past_due_at', async () => {
    await handle(
      makePayload('subscription.past_due', {
        status: 'past_due',
        past_due_at: '2026-07-01T07:00:00.000Z',
      }),
    )

    expect(mockBillingService.syncPastDue).toHaveBeenCalledWith(
      expect.objectContaining({ pastDueAt: '2026-07-01T07:00:00.000Z' }),
    )
  })

  it('falls back to the webhook time without a modification time', async () => {
    const payload: any = makePayload('subscription.past_due', { status: 'past_due' })
    payload.timestamp = '2026-07-01T09:00:00.000Z'

    await handle(payload)

    expect(mockBillingService.syncPastDue).toHaveBeenCalledWith(
      expect.objectContaining({ eventAt: new Date('2026-07-01T09:00:00.000Z') }),
    )
  })

  it('acknowledges an unknown signed event without storing or routing it', async () => {
    mockBillingService.validatePolarWebhookPayload.mockResolvedValue(null)
    await controller.handlePolarWebhook({ any: 'rawBody' }, req)

    expect(mockBillingService.storePolarWebhookPayload).not.toHaveBeenCalled()
    expect(mockBillingService.switchPlan).not.toHaveBeenCalled()
    expect(mockBillingService.syncPastDue).not.toHaveBeenCalled()
  })

  it('applies subscription.uncanceled through the same sync', async () => {
    await handle(makePayload('subscription.uncanceled'))

    expect(mockBillingService.switchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ polarSubscriptionId: 'sub_123', cancelAtPeriodEnd: false }),
    )
  })
})
