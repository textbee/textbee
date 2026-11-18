import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { createPolar, type Polar } from '@polar-sh/sdk/2026-10'
import {
  BILLING_SETTINGS_KEY,
  BillingSetting,
  BillingSettingDocument,
} from './schemas/billing-setting.schema'

export const PROMOTION_CACHE_MS = 60_000

/** The fields of a Polar discount that the live rule reads. */
export type PromotionDiscount = {
  id: string
  name: string
  type: string
  basis_points?: number
  duration: string
  duration_in_months?: number | null
  starts_at: string | null
  ends_at: string | null
  max_redemptions: number | null
  redemptions_count: number
  products?: Array<{ id: string }>
}

/** A discount that passed the live rule. */
export type LivePromotion = { discount: PromotionDiscount }

export type PlanPromotion = {
  label: string
  percentOff: number
  endsAt: string | null
  duration: 'once' | 'repeating' | 'forever'
  durationInMonths: number | null
  monthlyPrice: number | null
  yearlyPrice: number | null
  newCheckoutsOnly: true
}

type PromotionPlan = {
  monthlyPrice?: number
  yearlyPrice?: number
  polarMonthlyProductId?: string
  polarYearlyProductId?: string
}

const time = (value?: string | Date | null): number | null => {
  if (value === null || value === undefined) return null
  const at = new Date(value).getTime()
  return Number.isNaN(at) ? null : at
}

/**
 * Whether a discount applies to new checkouts at `now`: a percentage, past
 * both its Polar start and `activeFrom`, before its end, and under its cap.
 */
export function isPromotionLive(
  discount: PromotionDiscount | null | undefined,
  activeFrom: Date | null | undefined,
  now: Date,
): boolean {
  if (!discount) return false
  if (discount.type !== 'percentage') return false
  if (!(typeof discount.basis_points === 'number' && discount.basis_points > 0)) return false
  const starts = [time(discount.starts_at), time(activeFrom)].filter(
    (at): at is number => at !== null,
  )
  if (starts.length && now.getTime() < Math.max(...starts)) return false
  const ends = time(discount.ends_at)
  if (ends !== null && now.getTime() >= ends) return false
  if (
    typeof discount.max_redemptions === 'number' &&
    (discount.redemptions_count ?? 0) >= discount.max_redemptions
  ) {
    return false
  }
  return true
}

/**
 * Whether the discount covers a product. An empty product list covers all; a
 * missing or malformed one covers none.
 */
export function promotionCovers(
  discount: PromotionDiscount,
  productId?: string | null,
): boolean {
  if (!productId || !Array.isArray(discount.products)) return false
  const products = discount.products
  return products.length === 0 || products.some((p) => p?.id === productId)
}

/**
 * Whether Polar refused a checkout because of its discount: a 4xx (not 429)
 * whose validation detail points at discount_id, or whose error text names the
 * discount. Network errors, timeouts and 5xx are not. The error message is
 * never read, since it carries the request body.
 */
export function isDiscountRejection(error: unknown): boolean {
  const status = (error as { statusCode?: unknown })?.statusCode
  if (typeof status !== 'number' || status < 400 || status >= 500 || status === 429) {
    return false
  }
  const body = (error as { error?: unknown }).error as
    | { detail?: unknown; error?: unknown }
    | undefined
  if (!body || typeof body !== 'object') return false
  if (Array.isArray(body.detail)) {
    return body.detail.some(
      (item) => Array.isArray(item?.loc) && item.loc.includes('discount_id'),
    )
  }
  return [body.detail, body.error].some(
    (text) => typeof text === 'string' && /discount/i.test(text),
  )
}

/** Price in cents after a percentage discount given in basis points. */
export function salePrice(cents: number, basisPoints: number): number {
  return cents - Math.round((cents * basisPoints) / 10000)
}

/** The promotion shown on a plan, or null when it covers neither interval. */
export function planPromotion(
  plan: PromotionPlan,
  live: LivePromotion | null,
): PlanPromotion | null {
  if (!live) return null
  const { discount } = live
  const priced = (cents: unknown, productId?: string) =>
    typeof cents === 'number' && cents > 0 && promotionCovers(discount, productId)
      ? salePrice(cents, discount.basis_points)
      : null
  const monthlyPrice = priced(plan.monthlyPrice, plan.polarMonthlyProductId)
  const yearlyPrice = priced(plan.yearlyPrice, plan.polarYearlyProductId)
  if (monthlyPrice === null && yearlyPrice === null) return null
  const duration =
    discount.duration === 'once' || discount.duration === 'repeating'
      ? discount.duration
      : 'forever'
  const ends = time(discount.ends_at)
  return {
    label: discount.name,
    percentOff: discount.basis_points / 100,
    endsAt: ends === null ? null : new Date(ends).toISOString(),
    duration,
    durationInMonths:
      duration === 'repeating' ? (discount.duration_in_months ?? null) : null,
    monthlyPrice,
    yearlyPrice,
    newCheckoutsOnly: true,
  }
}

type Resolved = { discount: PromotionDiscount | null; activeFrom: Date | null }

/**
 * Resolves the checkout discount: the billing setting, else
 * POLAR_DEFAULT_DISCOUNT_ID. The lookup, failures included, is cached for
 * PROMOTION_CACHE_MS; the live rule runs on every call.
 */
@Injectable()
export class CheckoutPromotionService {
  private polarApi: Polar
  private cached?: { at: number; result: Promise<Resolved> }

  constructor(
    @InjectModel(BillingSetting.name)
    private billingSettingModel: Model<BillingSettingDocument>,
  ) {
    this.polarApi = createPolar({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
      environment:
        process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox',
    })
  }

  /**
   * The promotion live at `now`, or null. Without `now`, the window is checked
   * against the clock after the lookup resolves. Never throws.
   */
  async getLivePromotion(now?: Date): Promise<LivePromotion | null> {
    try {
      const { discount, activeFrom } = await this.resolve()
      return isPromotionLive(discount, activeFrom, now ?? new Date()) ? { discount } : null
    } catch (error) {
      console.error('failed to resolve the checkout promotion', error?.message)
      return null
    }
  }

  private resolve(): Promise<Resolved> {
    const at = Date.now()
    if (!this.cached || at - this.cached.at >= PROMOTION_CACHE_MS) {
      const result = this.lookup()
      this.cached = { at, result }
      // A rejected lookup is never served from the cache.
      result.catch(() => {
        if (this.cached?.result === result) this.cached = undefined
      })
    }
    return this.cached.result
  }

  private async lookup(): Promise<Resolved> {
    const none: Resolved = { discount: null, activeFrom: null }
    let setting: BillingSetting | null
    try {
      setting = await this.billingSettingModel
        .findOne({ key: BILLING_SETTINGS_KEY })
        .lean<BillingSetting>()
    } catch (error) {
      // Without the setting its start time is unknown, so nothing applies.
      console.error('failed to read billing settings', error?.message)
      return none
    }
    const stored = setting?.checkoutDiscountId
    const id =
      (typeof stored === 'string' && stored.trim()) ||
      process.env.POLAR_DEFAULT_DISCOUNT_ID?.trim()
    if (!id) return none
    try {
      const discount = (await this.polarApi.discounts.get(id)) as PromotionDiscount
      return { discount: discount ?? null, activeFrom: setting?.checkoutDiscountActiveFrom ?? null }
    } catch (error) {
      console.error('failed to fetch the checkout discount', error?.message)
      return none
    }
  }
}
