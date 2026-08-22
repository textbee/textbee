import {
  buildEmailContent,
  NOTIFICATION_SUBJECTS,
  subjectForType,
} from './notification-content'
import { BillingNotificationType } from './schemas/billing-notification.schema'

describe('notification content', () => {
  it('has a subject for every notification type', () => {
    for (const type of Object.values(BillingNotificationType)) {
      expect(NOTIFICATION_SUBJECTS[type]).toBeTruthy()
    }
  })

  it('falls back rather than inventing a subject for an unknown type', () => {
    expect(subjectForType('not_a_real_type', 'Stored title')).toBe('Stored title')
    expect(subjectForType('not_a_real_type')).toBe('Account notification')
  })

  it('never uses an em dash or en dash in user-facing copy', () => {
    for (const type of Object.values(BillingNotificationType)) {
      const content = buildEmailContent(type, {
        processedSmsToday: 42,
        processedSmsLastMonth: 4100,
        dailyLimit: 50,
        monthlyLimit: 5000,
        bulkSendLimit: 50,
        deviceLimit: 1,
        attempted: 1200,
      })
      const text = [
        NOTIFICATION_SUBJECTS[type],
        content.title,
        content.preheader,
        content.message,
        content.resetNote,
        content.footnote,
        content.benefitsTitle,
        ...(content.benefits ?? []),
      ]
        .filter(Boolean)
        .join(' ')
      expect(text).not.toMatch(/[–—]/)
    }
  })

  it('sends every upgrade CTA to the pricing page, not an anchor', () => {
    for (const type of Object.values(BillingNotificationType)) {
      const { ctaUrl, ctaLabel } = buildEmailContent(type, {})
      expect(ctaLabel).toBeTruthy()
      expect(ctaUrl).toMatch(/^https:\/\//)
      expect(ctaUrl).not.toContain('#pricing')
    }
  })

  describe('approaching a limit', () => {
    it('describes the monthly counter as a rolling window, not a reset', () => {
      // processedSmsLastMonth counts from one month before now, so telling a
      // user their allowance resets at renewal would be wrong.
      for (const type of [
        BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
        BillingNotificationType.MONTHLY_LIMIT_REACHED,
      ]) {
        const content = buildEmailContent(type, {
          processedSmsLastMonth: 5000,
          monthlyLimit: 5000,
        })
        const text = [content.message, content.resetNote, content.preheader]
          .filter(Boolean)
          .join(' ')
        expect(text).toMatch(/30 day|age out|ages out/i)
        expect(text).not.toMatch(/billing period/i)
      }
    })

    it('reports what is left, not just what is used', () => {
      const content = buildEmailContent(
        BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
        { processedSmsLastMonth: 4100, monthlyLimit: 5000 },
      )
      expect(content.message).toContain('4,100')
      expect(content.message).toContain('5,000')
      expect(content.message).toContain('900')
      expect(content.usage).toEqual({
        label: 'Messages in the last 30 days',
        used: '4,100',
        limit: '5,000',
        percent: 82,
      })
    })

    it('offers the free way out before the paid one', () => {
      const content = buildEmailContent(
        BillingNotificationType.DAILY_LIMIT_REACHED,
        { dailyLimit: 50 },
      )
      expect(content.resetNote).toMatch(/automatically/i)
      // the upgrade is present, but framed as the alternative
      expect(content.benefitsTitle).toMatch(/if you need/i)
    })
  })

  describe('bulk limit', () => {
    const content = buildEmailContent(
      BillingNotificationType.BULK_SMS_LIMIT_REACHED,
      { attempted: 1200, bulkSendLimit: 50 },
    )

    it('says plainly that nothing was sent', () => {
      expect(content.message).toContain('Nothing was sent')
      expect(content.message).toContain('1,200')
      expect(content.message).toContain('50')
    })

    it('leads with splitting the batch, which costs nothing', () => {
      expect(content.resetNote).toMatch(/splitting/i)
      expect(content.resetNote).toMatch(/no extra cost/i)
    })

    it('shows no usage bar, since attempted is not consumption', () => {
      // A full bar here would imply the quota was spent, which it was not.
      expect(content.usage).toBeUndefined()
    })
  })

  describe('usage percentages', () => {
    it('clamps past the limit rather than overflowing the bar', () => {
      const content = buildEmailContent(
        BillingNotificationType.MONTHLY_LIMIT_APPROACHING,
        { processedSmsLastMonth: 9999, monthlyLimit: 5000 },
      )
      expect(content.usage?.percent).toBe(100)
    })

    it('survives a missing or zero limit without dividing by zero', () => {
      const content = buildEmailContent(
        BillingNotificationType.DAILY_LIMIT_APPROACHING,
        { processedSmsToday: 10 },
      )
      expect(content.usage?.percent).toBe(100)
      expect(content.message).toContain('10')
    })
  })
})
