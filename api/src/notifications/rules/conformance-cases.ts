import { ConditionNode, EvaluationContext, TriState } from './types'
import { AccountState, Candidate, SelectionSettings } from './notification-ranker'
import { HrefTokenValues } from './interpolate-href'

// THE SHARED CONTRACT. This file is mirrored outside this repository and
// run by both test suites against each repo's own copy of the evaluator and
// ranker. The two APIs never call each other, so nothing else would catch them
// drifting apart: if this file and its spec pass on both sides, a preview
// and the live feed agree.
//
// Adding an operator or changing a semantic means adding cases here in the same
// commit, then copying this file across. Do not add a case that depends on
// anything outside these inputs.

export interface ConditionCase {
  name: string
  condition: ConditionNode | null
  context: EvaluationContext
  expected: TriState
}

export const CONDITION_CASES: ConditionCase[] = [
  // ---------- shape ----------
  {
    name: 'no audience matches everyone',
    condition: null,
    context: {},
    expected: 'true',
  },
  {
    name: 'empty all is vacuously true, so an untargeted record still shows',
    condition: { all: [] },
    context: {},
    expected: 'true',
  },
  {
    name: 'empty any is false, since no alternative was satisfied',
    condition: { any: [] },
    context: {},
    expected: 'false',
  },
  {
    name: 'a node with none of all, any, not or attr is unknown',
    condition: {} as ConditionNode,
    context: {},
    expected: 'unknown',
  },

  // ---------- equality and text ----------
  {
    name: 'eq matches',
    condition: { attr: 'subscription.planName', op: 'eq', value: 'free' },
    context: { 'subscription.planName': 'free' },
    expected: 'true',
  },
  {
    name: 'eq is case sensitive',
    condition: { attr: 'subscription.planName', op: 'eq', value: 'Free' },
    context: { 'subscription.planName': 'free' },
    expected: 'false',
  },
  {
    name: 'ne matches when different',
    condition: { attr: 'subscription.planName', op: 'ne', value: 'pro' },
    context: { 'subscription.planName': 'free' },
    expected: 'true',
  },
  {
    name: 'in matches a member',
    condition: {
      attr: 'subscription.status',
      op: 'in',
      value: ['past_due', 'unpaid'],
    },
    context: { 'subscription.status': 'past_due' },
    expected: 'true',
  },
  {
    name: 'nin excludes a member',
    condition: {
      attr: 'subscription.status',
      op: 'nin',
      value: ['past_due', 'unpaid'],
    },
    context: { 'subscription.status': 'past_due' },
    expected: 'false',
  },
  {
    name: 'in with a non-list value cannot be judged',
    condition: {
      attr: 'subscription.status',
      op: 'in',
      value: 'past_due' as unknown as string[],
    },
    context: { 'subscription.status': 'past_due' },
    expected: 'unknown',
  },

  // ---------- numbers ----------
  {
    name: 'gte at the boundary',
    condition: { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
    context: { 'usage.monthlyPercent': 80 },
    expected: 'true',
  },
  {
    name: 'gt at the boundary',
    condition: { attr: 'usage.monthlyPercent', op: 'gt', value: 80 },
    context: { 'usage.monthlyPercent': 80 },
    expected: 'false',
  },
  {
    name: 'between is inclusive at both ends',
    condition: {
      attr: 'user.accountAgeDays',
      op: 'between',
      value: [30, 60],
    },
    context: { 'user.accountAgeDays': 60 },
    expected: 'true',
  },
  {
    name: 'between rejects a malformed range',
    condition: {
      attr: 'user.accountAgeDays',
      op: 'between',
      value: [30] as unknown as number[],
    },
    context: { 'user.accountAgeDays': 45 },
    expected: 'unknown',
  },
  {
    name: 'comparing a number attribute against text cannot be judged',
    condition: {
      attr: 'user.accountAgeDays',
      op: 'gt',
      value: '30' as unknown as number,
    },
    context: { 'user.accountAgeDays': 45 },
    expected: 'unknown',
  },
  {
    name: 'zero is a real value, not an absence',
    condition: { attr: 'stats.deviceCount', op: 'eq', value: 0 },
    context: { 'stats.deviceCount': 0 },
    expected: 'true',
  },

  // ---------- booleans, and the absent-vs-null trap ----------
  {
    name: 'boolean eq false matches an explicit false',
    condition: { attr: 'user.emailVerified', op: 'eq', value: false },
    context: { 'user.emailVerified': false },
    expected: 'true',
  },
  {
    // The bug that made the original verification gate never fire: unverified
    // accounts have no date at all rather than a null one. The resolver must
    // therefore hand the evaluator a real boolean, never the raw field.
    name: 'a resolver turning an absent date into false is judged normally',
    condition: { attr: 'user.emailVerified', op: 'eq', value: false },
    context: { 'user.emailVerified': false },
    expected: 'true',
  },
  {
    name: 'an absent attribute is unknown, not false',
    condition: { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
    context: {},
    expected: 'unknown',
  },
  {
    name: 'an explicitly null attribute is unknown too',
    condition: { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
    context: { 'usage.monthlyPercent': null },
    expected: 'unknown',
  },
  {
    name: 'a negative test on an absent attribute is still not a match',
    condition: { attr: 'subscription.planName', op: 'ne', value: 'free' },
    context: {},
    expected: 'unknown',
  },

  // ---------- exists ----------
  {
    name: 'exists true on a present value',
    condition: { attr: 'user.country', op: 'exists', value: true },
    context: { 'user.country': 'US' },
    expected: 'true',
  },
  {
    name: 'exists false on an absent value',
    condition: { attr: 'user.country', op: 'exists', value: false },
    context: {},
    expected: 'true',
  },
  {
    name: 'exists defaults to true when no value is given',
    condition: { attr: 'user.country', op: 'exists' },
    context: { 'user.country': 'US' },
    expected: 'true',
  },

  // ---------- lists ----------
  {
    name: 'contains finds a member',
    condition: { attr: 'user.accessCountries', op: 'contains', value: 'CA' },
    context: { 'user.accessCountries': ['US', 'CA'] },
    expected: 'true',
  },
  {
    name: 'contains on an empty list is false',
    condition: { attr: 'user.accessCountries', op: 'contains', value: 'CA' },
    context: { 'user.accessCountries': [] },
    expected: 'false',
  },
  {
    name: 'eq against a list attribute cannot be judged',
    condition: {
      attr: 'user.accessCountries',
      op: 'eq',
      value: 'CA',
    },
    context: { 'user.accessCountries': ['CA'] },
    expected: 'unknown',
  },

  // ---------- registry guards ----------
  {
    name: 'an attribute this build does not know fails closed',
    condition: { attr: 'user.favouriteColour', op: 'eq', value: 'blue' },
    context: { 'user.favouriteColour': 'blue' },
    expected: 'unknown',
  },
  {
    name: 'an operator the attribute does not allow fails closed',
    condition: { attr: 'user.emailVerified', op: 'gt', value: 1 },
    context: { 'user.emailVerified': true },
    expected: 'unknown',
  },

  // ---------- Kleene logic ----------
  {
    name: 'all is false when any branch is false, even beside an unknown',
    condition: {
      all: [
        { attr: 'subscription.planName', op: 'eq', value: 'pro' },
        { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
      ],
    },
    context: { 'subscription.planName': 'free' },
    expected: 'false',
  },
  {
    name: 'all is unknown when nothing is false but something is unjudgeable',
    condition: {
      all: [
        { attr: 'subscription.planName', op: 'eq', value: 'free' },
        { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
      ],
    },
    context: { 'subscription.planName': 'free' },
    expected: 'unknown',
  },
  {
    name: 'any is true on one true branch despite an unknown',
    condition: {
      any: [
        { attr: 'subscription.planName', op: 'eq', value: 'free' },
        { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
      ],
    },
    context: { 'subscription.planName': 'free' },
    expected: 'true',
  },
  {
    name: 'any is unknown when nothing is true but something is unjudgeable',
    condition: {
      any: [
        { attr: 'subscription.planName', op: 'eq', value: 'pro' },
        { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
      ],
    },
    context: { 'subscription.planName': 'free' },
    expected: 'unknown',
  },
  {
    name: 'not inverts a definite false',
    condition: { not: { attr: 'subscription.isPaid', op: 'eq', value: true } },
    context: { 'subscription.isPaid': false },
    expected: 'true',
  },
  {
    // The whole reason the engine is three-valued. Under booleans this would
    // return true and target every account whose data we do not have.
    name: 'not leaves an unknown unknown rather than flipping it to true',
    condition: {
      not: { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
    },
    context: {},
    expected: 'unknown',
  },
  {
    name: 'a realistic nested tree',
    condition: {
      all: [
        { attr: 'subscription.planName', op: 'eq', value: 'free' },
        { attr: 'user.accountAgeDays', op: 'gte', value: 30 },
        {
          any: [
            { attr: 'usage.monthlyPercent', op: 'gte', value: 50 },
            { attr: 'milestones.hasSentSms', op: 'eq', value: true },
          ],
        },
        { not: { attr: 'state.wasDismissed', op: 'eq', value: true } },
      ],
    },
    context: {
      'subscription.planName': 'free',
      'user.accountAgeDays': 45,
      'usage.monthlyPercent': 10,
      'milestones.hasSentSms': true,
      'state.wasDismissed': false,
    },
    expected: 'true',
  },
]

// ---------------------------------------------------------------------------
// Selection cases: filtering, ranking, group collapse, caps, variant choice.
// ---------------------------------------------------------------------------

export interface SelectionCase {
  name: string
  candidates: Candidate[]
  states?: AccountState[]
  settings?: Partial<SelectionSettings>
  baseContext?: EvaluationContext
  nowIso?: string
  seed?: string
  tokens?: HrefTokenValues
  /** Served keys, in order. */
  expectedServed: string[]
  /** Only the reasons asserted; other filtered records are ignored. */
  expectedReasons?: Record<string, string>
  /** Per served key, the href its first action must come out with. */
  expectedHrefs?: Record<string, string>
}

const NOW = '2026-09-27T12:00:00.000Z'

function tile(over: Partial<Candidate> & { id: string; key: string }): Candidate {
  return {
    kind: 'campaign',
    placement: 'tile',
    tone: 'info',
    priority: 0,
    weight: 1,
    variants: [{ id: 'v1', title: over.key }],
    ...over,
  }
}

export const SELECTION_CASES: SelectionCase[] = [
  {
    name: 'system records rank above campaigns regardless of priority',
    candidates: [
      tile({ id: '1', key: 'promo', priority: 99 }),
      tile({ id: '2', key: 'past-due', kind: 'system', priority: 0 }),
    ],
    settings: { maxTilesAtOnce: 2 },
    expectedServed: ['past-due', 'promo'],
  },
  {
    name: 'higher priority wins among campaigns',
    candidates: [
      tile({ id: '1', key: 'low', priority: 1 }),
      tile({ id: '2', key: 'high', priority: 5 }),
    ],
    settings: { maxTilesAtOnce: 2 },
    expectedServed: ['high', 'low'],
  },
  {
    name: 'the tile cap is enforced and the overflow says why',
    candidates: [
      tile({ id: '1', key: 'a', priority: 3 }),
      tile({ id: '2', key: 'b', priority: 2 }),
      tile({ id: '3', key: 'c', priority: 1 }),
    ],
    settings: { maxTilesAtOnce: 2 },
    expectedServed: ['a', 'b'],
    expectedReasons: { c: 'capped' },
  },
  {
    // A bypassing system record is exempt from the cap but still occupies a
    // slot, so campaigns yield to it rather than the total growing. Three
    // urgent alerts with a cap of two means three alerts and no promos, not
    // five tiles: the alternative rebuilds the stack this engine replaces.
    name: 'a system record bypasses the cap but still consumes a slot',
    candidates: [
      tile({ id: '1', key: 'a', priority: 3 }),
      tile({ id: '2', key: 'b', priority: 2 }),
      tile({ id: '3', key: 'past-due', kind: 'system', priority: 1 }),
    ],
    settings: { maxTilesAtOnce: 2, systemBypassesCap: true },
    expectedServed: ['past-due', 'a'],
    expectedReasons: { b: 'capped' },
  },
  {
    name: 'every system record gets through and campaigns yield entirely',
    candidates: [
      tile({ id: '1', key: 'promo', priority: 9 }),
      tile({ id: '2', key: 'verify', kind: 'system', priority: 3 }),
      tile({ id: '3', key: 'past-due', kind: 'system', priority: 2 }),
      tile({ id: '4', key: 'deletion', kind: 'system', priority: 1 }),
    ],
    settings: { maxTilesAtOnce: 2, systemBypassesCap: true },
    expectedServed: ['verify', 'past-due', 'deletion'],
    expectedReasons: { promo: 'capped' },
  },
  {
    name: 'without the bypass a system record is capped like anything else',
    candidates: [
      tile({ id: '1', key: 'verify', kind: 'system', priority: 3 }),
      tile({ id: '2', key: 'past-due', kind: 'system', priority: 2 }),
      tile({ id: '3', key: 'deletion', kind: 'system', priority: 1 }),
    ],
    settings: { maxTilesAtOnce: 2, systemBypassesCap: false },
    expectedServed: ['verify', 'past-due'],
    expectedReasons: { deletion: 'capped' },
  },
  {
    name: 'only one record per group is served',
    candidates: [
      tile({ id: '1', key: 'supporthq', group: 'crosssell', priority: 2 }),
      tile({ id: '2', key: 'citeprism', group: 'crosssell', priority: 1 }),
    ],
    settings: { maxTilesAtOnce: 5 },
    expectedServed: ['supporthq'],
    expectedReasons: { citeprism: 'group_collapsed' },
  },
  {
    name: 'tiles and modals are capped separately',
    candidates: [
      tile({ id: '1', key: 'tile-a', priority: 2 }),
      tile({ id: '2', key: 'tile-b', priority: 1 }),
      tile({ id: '3', key: 'modal-a', placement: 'modal' }),
    ],
    settings: { maxTilesAtOnce: 1, maxModalsPerLoad: 1 },
    expectedServed: ['tile-a', 'modal-a'],
    expectedReasons: { 'tile-b': 'capped' },
  },
  {
    name: 'a permanently dismissed record stays gone',
    candidates: [
      tile({ id: '1', key: 'promo', dismiss: { enabled: true, mode: 'permanent' } }),
    ],
    states: [{ notificationId: '1', dismissedAt: new Date('2026-09-01T00:00:00.000Z') }],
    expectedServed: [],
    expectedReasons: { promo: 'dismissed' },
  },
  {
    name: 'a live snooze hides a record',
    candidates: [tile({ id: '1', key: 'promo' })],
    states: [
      { notificationId: '1', snoozedUntil: new Date('2026-09-28T00:00:00.000Z') },
    ],
    expectedServed: [],
    expectedReasons: { promo: 'snoozed' },
  },
  {
    name: 'an expired snooze lets a record back',
    candidates: [tile({ id: '1', key: 'promo' })],
    states: [
      { notificationId: '1', snoozedUntil: new Date('2026-09-26T00:00:00.000Z') },
    ],
    expectedServed: ['promo'],
  },
  {
    name: 'the per-account impression cap is enforced',
    candidates: [
      tile({ id: '1', key: 'promo', frequency: { maxImpressionsPerUser: 3 } }),
    ],
    states: [{ notificationId: '1', impressions: 3 }],
    expectedServed: [],
    expectedReasons: { promo: 'frequency_exhausted' },
  },
  {
    name: 'the minimum gap between impressions is enforced',
    candidates: [
      tile({
        id: '1',
        key: 'promo',
        frequency: { minHoursBetweenImpressions: 24 },
      }),
    ],
    states: [
      { notificationId: '1', impressions: 1, lastSeenAt: new Date('2026-09-27T06:00:00.000Z') },
    ],
    expectedServed: [],
    expectedReasons: { promo: 'frequency_exhausted' },
  },
  {
    name: 'a schedule that has not started yet hides a record',
    candidates: [
      tile({
        id: '1',
        key: 'seasonal',
        schedule: { startsAt: new Date('2026-12-01T00:00:00.000Z') },
      }),
    ],
    expectedServed: [],
    expectedReasons: { seasonal: 'out_of_schedule' },
  },
  {
    name: 'a schedule that has ended hides a record',
    candidates: [
      tile({
        id: '1',
        key: 'seasonal',
        schedule: { endsAt: new Date('2026-01-01T00:00:00.000Z') },
      }),
    ],
    expectedServed: [],
    expectedReasons: { seasonal: 'out_of_schedule' },
  },
  {
    name: 'audience is applied',
    candidates: [
      tile({
        id: '1',
        key: 'free-only',
        audience: { attr: 'subscription.planName', op: 'eq', value: 'free' },
      }),
    ],
    baseContext: { 'subscription.planName': 'pro' },
    expectedServed: [],
    expectedReasons: { 'free-only': 'audience_failed' },
  },
  {
    name: 'an unjudgeable audience does not serve',
    candidates: [
      tile({
        id: '1',
        key: 'usage-based',
        audience: { attr: 'usage.monthlyPercent', op: 'gte', value: 80 },
      }),
    ],
    baseContext: {},
    expectedServed: [],
    expectedReasons: { 'usage-based': 'audience_failed' },
  },
  {
    name: 'state attributes are resolved per record, so prior dismissal is targetable',
    candidates: [
      tile({
        id: '1',
        key: 'second-chance',
        audience: { attr: 'state.impressions', op: 'gte', value: 2 },
      }),
    ],
    states: [{ notificationId: '1', impressions: 2 }],
    expectedServed: ['second-chance'],
  },
  {
    name: 'a record with no variants is not served',
    candidates: [tile({ id: '1', key: 'empty', variants: [] })],
    expectedServed: [],
    expectedReasons: { empty: 'disabled' },
  },
  {
    // Proves the substitution is wired into the ranker and not merely available
    // as a function. Anything that ran the ranker without this step would report
    // a working link for a record the feed serves broken.
    name: 'an authored link is served with its tokens filled in',
    candidates: [
      tile({
        id: '1',
        key: 'survey',
        variants: [
          {
            id: 'v1',
            title: 'survey',
            actions: [
              {
                label: 'Open',
                href: 'https://forms.example/x?name={{user.name}}&email={{user.email}}',
              },
            ],
          },
        ],
      }),
    ],
    tokens: { 'user.name': 'Ada Lovelace', 'user.email': 'ada@example.com' },
    expectedServed: ['survey'],
    expectedHrefs: {
      survey: 'https://forms.example/x?name=Ada%20Lovelace&email=ada%40example.com',
    },
  },
  {
    name: 'a link is served without a raw token when no values are supplied',
    candidates: [
      tile({
        id: '1',
        key: 'survey',
        variants: [
          {
            id: 'v1',
            title: 'survey',
            actions: [
              { label: 'Open', href: 'https://forms.example/x?email={{user.email}}' },
            ],
          },
        ],
      }),
    ],
    expectedServed: ['survey'],
    expectedHrefs: { survey: 'https://forms.example/x?email=' },
  },
]

export const SELECTION_DEFAULT_NOW = NOW

// ---------------------------------------------------------------------------
// Link token cases: the substitution on its own, away from ranking.
// ---------------------------------------------------------------------------

export interface HrefCase {
  name: string
  href: string
  values?: HrefTokenValues
  expected: string
}

export const HREF_CASES: HrefCase[] = [
  {
    name: 'a link with no tokens is untouched',
    href: 'https://example.com/a?b=c',
    values: { 'user.email': 'ada@example.com' },
    expected: 'https://example.com/a?b=c',
  },
  {
    name: 'a space is percent-encoded, not turned into a plus',
    href: 'https://forms.example/x?name={{user.name}}',
    values: { 'user.name': 'Ada Lovelace' },
    expected: 'https://forms.example/x?name=Ada%20Lovelace',
  },
  {
    // A `+` would be a literal plus here rather than a space, so the link
    // would point at a path that does not exist.
    name: 'a token in a path keeps a space encoded as %20',
    href: 'https://example.com/u/{{user.name}}/settings',
    values: { 'user.name': 'Ada Lovelace' },
    expected: 'https://example.com/u/Ada%20Lovelace/settings',
  },
  {
    name: 'an email is percent-encoded',
    href: 'https://forms.example/x?email={{user.email}}',
    values: { 'user.email': 'ada+test@example.com' },
    expected: 'https://forms.example/x?email=ada%2Btest%40example.com',
  },
  {
    name: 'whitespace inside the braces is tolerated',
    href: 'https://forms.example/x?id={{ user.id }}',
    values: { 'user.id': 'abc123' },
    expected: 'https://forms.example/x?id=abc123',
  },
  {
    name: 'the same token can appear more than once',
    href: 'https://forms.example/x?a={{user.id}}&b={{user.id}}',
    values: { 'user.id': 'abc' },
    expected: 'https://forms.example/x?a=abc&b=abc',
  },
  {
    // Fails closed the way the rest of the engine does: an author's typo must
    // not reach the third party as a literal. Authoring rejects it on save too.
    name: 'an unknown token is emptied rather than left in the link',
    href: 'https://forms.example/x?q={{user.secret}}',
    values: { 'user.email': 'ada@example.com' },
    expected: 'https://forms.example/x?q=',
  },
  {
    name: 'a known token the account has no value for is emptied',
    href: 'https://forms.example/x?name={{user.name}}',
    values: {},
    expected: 'https://forms.example/x?name=',
  },
  {
    name: 'a name that would break the query string is escaped',
    href: 'https://forms.example/x?name={{user.name}}&next=1',
    values: { 'user.name': 'a&b=c#d' },
    expected: 'https://forms.example/x?name=a%26b%3Dc%23d&next=1',
  },
]
