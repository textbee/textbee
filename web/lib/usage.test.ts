import { describe, expect, it } from 'vitest'
import { deriveUsage, UNLIMITED } from './usage'

describe('deriveUsage', () => {
  it('reads the daily and monthly windows from usage', () => {
    const { daily, monthly } = deriveUsage({
      plan: { dailyLimit: 500, monthlyLimit: 5000 },
      usage: {
        dailyLimit: 500,
        monthlyLimit: 5000,
        processedSmsToday: 47,
        processedSmsLastMonth: 1204,
        dailyRemaining: 453,
        monthlyRemaining: 3796,
        dailyUsagePercentage: 9,
        monthlyUsagePercentage: 24,
        monthlyResetAt: '2026-10-17T22:15:00.000Z',
      },
    })

    expect(daily.used).toBe(47)
    expect(daily.limit).toBe(500)
    expect(daily.remaining).toBe(453)
    expect(daily.percentage).toBe(9)
    expect(daily.unlimited).toBe(false)

    expect(monthly.used).toBe(1204)
    expect(monthly.percentage).toBe(24)
    expect(monthly.resetAt).toBe('2026-10-17T22:15:00.000Z')
    expect(daily.resetAt).toBeUndefined()
  })

  it('treats -1 as unlimited and suppresses the percentage', () => {
    const { daily } = deriveUsage({
      plan: { dailyLimit: UNLIMITED },
      usage: { dailyLimit: UNLIMITED, processedSmsToday: 900 },
    })

    expect(daily.unlimited).toBe(true)
    expect(daily.percentage).toBe(0)
    expect(daily.nearLimit).toBe(false)
    expect(daily.atLimit).toBe(false)
    // Usage is still reported, there is just nothing to measure it against.
    expect(daily.used).toBe(900)
  })

  it('prefers usage limits over plan limits (custom overrides)', () => {
    const { daily } = deriveUsage({
      plan: { dailyLimit: 50 },
      usage: { dailyLimit: 5000, processedSmsToday: 100 },
    })

    expect(daily.limit).toBe(5000)
  })

  it('flags the near-limit threshold', () => {
    const { daily } = deriveUsage({
      usage: { dailyLimit: 100, processedSmsToday: 85, dailyUsagePercentage: 85 },
    })

    expect(daily.nearLimit).toBe(true)
    expect(daily.atLimit).toBe(false)
  })

  it('flags being at the limit and clamps an over-100 percentage', () => {
    // Happens when a limit is lowered mid-period.
    const { daily } = deriveUsage({
      usage: {
        dailyLimit: 100,
        processedSmsToday: 150,
        dailyUsagePercentage: 150,
      },
    })

    expect(daily.percentage).toBe(100)
    expect(daily.atLimit).toBe(true)
    expect(daily.nearLimit).toBe(false)
  })

  it('is safe on an undefined subscription', () => {
    const { daily, monthly } = deriveUsage(undefined)

    expect(daily.used).toBe(0)
    expect(daily.limit).toBeUndefined()
    expect(daily.unlimited).toBe(false)
    expect(monthly.used).toBe(0)
  })
})
