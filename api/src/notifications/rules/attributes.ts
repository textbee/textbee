import { AttributeDescriptor, Operator } from './types'

// The descriptor half of the attribute registry: data only, no resolvers. The
// rule builder renders itself from this, and both sides validate incoming
// condition trees against it. This file is mirrored outside this repository.
//
// The resolver half lives per repo, in context-loader.ts here, because each app
// reads these values off the user document its own way. Every counted attribute
// is denormalised onto user.rollup precisely so both resolvers stay field reads
// rather than two hand-written aggregations that could disagree.

const TEXT: Operator[] = ['eq', 'ne', 'in', 'nin', 'exists']
const NUMERIC: Operator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'exists',
]
const FLAG: Operator[] = ['eq', 'exists']
const LIST: Operator[] = ['contains', 'exists']

export const ATTRIBUTES: ReadonlyArray<AttributeDescriptor> = [
  // ---------- user ----------
  {
    key: 'user.accountAgeDays',
    label: 'Account age (days)',
    type: 'number',
    group: 'user',
    operators: NUMERIC,
  },
  {
    key: 'user.emailVerified',
    label: 'Email verified',
    type: 'boolean',
    group: 'user',
    operators: FLAG,
    hint: 'Unverified accounts have no verification date at all rather than an empty one, so this reads as false for them.',
  },
  {
    key: 'user.verificationWaived',
    label: 'Verification waived by an operator',
    type: 'boolean',
    group: 'user',
    operators: FLAG,
    hint: 'Only the server can read this. The dashboard never receives it, which is why the old verify-email banner ignored it.',
  },
  {
    key: 'user.country',
    label: 'Signup country',
    type: 'string',
    group: 'user',
    operators: TEXT,
    hint: 'Two-letter code reported by the edge network at signup.',
  },
  {
    key: 'user.accessCountries',
    label: 'Countries ever used from',
    type: 'stringArray',
    group: 'user',
    operators: LIST,
  },
  {
    key: 'user.signupSource',
    label: 'Signup source',
    type: 'string',
    group: 'user',
    operators: TEXT,
    options: ['meta', 'reddit', 'google', 'direct'],
  },
  {
    key: 'user.signupDevice',
    label: 'Signup device class',
    type: 'string',
    group: 'user',
    operators: TEXT,
    options: ['android', 'ios', 'desktop', 'other'],
  },
  {
    key: 'user.marketingOptIn',
    label: 'Opted into marketing email',
    type: 'boolean',
    group: 'user',
    operators: FLAG,
  },
  {
    key: 'user.daysSinceLastLogin',
    label: 'Days since last login',
    type: 'number',
    group: 'user',
    operators: NUMERIC,
  },
  {
    key: 'user.deletionRequested',
    label: 'Deletion requested',
    type: 'boolean',
    group: 'user',
    operators: FLAG,
  },
  {
    key: 'user.role',
    label: 'Role',
    type: 'enum',
    group: 'user',
    operators: TEXT,
    options: ['ADMIN', 'REGULAR'],
  },
  {
    key: 'user.isBanned',
    label: 'Banned',
    type: 'boolean',
    group: 'user',
    operators: FLAG,
  },

  // ---------- client ----------
  {
    key: 'client.os',
    label: 'Last seen operating system',
    type: 'string',
    group: 'client',
    operators: TEXT,
  },
  {
    key: 'client.browser',
    label: 'Last seen browser',
    type: 'string',
    group: 'client',
    operators: TEXT,
  },
  {
    key: 'client.device',
    label: 'Last seen device class',
    type: 'string',
    group: 'client',
    operators: TEXT,
  },
  {
    key: 'client.daysSinceLastSeen',
    label: 'Days since last seen client',
    type: 'number',
    group: 'client',
    operators: NUMERIC,
  },

  // ---------- onboarding ----------
  {
    key: 'onboarding.completed',
    label: 'Onboarding completed',
    type: 'boolean',
    group: 'onboarding',
    operators: FLAG,
  },
  {
    key: 'onboarding.currentStepId',
    label: 'Current onboarding step',
    type: 'string',
    group: 'onboarding',
    operators: TEXT,
  },

  // ---------- milestones ----------
  {
    key: 'milestones.hasDevice',
    label: 'Has ever paired a device',
    type: 'boolean',
    group: 'milestones',
    operators: FLAG,
  },
  {
    key: 'milestones.hasApiKey',
    label: 'Has ever created an API key',
    type: 'boolean',
    group: 'milestones',
    operators: FLAG,
  },
  {
    key: 'milestones.hasSentSms',
    label: 'Has ever sent an SMS',
    type: 'boolean',
    group: 'milestones',
    operators: FLAG,
  },
  {
    key: 'milestones.hasPaid',
    label: 'Has ever paid',
    type: 'boolean',
    group: 'milestones',
    operators: FLAG,
  },
  {
    key: 'milestones.daysSinceFirstSms',
    label: 'Days since first SMS',
    type: 'number',
    group: 'milestones',
    operators: NUMERIC,
  },

  // ---------- subscription ----------
  {
    key: 'subscription.planName',
    label: 'Plan name',
    type: 'string',
    group: 'subscription',
    operators: TEXT,
    options: ['free', 'pro', 'scale'],
    hint: 'Custom plans are named with a custom- prefix, so match those with "in" rather than equality.',
  },
  {
    key: 'subscription.isPaid',
    label: 'On a paid plan',
    type: 'boolean',
    group: 'subscription',
    operators: FLAG,
  },
  {
    key: 'subscription.status',
    label: 'Subscription status',
    type: 'enum',
    group: 'subscription',
    operators: TEXT,
    options: [
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
    ],
  },
  {
    key: 'subscription.cancelAtPeriodEnd',
    label: 'Cancels at period end',
    type: 'boolean',
    group: 'subscription',
    operators: FLAG,
  },
  {
    key: 'subscription.daysUntilPeriodEnd',
    label: 'Days until period end',
    type: 'number',
    group: 'subscription',
    operators: NUMERIC,
  },

  // ---------- usage ----------
  {
    key: 'usage.monthlyCount',
    label: 'Messages this month',
    type: 'number',
    group: 'usage',
    operators: NUMERIC,
  },
  {
    key: 'usage.dailyCount',
    label: 'Messages today',
    type: 'number',
    group: 'usage',
    operators: NUMERIC,
  },
  {
    key: 'usage.monthlyPercent',
    label: 'Percent of monthly allowance used',
    type: 'number',
    group: 'usage',
    operators: NUMERIC,
    hint: 'Measured against the effective allowance, which for paid plans is larger than the nominal plan limit.',
  },
  {
    key: 'usage.dailyPercent',
    label: 'Percent of daily allowance used',
    type: 'number',
    group: 'usage',
    operators: NUMERIC,
  },

  // ---------- stats ----------
  {
    key: 'stats.deviceCount',
    label: 'Devices paired',
    type: 'number',
    group: 'stats',
    operators: NUMERIC,
  },
  {
    key: 'stats.apiKeyCount',
    label: 'API keys',
    type: 'number',
    group: 'stats',
    operators: NUMERIC,
  },
  {
    key: 'stats.totalSentSms',
    label: 'Messages sent all time',
    type: 'number',
    group: 'stats',
    operators: NUMERIC,
  },
  {
    key: 'stats.hasOutdatedApp',
    label: 'Has an outdated Android app',
    type: 'boolean',
    group: 'stats',
    operators: FLAG,
  },

  // ---------- sending ----------
  {
    key: 'sending.needsSmsPermission',
    label: 'Sending blocked by a missing SMS permission',
    type: 'boolean',
    group: 'sending',
    operators: FLAG,
    hint: 'True while the latest outgoing message failed with PERMISSION_DENIED and the phone has not reported the permission granted since. Unknown for accounts that never sent.',
  },
  {
    key: 'sending.hoursSinceLastPermissionFailure',
    label: 'Hours since sending was blocked by a missing SMS permission',
    type: 'number',
    group: 'sending',
    operators: NUMERIC,
    hint: 'Only set while sending is blocked.',
  },

  // ---------- state ----------
  // Self-referential: these describe this account's history with the
  // notification being evaluated, which is what makes "stop after three views"
  // and "show the next one once this is dismissed" ordinary targeting.
  {
    key: 'state.impressions',
    label: 'Times this account has seen this notification',
    type: 'number',
    group: 'state',
    operators: NUMERIC,
  },
  {
    key: 'state.daysSinceLastImpression',
    label: 'Days since this notification was last seen',
    type: 'number',
    group: 'state',
    operators: NUMERIC,
  },
  {
    key: 'state.wasDismissed',
    label: 'This notification was dismissed',
    type: 'boolean',
    group: 'state',
    operators: FLAG,
  },
  {
    key: 'state.wasClicked',
    label: 'This notification was clicked',
    type: 'boolean',
    group: 'state',
    operators: FLAG,
  },
]

export const ATTRIBUTES_BY_KEY: ReadonlyMap<string, AttributeDescriptor> =
  new Map(ATTRIBUTES.map((a) => [a.key, a]))

export const ATTRIBUTE_GROUPS: ReadonlyArray<string> = [
  ...new Set(ATTRIBUTES.map((a) => a.group)),
]
