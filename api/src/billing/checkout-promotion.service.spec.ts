import { errors } from '@polar-sh/sdk/2026-10'
import {
  CheckoutPromotionService,
  isDiscountRejection,
  isPromotionLive,
  planPromotion,
  PromotionDiscount,
  promotionCovers,
  salePrice,
} from './checkout-promotion.service'

const discount = (over: Partial<PromotionDiscount> = {}): PromotionDiscount => ({
  id: 'disc_test_1',
  name: 'Spring offer',
  type: 'percentage',
  basis_points: 2000,
  duration: 'forever',
  starts_at: '2030-03-01T00:00:00Z',
  ends_at: '2030-03-31T00:00:00Z',
  max_redemptions: 100,
  redemptions_count: 3,
  products: [{ id: 'prod_m' }, { id: 'prod_y' }],
  ...over,
})

const at = (iso: string) => new Date(iso)
const during = at('2030-03-10T00:00:00Z')

describe('isPromotionLive', () => {
  it('is live inside the window, under the cap', () => {
    expect(isPromotionLive(discount(), null, during)).toBe(true)
  })

  it('is not live before the Polar start', () => {
    expect(isPromotionLive(discount(), null, at('2030-02-28T23:59:59Z'))).toBe(false)
  })

  it('waits for activeFrom when it is later than the Polar start', () => {
    const activeFrom = at('2030-03-05T00:00:00Z')
    expect(isPromotionLive(discount(), activeFrom, at('2030-03-04T23:59:59Z'))).toBe(false)
    expect(isPromotionLive(discount(), activeFrom, activeFrom)).toBe(true)
  })

  it('keeps the Polar start when activeFrom is earlier', () => {
    const activeFrom = at('2030-02-01T00:00:00Z')
    expect(isPromotionLive(discount(), activeFrom, at('2030-02-15T00:00:00Z'))).toBe(false)
  })

  it('treats a missing start as already started', () => {
    expect(isPromotionLive(discount({ starts_at: null }), null, at('2000-01-01T00:00:00Z'))).toBe(
      true,
    )
  })

  it('is not live at or after the end', () => {
    expect(isPromotionLive(discount(), null, at('2030-03-31T00:00:00Z'))).toBe(false)
    expect(isPromotionLive(discount(), null, at('2030-04-01T00:00:00Z'))).toBe(false)
  })

  it('has no end when ends_at is null', () => {
    expect(isPromotionLive(discount({ ends_at: null }), null, at('2040-01-01T00:00:00Z'))).toBe(
      true,
    )
  })

  it('is not live once the redemption cap is reached', () => {
    expect(isPromotionLive(discount({ redemptions_count: 100 }), null, during)).toBe(false)
    expect(isPromotionLive(discount({ redemptions_count: 99 }), null, during)).toBe(true)
    expect(
      isPromotionLive(discount({ max_redemptions: null, redemptions_count: 9999 }), null, during),
    ).toBe(true)
  })

  it('is not live for a fixed amount discount', () => {
    expect(
      isPromotionLive(discount({ type: 'fixed', basis_points: undefined }), null, during),
    ).toBe(false)
  })

  it('is not live without a discount', () => {
    expect(isPromotionLive(null, null, during)).toBe(false)
  })
})

describe('promotionCovers', () => {
  it('covers listed products only', () => {
    expect(promotionCovers(discount(), 'prod_m')).toBe(true)
    expect(promotionCovers(discount(), 'prod_other')).toBe(false)
  })

  it('covers every product when the list is empty', () => {
    expect(promotionCovers(discount({ products: [] }), 'prod_other')).toBe(true)
  })

  it('never covers a plan without a product', () => {
    expect(promotionCovers(discount({ products: [] }), undefined)).toBe(false)
  })
})

describe('isDiscountRejection', () => {
  const validation = (loc: string[]) =>
    new errors.HTTPValidationError(422, {
      detail: [{ loc, msg: 'Invalid', type: 'value_error', input: { discount_id: 'x' } }],
    } as any)

  it('is true for a validation error on discount_id', () => {
    expect(isDiscountRejection(validation(['body', 'discount_id']))).toBe(true)
  })

  it('is true for a client error whose detail names the discount', () => {
    const error = new errors.ResourceNotFound(404, { error: 'ResourceNotFound', detail: 'Discount not found' } as any)
    expect(isDiscountRejection(error)).toBe(true)
  })

  it('is false for a validation error on another field, even with the discount in its input', () => {
    expect(isDiscountRejection(validation(['body', 'customer_email']))).toBe(false)
  })

  it.each([
    ['a network error', new Error('discount fetch failed')],
    ['a server error', Object.assign(new Error('discount'), { statusCode: 500 })],
    ['a rate limit', Object.assign(new Error('x'), { statusCode: 429, error: { detail: 'discount' } })],
    ['nothing', undefined],
  ])('is false for %s', (_label, error) => {
    expect(isDiscountRejection(error)).toBe(false)
  })
})

describe('salePrice', () => {
  it('rounds the discount to the cent', () => {
    expect(salePrice(1000, 2000)).toBe(800)
    expect(salePrice(2000, 2500)).toBe(1500)
    expect(salePrice(999, 1500)).toBe(849)
    expect(salePrice(4999, 3333)).toBe(3333)
  })
})

describe('planPromotion', () => {
  const plan = {
    monthlyPrice: 1000,
    yearlyPrice: 9000,
    polarMonthlyProductId: 'prod_m',
    polarYearlyProductId: 'prod_y',
  }

  it('describes the promotion with sale prices per interval', () => {
    expect(planPromotion(plan, { discount: discount() })).toEqual({
      label: 'Spring offer',
      percentOff: 20,
      endsAt: '2030-03-31T00:00:00.000Z',
      duration: 'forever',
      durationInMonths: null,
      monthlyPrice: 800,
      yearlyPrice: 7200,
      newCheckoutsOnly: true,
    })
  })

  it('leaves an uncovered interval without a sale price', () => {
    const result = planPromotion(plan, { discount: discount({ products: [{ id: 'prod_y' }] }) })
    expect(result).toMatchObject({ monthlyPrice: null, yearlyPrice: 7200 })
  })

  it('is null when the plan is not covered or the promotion is not live', () => {
    expect(
      planPromotion(plan, { discount: discount({ products: [{ id: 'prod_other' }] }) }),
    ).toBeNull()
    expect(planPromotion(plan, null)).toBeNull()
  })

  it('is null for a free plan, even when every product is covered', () => {
    expect(
      planPromotion({ monthlyPrice: 0, yearlyPrice: 0 }, { discount: discount({ products: [] }) }),
    ).toBeNull()
  })

  it('carries the month count for a repeating discount', () => {
    expect(
      planPromotion(plan, {
        discount: discount({ duration: 'repeating', duration_in_months: 3 }),
      }),
    ).toMatchObject({ duration: 'repeating', durationInMonths: 3 })
  })
})

describe('CheckoutPromotionService', () => {
  const settingWith = (doc: any) => ({
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(doc) })),
  })

  const build = (settingModel: any, get: jest.Mock) => {
    const service = new CheckoutPromotionService(settingModel)
    ;(service as any).polarApi = { discounts: { get } }
    return service
  }

  beforeEach(() => {
    delete process.env.POLAR_DEFAULT_DISCOUNT_ID
  })
  afterEach(() => {
    delete process.env.POLAR_DEFAULT_DISCOUNT_ID
    jest.useRealTimers()
  })

  it('uses the discount from the billing setting and honors activeFrom', async () => {
    const get = jest.fn().mockResolvedValue(discount())
    const service = build(
      settingWith({
        key: 'default',
        checkoutDiscountId: 'disc_setting',
        checkoutDiscountActiveFrom: at('2030-03-15T00:00:00Z'),
      }),
      get,
    )
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'

    expect(await service.getLivePromotion(during)).toBeNull()
    expect(await service.getLivePromotion(at('2030-03-16T00:00:00Z'))).toEqual({
      discount: discount(),
    })
    expect(get).toHaveBeenCalledWith('disc_setting')
  })

  it('falls back to the env discount when the setting has none', async () => {
    const get = jest.fn().mockResolvedValue(discount())
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'
    const service = build(settingWith(null), get)

    expect(await service.getLivePromotion(during)).not.toBeNull()
    expect(get).toHaveBeenCalledWith('disc_env')
  })

  it('is null with no discount configured, without calling Polar', async () => {
    const get = jest.fn()
    const service = build(settingWith({ key: 'default', checkoutDiscountId: null }), get)

    expect(await service.getLivePromotion(during)).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('is null when Polar fails, and caches the failure for 60 seconds', async () => {
    jest.useFakeTimers({ now: new Date('2030-03-10T00:00:00Z') })
    const get = jest.fn().mockRejectedValue(new Error('polar down'))
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'
    const service = build(settingWith(null), get)

    expect(await service.getLivePromotion(during)).toBeNull()
    expect(await service.getLivePromotion(during)).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)

    get.mockResolvedValue(discount())
    jest.advanceTimersByTime(60_000)
    expect(await service.getLivePromotion(during)).not.toBeNull()
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('ignores a setting id that is not a string and falls back to the env discount', async () => {
    const get = jest.fn().mockResolvedValue(discount())
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'
    const service = build(settingWith({ key: 'default', checkoutDiscountId: { id: 1 } }), get)

    await expect(service.getLivePromotion(during)).resolves.not.toBeNull()
    expect(get).toHaveBeenCalledWith('disc_env')
  })

  it('is null for a setting id that is not a string and no env discount', async () => {
    const get = jest.fn()
    const service = build(settingWith({ key: 'default', checkoutDiscountId: 42 }), get)

    await expect(service.getLivePromotion(during)).resolves.toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('returns null on an unexpected error and does not cache it', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'
    const service = build(settingWith(null), jest.fn().mockResolvedValue(discount()))
    const lookup = jest
      .spyOn(service as any, 'lookup')
      .mockRejectedValueOnce(new Error('unexpected'))

    await expect(service.getLivePromotion(during)).resolves.toBeNull()
    await expect(service.getLivePromotion(during)).resolves.not.toBeNull()
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('covers nothing, without throwing, when the product list is malformed', () => {
    expect(promotionCovers(discount({ products: 'all' as any }), 'prod_m')).toBe(false)
    expect(promotionCovers(discount({ products: undefined }), 'prod_m')).toBe(false)
  })

  it('is null when the billing setting cannot be read', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const get = jest.fn().mockResolvedValue(discount())
    process.env.POLAR_DEFAULT_DISCOUNT_ID = 'disc_env'
    const service = build(
      { findOne: jest.fn(() => ({ lean: jest.fn().mockRejectedValue(new Error('db')) })) },
      get,
    )

    expect(await service.getLivePromotion(during)).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })
})
