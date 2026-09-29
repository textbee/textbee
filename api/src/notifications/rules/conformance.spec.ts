import { evaluateCondition, referencedAttributes } from './condition-evaluator'
import { selectNotifications, Candidate } from './notification-ranker'
import { validateCondition } from './condition-validator'
import {
  interpolateHref,
  referencedTokens,
  unknownTokens,
} from './interpolate-href'
import { ATTRIBUTES, ATTRIBUTES_BY_KEY } from './attributes'
import {
  CONDITION_CASES,
  HREF_CASES,
  SELECTION_CASES,
  SELECTION_DEFAULT_NOW,
} from './conformance-cases'

// Runs the shared fixture against this repo's copy of the engine. The identical
// spec runs against the mirrored copy. Both suites passing is the
// only thing that stops a preview and the live feed disagreeing, since
// the two APIs never call each other.

describe('condition evaluator conformance', () => {
  it.each(CONDITION_CASES.map((c) => [c.name, c] as const))(
    '%s',
    (_name, testCase) => {
      const result = evaluateCondition(testCase.condition, testCase.context)
      expect(result.result).toBe(testCase.expected)
      expect(result.passed).toBe(testCase.expected === 'true')
    },
  )
})

describe('selection conformance', () => {
  it.each(SELECTION_CASES.map((c) => [c.name, c] as const))(
    '%s',
    (_name, testCase) => {
      const result = selectNotifications({
        candidates: testCase.candidates,
        states: testCase.states ?? [],
        settings: {
          maxTilesAtOnce: 2,
          maxModalsPerLoad: 1,
          systemBypassesCap: false,
          ...testCase.settings,
        },
        baseContext: testCase.baseContext ?? {},
        now: new Date(testCase.nowIso ?? SELECTION_DEFAULT_NOW),
        seed: testCase.seed ?? 'seed:2026-09-27',
        tokens: testCase.tokens,
      })

      expect(result.served.map((s) => s.key)).toEqual(testCase.expectedServed)

      // Ranks are 1-based and contiguous in served order.
      expect(result.served.map((s) => s.rank)).toEqual(
        result.served.map((_, i) => i + 1),
      )

      for (const [key, reason] of Object.entries(
        testCase.expectedReasons ?? {},
      )) {
        const entry = result.filtered.find((f) => f.key === key)
        expect(entry?.reason).toBe(reason)
      }

      for (const [key, href] of Object.entries(testCase.expectedHrefs ?? {})) {
        const entry = result.served.find((s) => s.key === key)
        expect(entry?.actions?.[0]?.href).toBe(href)
      }
    },
  )
})

describe('link token conformance', () => {
  it.each(HREF_CASES.map((c) => [c.name, c] as const))(
    '%s',
    (_name, testCase) => {
      expect(interpolateHref(testCase.href, testCase.values)).toBe(
        testCase.expected,
      )
    },
  )

  it('reports the tokens an author got wrong', () => {
    const href = 'https://x.example/?a={{user.email}}&b={{user.secret}}'
    expect(referencedTokens(href)).toEqual(['user.email', 'user.secret'])
    expect(unknownTokens(href)).toEqual(['user.secret'])
    expect(unknownTokens('https://x.example/?a={{user.name}}')).toEqual([])
  })
})

describe('attribute registry', () => {
  it('has no duplicate keys', () => {
    const keys = ATTRIBUTES.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('gives every attribute at least one operator', () => {
    for (const attribute of ATTRIBUTES) {
      expect(attribute.operators.length).toBeGreaterThan(0)
    }
  })

  it('lets exists be used wherever a value can be absent', () => {
    for (const attribute of ATTRIBUTES) {
      expect(attribute.operators).toContain('exists')
    }
  })

  it('offers options for every enum attribute', () => {
    for (const attribute of ATTRIBUTES.filter((a) => a.type === 'enum')) {
      expect(attribute.options?.length).toBeGreaterThan(0)
    }
  })

  it('keys every attribute under group.name', () => {
    for (const attribute of ATTRIBUTES) {
      expect(attribute.key.startsWith(`${attribute.group}.`)).toBe(true)
    }
  })
})

describe('referencedAttributes', () => {
  it('collects keys from every branch', () => {
    expect(
      referencedAttributes({
        all: [
          { attr: 'a.one', op: 'eq', value: 1 },
          { any: [{ attr: 'a.two', op: 'eq', value: 2 }] },
          { not: { attr: 'a.three', op: 'eq', value: 3 } },
        ],
      }).sort(),
    ).toEqual(['a.one', 'a.two', 'a.three'].sort())
  })

  it('is empty for no audience', () => {
    expect(referencedAttributes(null)).toEqual([])
  })
})

describe('seeded variant choice', () => {
  const candidate: Candidate = {
    id: 'n1',
    key: 'promo',
    kind: 'campaign',
    placement: 'tile',
    tone: 'promo',
    variants: [
      { id: 'a', weight: 1, title: 'A' },
      { id: 'b', weight: 1, title: 'B' },
      { id: 'c', weight: 1, title: 'C' },
    ],
  }

  const run = (seed: string) =>
    selectNotifications({
      candidates: [candidate],
      states: [],
      settings: { maxTilesAtOnce: 2, maxModalsPerLoad: 1 },
      baseContext: {},
      now: new Date(SELECTION_DEFAULT_NOW),
      seed,
    }).served[0]?.variantId

  it('is stable for the same seed, so copy does not flicker on refetch', () => {
    const first = run('user1:2026-09-27')
    for (let i = 0; i < 20; i += 1) {
      expect(run('user1:2026-09-27')).toBe(first)
    }
  })

  it('differs across accounts, so a variant is not global', () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => run(`user${i}:2026-09-27`)),
    )
    expect(seen.size).toBeGreaterThan(1)
  })

  it('respects weight, giving a heavy variant the clear majority', () => {
    const weighted: Candidate = {
      ...candidate,
      variants: [
        { id: 'heavy', weight: 9, title: 'Heavy' },
        { id: 'light', weight: 1, title: 'Light' },
      ],
    }
    let heavy = 0
    const runs = 400
    for (let i = 0; i < runs; i += 1) {
      const served = selectNotifications({
        candidates: [weighted],
        states: [],
        settings: { maxTilesAtOnce: 2, maxModalsPerLoad: 1 },
        baseContext: {},
        now: new Date(SELECTION_DEFAULT_NOW),
        seed: `user${i}:2026-09-27`,
      }).served[0]
      if (served?.variantId === 'heavy') heavy += 1
    }
    expect(heavy / runs).toBeGreaterThan(0.75)
    expect(heavy / runs).toBeLessThan(0.98)
  })
})

describe('weighted rotation among equal priority', () => {
  const make = (id: string, weight: number): Candidate => ({
    id,
    key: id,
    kind: 'campaign',
    placement: 'tile',
    tone: 'info',
    priority: 0,
    weight,
    variants: [{ id: 'v', title: id }],
  })

  it('is stable for one account but rotates across accounts', () => {
    const winners = new Set<string>()
    for (let i = 0; i < 40; i += 1) {
      const result = selectNotifications({
        candidates: [make('a', 1), make('b', 1), make('c', 1)],
        states: [],
        settings: { maxTilesAtOnce: 1, maxModalsPerLoad: 1 },
        baseContext: {},
        now: new Date(SELECTION_DEFAULT_NOW),
        seed: `user${i}:2026-09-27`,
      })
      winners.add(result.served[0].key)
    }
    expect(winners.size).toBeGreaterThan(1)
  })

  it('favours the heavier record', () => {
    let heavyWins = 0
    const runs = 300
    for (let i = 0; i < runs; i += 1) {
      const result = selectNotifications({
        candidates: [make('heavy', 9), make('light', 1)],
        states: [],
        settings: { maxTilesAtOnce: 1, maxModalsPerLoad: 1 },
        baseContext: {},
        now: new Date(SELECTION_DEFAULT_NOW),
        seed: `user${i}:2026-09-27`,
      })
      if (result.served[0].key === 'heavy') heavyWins += 1
    }
    expect(heavyWins / runs).toBeGreaterThan(0.7)
  })
})

describe('condition validator', () => {
  it('accepts an absent audience', () => {
    expect(validateCondition(null)).toEqual([])
  })

  it('accepts a well formed tree', () => {
    expect(
      validateCondition({
        all: [
          { attr: 'subscription.planName', op: 'eq', value: 'free' },
          { attr: 'user.accountAgeDays', op: 'between', value: [30, 60] },
          { not: { attr: 'state.wasDismissed', op: 'eq', value: true } },
        ],
      }),
    ).toEqual([])
  })

  it('rejects an unknown attribute', () => {
    const issues = validateCondition({
      attr: 'user.favouriteColour',
      op: 'eq',
      value: 'blue',
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('Unknown attribute')
  })

  it('rejects an operator the attribute does not allow', () => {
    const issues = validateCondition({
      attr: 'user.emailVerified',
      op: 'gt',
      value: 1,
    })
    expect(issues[0].message).toContain('cannot be used with')
  })

  it('rejects a wrongly typed value', () => {
    expect(
      validateCondition({
        attr: 'user.accountAgeDays',
        op: 'gt',
        value: '30' as unknown as number,
      })[0].message,
    ).toContain('needs a number')
  })

  it('rejects an empty list for in', () => {
    expect(
      validateCondition({
        attr: 'subscription.status',
        op: 'in',
        value: [],
      })[0].message,
    ).toContain('non-empty list')
  })

  it('rejects a reversed between range', () => {
    expect(
      validateCondition({
        attr: 'user.accountAgeDays',
        op: 'between',
        value: [60, 30],
      })[0].message,
    ).toContain('min not above max')
  })

  it('rejects unexpected keys, since nothing else validates the body', () => {
    const issues = validateCondition({
      attr: 'user.isBanned',
      op: 'eq',
      value: true,
      $where: 'sleep(1000)',
    } as never)
    expect(issues[0].message).toContain('$where')
  })

  it('rejects a node combining two branch kinds', () => {
    const issues = validateCondition({
      all: [],
      attr: 'user.isBanned',
      op: 'eq',
      value: true,
    } as never)
    expect(issues[0].message).toContain('only one of')
  })

  it('rejects a tree nested past the depth limit', () => {
    let node: unknown = { attr: 'user.isBanned', op: 'eq', value: true }
    for (let i = 0; i < 12; i += 1) node = { not: node }
    expect(validateCondition(node as never).length).toBeGreaterThan(0)
  })

  it('rejects a tree with too many conditions', () => {
    const leaves = Array.from({ length: 250 }, () => ({
      attr: 'user.isBanned' as const,
      op: 'eq' as const,
      value: true,
    }))
    expect(validateCondition({ all: leaves }).length).toBeGreaterThan(0)
  })

  it('agrees with the registry on every fixture case it should accept', () => {
    for (const testCase of CONDITION_CASES) {
      if (testCase.expected !== 'unknown') {
        expect(validateCondition(testCase.condition)).toEqual([])
      }
    }
  })

  it('covers every attribute the fixture mentions', () => {
    for (const testCase of CONDITION_CASES) {
      for (const key of referencedAttributes(testCase.condition)) {
        if (testCase.expected !== 'unknown') {
          expect(ATTRIBUTES_BY_KEY.has(key)).toBe(true)
        }
      }
    }
  })
})
