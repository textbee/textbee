import { BillingNotificationType } from './schemas/billing-notification.schema'

/**
 * Subjects and email bodies for billing notifications, in one place.
 *
 * This used to live in two duplicated `subjectForType` maps plus message
 * strings built at four call sites, which had already drifted. The stored
 * notification keeps its own short title and message for the in-app list; this
 * module owns what the email says.
 *
 * Copy principles, since these are the emails that decide whether someone
 * upgrades:
 * - Lead with the person's situation, not the policy.
 * - Give the way out that costs nothing first, then the paid one. Someone who
 *   cannot pay still needs to know they can wait or split the batch.
 * - Never scold. Hitting a limit is the product working, not the user erring.
 * - The approaching emails are the real moment: the user is still succeeding
 *   and can act calmly. The reached emails arrive when they are already stuck.
 */

const PRICING_URL = 'https://textbee.dev/pricing'
const ACCOUNT_URL = 'https://app.textbee.dev/dashboard/account'

export const NOTIFICATION_SUBJECTS: Record<string, string> = {
  [BillingNotificationType.DAILY_LIMIT_APPROACHING]:
    "You've used most of today's messages",
  [BillingNotificationType.MONTHLY_LIMIT_APPROACHING]:
    "You've used most of this month's messages",
  [BillingNotificationType.DAILY_LIMIT_REACHED]:
    "You've hit today's message limit",
  [BillingNotificationType.MONTHLY_LIMIT_REACHED]:
    "You've hit this month's message limit",
  [BillingNotificationType.BULK_SMS_LIMIT_REACHED]:
    'That batch was larger than your plan allows',
  [BillingNotificationType.DEVICE_LIMIT_REACHED]:
    "You've connected all the devices your plan allows",
  [BillingNotificationType.EMAIL_VERIFICATION_REQUIRED]:
    'Verify your email to keep sending',
}

export function subjectForType(type: string, fallback?: string): string {
  return NOTIFICATION_SUBJECTS[type] || fallback || 'Account notification'
}

export interface NotificationEmailContent {
  title: string
  preheader: string
  message: string
  usage?: { label: string; used: string; limit: string; percent: number }
  resetNote?: string
  benefitsTitle?: string
  benefits?: string[]
  footnote?: string
  ctaLabel: string
  ctaUrl: string
}

const n = (value: unknown): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const fmt = (value: unknown): string => n(value).toLocaleString('en-US')

/** Clamped so a bar can never overflow its track when usage passes the limit. */
const pct = (used: unknown, limit: unknown): number => {
  const total = n(limit)
  if (total <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((n(used) / total) * 100)))
}

const MORE_VOLUME = [
  'A higher monthly message allowance',
  'No daily cap, so a busy day does not stop you',
  'Connect more Android devices to share the load',
]

export function buildEmailContent(
  type: string,
  meta: Record<string, any> = {},
  fallbackTitle = '',
  fallbackMessage = '',
): NotificationEmailContent {
  switch (type) {
    case BillingNotificationType.DAILY_LIMIT_APPROACHING: {
      const used = meta.processedSmsToday
      const limit = meta.dailyLimit
      const left = Math.max(0, n(limit) - n(used))
      return {
        title: "You've used most of today's messages",
        preheader: `${fmt(used)} of ${fmt(limit)} sent today, ${fmt(left)} left.`,
        message: `You have sent ${fmt(used)} of the ${fmt(limit)} messages your plan allows per day, so ${fmt(left)} are left before sending pauses.`,
        usage: {
          label: 'Messages sent today',
          used: fmt(used),
          limit: fmt(limit),
          percent: pct(used, limit),
        },
        resetNote:
          'Your daily allowance resets at midnight, so you can also just pick this up tomorrow.',
        benefitsTitle: 'If you need the headroom today',
        benefits: MORE_VOLUME,
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.MONTHLY_LIMIT_APPROACHING: {
      const used = meta.processedSmsLastMonth
      const limit = meta.monthlyLimit
      const left = Math.max(0, n(limit) - n(used))
      return {
        title: "You've used most of this month's messages",
        preheader: `${fmt(used)} of ${fmt(limit)} sent in the last 30 days, ${fmt(left)} left.`,
        message: `You have sent ${fmt(used)} of the ${fmt(limit)} messages your plan allows, counted over the last 30 days, so ${fmt(left)} are left.`,
        usage: {
          label: 'Messages in the last 30 days',
          used: fmt(used),
          limit: fmt(limit),
          percent: pct(used, limit),
        },
        // Rolling window, not a billing period: capacity returns gradually as
        // individual messages age past 30 days, not all at once on renewal.
        resetNote:
          'This is a rolling 30 day window rather than a monthly reset, so capacity frees up gradually as your earliest messages age out.',
        benefitsTitle: 'If you would rather not wait',
        benefits: MORE_VOLUME,
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.DAILY_LIMIT_REACHED: {
      const limit = meta.dailyLimit
      return {
        title: "You've hit today's message limit",
        preheader: `Sending resumes at midnight, or move up a plan for more headroom.`,
        message: `You have sent all ${fmt(limit)} messages your plan allows today, so further sends will not go out until the allowance resets.`,
        usage: {
          label: 'Messages sent today',
          used: fmt(limit),
          limit: fmt(limit),
          percent: 100,
        },
        resetNote:
          'Sending starts again automatically at midnight. You do not need to do anything.',
        benefitsTitle: 'If you need to keep sending now',
        benefits: MORE_VOLUME,
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.MONTHLY_LIMIT_REACHED: {
      const limit = meta.monthlyLimit
      return {
        title: "You've hit this month's message limit",
        preheader:
          'Capacity returns as older messages age out, or move up a plan to carry on now.',
        message: `You have sent all ${fmt(limit)} messages your plan allows over the last 30 days, so further sends will not go out until some of that usage ages out.`,
        usage: {
          label: 'Messages in the last 30 days',
          used: fmt(limit),
          limit: fmt(limit),
          percent: 100,
        },
        resetNote:
          'Usage is counted over a rolling 30 day window, so sending starts again on its own as your earliest messages pass that mark.',
        benefitsTitle: 'If you need to keep sending now',
        benefits: MORE_VOLUME,
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.BULK_SMS_LIMIT_REACHED: {
      const limit = meta.bulkSendLimit
      const attempted = meta.attempted
      return {
        title: 'That batch was larger than your plan allows',
        preheader: `Split it into smaller batches, or move up a plan.`,
        message: `You tried to send to ${fmt(attempted)} recipients in one request, and your plan allows ${fmt(limit)} per batch. Nothing was sent.`,
        // Deliberately no usage bar: this is attempted against a maximum, not
        // consumption against an allowance, and a full bar would imply the
        // quota is spent when it is not.
        resetNote: `Splitting the file into batches of ${fmt(limit)} or fewer will send it as it is, at no extra cost.`,
        benefitsTitle: 'Or move up a plan for',
        benefits: [
          'A larger batch size, so a whole list goes in one request',
          'A higher monthly message allowance',
          'Connect more Android devices to share the load',
        ],
        footnote:
          'Whatever the batch size, your phone sends one message at a time, so a large campaign is delivered steadily rather than all at once.',
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.DEVICE_LIMIT_REACHED: {
      const limit = meta.deviceLimit
      return {
        title: "You've connected all the devices your plan allows",
        preheader:
          'Remove a device you no longer use, or move up a plan for more.',
        message: `Your plan covers ${fmt(limit)} active device${n(limit) === 1 ? '' : 's'}, and they are all in use. Removing one you no longer need frees the slot straight away.`,
        benefitsTitle: 'More devices also means',
        benefits: [
          'Sends spread across several phones instead of queueing on one',
          'A spare gateway if one phone goes offline',
        ],
        ctaLabel: 'See plans',
        ctaUrl: PRICING_URL,
      }
    }

    case BillingNotificationType.EMAIL_VERIFICATION_REQUIRED: {
      return {
        title: 'Verify your email to keep sending',
        preheader: 'One click confirms the address on your account.',
        message:
          'Confirm the email address on your account and everything carries on as normal. It takes one click.',
        ctaLabel: 'Verify my email',
        ctaUrl: ACCOUNT_URL,
      }
    }

    default:
      return {
        title: fallbackTitle || 'Account notification',
        preheader: fallbackMessage.slice(0, 120),
        message: fallbackMessage,
        ctaLabel: 'Open dashboard',
        ctaUrl: 'https://app.textbee.dev/dashboard',
      }
  }
}
