import { BillingNotificationType as T } from './schemas/billing-notification.schema'
import { localMidnight, planLabel, usageEmailKey } from './usage-emails'

describe('usageEmailKey', () => {
  it.each([
    [T.MONTHLY_LIMIT_APPROACHING, 'free', 'U1'],
    [T.MONTHLY_LIMIT_APPROACHING, 'pro', 'U1_paid'],
    [T.MONTHLY_LIMIT_APPROACHING, 'scale', 'U1_paid'],
    [T.MONTHLY_LIMIT_REACHED, 'free', 'U2'],
    [T.MONTHLY_LIMIT_REACHED, 'pro', 'U2_paid'],
    [T.MONTHLY_LIMIT_REACHED, 'scale', 'U2_top'],
    [T.MONTHLY_LIMIT_REACHED, 'custom-acme', 'U2_top'],
    [T.DAILY_LIMIT_APPROACHING, 'free', 'U3'],
    [T.DAILY_LIMIT_APPROACHING, 'custom-acme', null],
    [T.DAILY_LIMIT_REACHED, 'free', 'U4'],
    [T.DAILY_LIMIT_REACHED, 'pro', null],
    [T.BULK_SMS_LIMIT_REACHED, 'free', 'U5'],
    [T.BULK_SMS_LIMIT_REACHED, 'custom-acme', null],
    [T.DEVICE_LIMIT_REACHED, 'free', 'U6'],
    [T.DEVICE_LIMIT_REACHED, 'pro', 'U6_paid'],
    [T.DEVICE_LIMIT_REACHED, 'custom-acme', 'U6_paid'],
    [T.EMAIL_VERIFICATION_REQUIRED, 'free', null],
  ])('%s on %s is %s', (type, plan, key) => {
    expect(usageEmailKey(type, plan)).toBe(key)
  })
})

describe('planLabel', () => {
  it('names plans the way the emails do', () => {
    expect(planLabel('free')).toBe('free')
    expect(planLabel('pro')).toBe('Pro')
    expect(planLabel('scale')).toBe('Scale')
    expect(planLabel('custom-acme')).toBe('custom')
  })
})

describe('localMidnight', () => {
  const now = new Date('2026-01-15T10:00:00Z')

  it('gives the local time of midnight UTC for single zone countries', () => {
    expect(localMidnight('IN', now)).toBe('05:30')
    expect(localMidnight('de', now)).toBe('01:00')
    expect(localMidnight('DE', new Date('2026-07-15T10:00:00Z'))).toBe('02:00')
  })

  it('is undefined for multi-zone or unknown countries', () => {
    expect(localMidnight('US', now)).toBeUndefined()
    expect(localMidnight(undefined, now)).toBeUndefined()
  })
})
