// Shared vocabulary for the targeting rules. This file, attributes.ts,
// condition-evaluator.ts, notification-ranker.ts and conformance-cases.ts are
// mirrored outside this repository, where the same engine runs to preview
// what a given account would be served. The two APIs never call each other, so
// the conformance fixture is what keeps the copies honest: change any semantics
// here and add cases there in the same commit.

export type AttributeType =
  | 'string'
  | 'enum'
  | 'number'
  | 'boolean'
  | 'stringArray'

export type Operator =
  | 'eq'
  | 'ne'
  | 'in'
  | 'nin'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'exists'
  | 'contains'

export interface AttributeDescriptor {
  key: string
  label: string
  type: AttributeType
  group: string
  operators: Operator[]
  /** Known values, for the rule builder. Not enforced at evaluation. */
  options?: string[]
  /** Shown alongside the field when a value needs explaining. */
  hint?: string
}

export type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | null
  | undefined

export type EvaluationContext = Record<string, AttributeValue>

export type ConditionNode =
  | { all: ConditionNode[] }
  | { any: ConditionNode[] }
  | { not: ConditionNode }
  | { attr: string; op: Operator; value?: unknown }

// Three-valued, not boolean. An attribute we cannot judge (absent from the
// registry, or absent from this account's data) is "unknown", never false.
// Booleans would break fail-closed under negation: a missing value would make
// not(leaf) true and serve a notification to exactly the accounts we know least
// about. Kleene logic keeps "unknown" contagious, and only an outright true is
// served.
export type TriState = 'true' | 'false' | 'unknown'

export type NodeTrace =
  | { kind: 'all'; result: TriState; children: NodeTrace[] }
  | { kind: 'any'; result: TriState; children: NodeTrace[] }
  | { kind: 'not'; result: TriState; child: NodeTrace }
  | {
      kind: 'leaf'
      result: TriState
      attr: string
      op: Operator
      value?: unknown
      actual?: AttributeValue
      /** Why a leaf could not be judged on its merits. */
      note?: string
    }
  | { kind: 'invalid'; result: 'unknown'; note: string }

export interface EvaluationResult {
  /** True only when the tree evaluated to a definite true. */
  passed: boolean
  result: TriState
  trace: NodeTrace
}

/** Every reason a candidate can be left out of a feed. */
export type FilterReason =
  | 'audience_failed'
  | 'out_of_schedule'
  | 'dismissed'
  | 'snoozed'
  | 'frequency_exhausted'
  | 'group_collapsed'
  | 'capped'
  | 'disabled'
