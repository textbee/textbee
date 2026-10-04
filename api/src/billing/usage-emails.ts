import { BillingNotificationType } from './schemas/billing-notification.schema'

const DAY_MS = 24 * 60 * 60 * 1000

type Tier = 'free' | 'pro' | 'top'

const tierOf = (planName?: string): Tier => {
  if (!planName || planName === 'free') return 'free'
  return planName === 'pro' ? 'pro' : 'top'
}

const KEYS: Partial<Record<BillingNotificationType, Record<Tier, string | null>>> = {
  [BillingNotificationType.MONTHLY_LIMIT_APPROACHING]: { free: 'U1', pro: 'U1_paid', top: 'U1_paid' },
  [BillingNotificationType.MONTHLY_LIMIT_REACHED]: { free: 'U2', pro: 'U2_paid', top: 'U2_top' },
  [BillingNotificationType.DAILY_LIMIT_APPROACHING]: { free: 'U3', pro: null, top: null },
  [BillingNotificationType.DAILY_LIMIT_REACHED]: { free: 'U4', pro: null, top: null },
  [BillingNotificationType.BULK_SMS_LIMIT_REACHED]: { free: 'U5', pro: null, top: null },
  [BillingNotificationType.DEVICE_LIMIT_REACHED]: { free: 'U6', pro: 'U6_paid', top: 'U6_paid' },
}

/** Email template for a usage notice on this plan, or null when none applies. */
export const usageEmailKey = (
  type: BillingNotificationType,
  planName?: string,
): string | null => KEYS[type]?.[tierOf(planName)] ?? null

/**
 * How often each usage email may go to one account, counted from sent emails.
 * `perPeriod` emails go once per billing period; `windowMs` applies when the
 * period is unknown.
 */
export const USAGE_EMAIL_LIMITS: Record<
  string,
  {
    windowMs: number
    perPeriod?: boolean
    maxInWindow?: { windowMs: number; count: number }
  }
> = {
  U1: { windowMs: 30 * DAY_MS, perPeriod: true },
  U1_paid: { windowMs: 30 * DAY_MS, perPeriod: true },
  U2: { windowMs: 30 * DAY_MS, perPeriod: true },
  U2_paid: { windowMs: 30 * DAY_MS, perPeriod: true },
  U2_top: { windowMs: 30 * DAY_MS, perPeriod: true },
  U3: { windowMs: 7 * DAY_MS },
  U4: { windowMs: 7 * DAY_MS, maxInWindow: { windowMs: 90 * DAY_MS, count: 3 } },
  U5: { windowMs: 7 * DAY_MS },
  U6: { windowMs: 30 * DAY_MS },
  U6_paid: { windowMs: 30 * DAY_MS },
}

export const planLabel = (planName?: string): string => {
  if (!planName || planName === 'free') return 'free'
  if (planName.startsWith('custom')) return 'custom'
  return planName.charAt(0).toUpperCase() + planName.slice(1)
}

// Countries that use one time zone, so midnight UTC has one local time.
const SINGLE_ZONE: Record<string, string> = {
  AE: 'Asia/Dubai', AT: 'Europe/Vienna', BD: 'Asia/Dhaka', BE: 'Europe/Brussels',
  BG: 'Europe/Sofia', CH: 'Europe/Zurich', CZ: 'Europe/Prague', DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen', EG: 'Africa/Cairo', ET: 'Africa/Addis_Ababa',
  FI: 'Europe/Helsinki', FR: 'Europe/Paris', GB: 'Europe/London', GH: 'Africa/Accra',
  GR: 'Europe/Athens', HK: 'Asia/Hong_Kong', HU: 'Europe/Budapest', IE: 'Europe/Dublin',
  IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata', IT: 'Europe/Rome', JP: 'Asia/Tokyo',
  KE: 'Africa/Nairobi', KR: 'Asia/Seoul', LK: 'Asia/Colombo', MY: 'Asia/Kuala_Lumpur',
  NG: 'Africa/Lagos', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', NP: 'Asia/Kathmandu',
  PH: 'Asia/Manila', PK: 'Asia/Karachi', PL: 'Europe/Warsaw', QA: 'Asia/Qatar',
  RO: 'Europe/Bucharest', SA: 'Asia/Riyadh', SE: 'Europe/Stockholm', SG: 'Asia/Singapore',
  SK: 'Europe/Bratislava', TH: 'Asia/Bangkok', TR: 'Europe/Istanbul', TW: 'Asia/Taipei',
  TZ: 'Africa/Dar_es_Salaam', UG: 'Africa/Kampala', VN: 'Asia/Ho_Chi_Minh',
  ZA: 'Africa/Johannesburg',
}

/** Local time of the next midnight UTC as "HH:MM", or undefined for multi-zone countries. */
export const localMidnight = (country: string | undefined, now: Date): string | undefined => {
  const zone = country ? SINGLE_ZONE[country.toUpperCase()] : undefined
  if (!zone) return undefined
  const midnight = new Date(now.getTime())
  midnight.setUTCHours(24, 0, 0, 0)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(midnight)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}
