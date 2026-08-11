import { BillingService } from './billing.service'

// Regression test for #283: setMonth(getMonth() - 1) overflowed on long months
// (e.g. run on Mar 31 -> "Feb 31" -> Mar 3), shrinking the monthly window to 28
// days. getMonthlyWindowStart() must always give a full 30-day lookback.
describe('BillingService.getMonthlyWindowStart (issue #283)', () => {
  // Constructor only reads process.env, so nulls are fine for the deps.
  const service = new BillingService(
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ) as any

  const DAY_MS = 24 * 60 * 60 * 1000

  afterEach(() => jest.useRealTimers())

  it('gives a full 30-day window on Mar 31 (the old overflow day)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-03-31T12:00:00.000Z'))

    const start: Date = service.getMonthlyWindowStart()
    const spanDays = (Date.now() - start.getTime()) / DAY_MS

    expect(spanDays).toBe(30)

    // The old code produced Mar 3 (a 28-day window). Prove we don't.
    const buggy = new Date(new Date().setMonth(new Date().getMonth() - 1))
    expect(start.getTime()).toBeLessThan(buggy.getTime())
  })

  it('gives a 30-day window on a normal day too', () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-06-15T00:00:00.000Z'))

    const start: Date = service.getMonthlyWindowStart()
    expect((Date.now() - start.getTime()) / DAY_MS).toBe(30)
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
