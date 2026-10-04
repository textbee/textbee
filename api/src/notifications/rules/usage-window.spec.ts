import { readFileSync } from 'fs'
import { join } from 'path'
import {
  allowancePercent,
  dailyWindowStart,
  billingPeriod,
  periodAnchor,
} from './usage-window'

// Part of the shared contract: the same assertions run against the mirrored copy,
// against its copy, so both count usage over identical windows.

describe('dailyWindowStart', () => {
  it('is midnight UTC of the same UTC day', () => {
    const start = dailyWindowStart(new Date('2026-09-27T15:42:31.500Z'))
    expect(start.toISOString()).toBe('2026-09-27T00:00:00.000Z')
  })

  it('uses the UTC day, not the server day', () => {
    const start = dailyWindowStart(new Date('2026-09-27T23:30:00-05:00'))
    expect(start.toISOString()).toBe('2026-09-28T00:00:00.000Z')
  })

  it('does not mutate its argument', () => {
    const now = new Date(2026, 8, 27, 15, 42, 31)
    const copy = new Date(now.getTime())
    dailyWindowStart(now)
    expect(now.getTime()).toBe(copy.getTime())
  })
})

// Shared with the mirrored copy and the Python twin; all must agree.
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'usage-window-cases.json'), 'utf8'),
)

describe('usage window conformance', () => {
  it.each(fixture.billingPeriod.map((c: any) => [c.name, c]))(
    'billingPeriod: %s',
    (_name, c: any) => {
      const period = billingPeriod(new Date(c.anchor), new Date(c.now))
      expect(period.start.toISOString()).toBe(c.start)
      expect(period.end.toISOString()).toBe(c.end)
    },
  )

  it.each(fixture.periodAnchor.map((c: any) => [c.name, c]))(
    'periodAnchor: %s',
    (_name, c: any) => {
      const anchor = periodAnchor({
        signupAt: c.signupAt,
        subscription: c.subscription,
      })
      expect(anchor ? anchor.toISOString() : null).toBe(c.expected)
    },
  )
})

describe('billingPeriod', () => {
  const iso = (p: { start: Date; end: Date }) => [
    p.start.toISOString(),
    p.end.toISOString(),
  ]

  it('runs from the last monthly anniversary of the anchor to the next one', () => {
    const anchor = new Date('2026-01-17T22:15:00.000Z')
    expect(iso(billingPeriod(anchor, new Date('2026-10-04T08:00:00.000Z')))).toEqual([
      '2026-09-17T22:15:00.000Z',
      '2026-10-17T22:15:00.000Z',
    ])
  })

  it('starts a new period at the exact anniversary instant', () => {
    const anchor = new Date('2026-01-17T22:15:00.000Z')
    const before = billingPeriod(anchor, new Date('2026-10-17T22:14:59.999Z'))
    const at = billingPeriod(anchor, new Date('2026-10-17T22:15:00.000Z'))
    expect(before.start.toISOString()).toBe('2026-09-17T22:15:00.000Z')
    expect(at.start.toISOString()).toBe('2026-10-17T22:15:00.000Z')
    expect(at.end.toISOString()).toBe('2026-11-17T22:15:00.000Z')
  })

  it('is the first month when the anchor is recent', () => {
    const anchor = new Date('2026-10-01T10:00:00.000Z')
    expect(iso(billingPeriod(anchor, new Date('2026-10-04T08:00:00.000Z')))).toEqual([
      '2026-10-01T10:00:00.000Z',
      '2026-11-01T10:00:00.000Z',
    ])
  })

  it('uses the last day of a month that lacks the anchor day', () => {
    const anchor = new Date('2026-01-31T12:00:00.000Z')
    expect(iso(billingPeriod(anchor, new Date('2026-03-10T00:00:00.000Z')))).toEqual([
      '2026-02-28T12:00:00.000Z',
      '2026-03-31T12:00:00.000Z',
    ])
    expect(iso(billingPeriod(anchor, new Date('2026-04-30T13:00:00.000Z')))).toEqual([
      '2026-04-30T12:00:00.000Z',
      '2026-05-31T12:00:00.000Z',
    ])
  })

  it('handles leap years', () => {
    const anchor = new Date('2027-08-29T00:00:00.000Z')
    expect(billingPeriod(anchor, new Date('2028-03-01T00:00:00.000Z')).start.toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    )
    expect(billingPeriod(anchor, new Date('2027-03-01T00:00:00.000Z')).end.toISOString()).toBe(
      '2027-03-29T00:00:00.000Z',
    )
  })

  it('crosses a year boundary', () => {
    const anchor = new Date('2025-03-20T09:00:00.000Z')
    expect(iso(billingPeriod(anchor, new Date('2026-01-05T00:00:00.000Z')))).toEqual([
      '2025-12-20T09:00:00.000Z',
      '2026-01-20T09:00:00.000Z',
    ])
  })

  it('always contains now, even when the anchor is in the future', () => {
    const now = new Date('2026-10-04T08:00:00.000Z')
    const period = billingPeriod(new Date('2026-12-10T00:00:00.000Z'), now)
    expect(period.start.getTime()).toBeLessThanOrEqual(now.getTime())
    expect(period.end.getTime()).toBeGreaterThan(now.getTime())
    expect(period.start.toISOString()).toBe('2026-09-10T00:00:00.000Z')
  })

  it('uses UTC, not the server time zone', () => {
    // 23:30 at UTC-5 is already the next UTC day.
    const anchor = new Date('2026-01-31T23:30:00-05:00')
    expect(billingPeriod(anchor, new Date('2026-02-15T00:00:00.000Z')).start.toISOString()).toBe(
      '2026-02-01T04:30:00.000Z',
    )
  })

  it('does not mutate its arguments', () => {
    const anchor = new Date('2026-01-31T12:00:00.000Z')
    const now = new Date('2026-03-10T00:00:00.000Z')
    billingPeriod(anchor, now)
    expect(anchor.toISOString()).toBe('2026-01-31T12:00:00.000Z')
    expect(now.toISOString()).toBe('2026-03-10T00:00:00.000Z')
  })
})

describe('periodAnchor', () => {
  const signupAt = new Date('2026-01-17T22:15:00.000Z')
  const started = new Date('2026-06-03T08:00:00.000Z')

  it('anchors the free plan to signup', () => {
    expect(periodAnchor({ signupAt })).toEqual(signupAt)
    expect(periodAnchor({ signupAt, subscription: null })).toEqual(signupAt)
  })

  it('anchors a plan subscription to its start date', () => {
    expect(
      periodAnchor({
        signupAt,
        subscription: { planName: 'pro', subscriptionStartDate: started },
      }),
    ).toEqual(started)
  })

  it('falls back to when the subscription was recorded', () => {
    expect(
      periodAnchor({
        signupAt,
        subscription: { planName: 'custom-acme', createdAt: started },
      }),
    ).toEqual(started)
  })

  it('treats a subscription row on the free plan as free', () => {
    expect(
      periodAnchor({
        signupAt,
        subscription: { planName: 'free', subscriptionStartDate: started },
      }),
    ).toEqual(signupAt)
  })

  it('accepts ISO strings from lean or serialised documents', () => {
    expect(
      periodAnchor({
        signupAt: signupAt.toISOString(),
        subscription: { planName: 'pro', subscriptionStartDate: started.toISOString() },
      }),
    ).toEqual(started)
  })

  it('ignores invalid dates and falls back to signup', () => {
    expect(
      periodAnchor({
        signupAt,
        subscription: { planName: 'pro', subscriptionStartDate: 'not a date' },
      }),
    ).toEqual(signupAt)
  })

  it('is undefined when no date is known', () => {
    expect(periodAnchor({ signupAt: undefined })).toBeUndefined()
  })
})

describe('allowancePercent', () => {
  it('rounds to a whole percent', () => {
    expect(allowancePercent(1, 3)).toBe(33)
  })

  it('can exceed 100', () => {
    expect(allowancePercent(120, 100)).toBe(120)
  })

  it('is zero for no usage against a real allowance', () => {
    expect(allowancePercent(0, 100)).toBe(0)
  })

  it('is unjudgeable for an unlimited allowance rather than zero', () => {
    expect(allowancePercent(50, -1)).toBeUndefined()
    expect(allowancePercent(50, 0)).toBeUndefined()
  })

  it('is unjudgeable when either side is missing', () => {
    expect(allowancePercent(undefined, 100)).toBeUndefined()
    expect(allowancePercent(50, undefined)).toBeUndefined()
  })
})
