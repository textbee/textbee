import { ATTRIBUTES_BY_KEY } from './attributes'
import {
  AttributeDescriptor,
  AttributeValue,
  ConditionNode,
  EvaluationContext,
  EvaluationResult,
  NodeTrace,
  Operator,
  TriState,
} from './types'

// Pure. No I/O, no models, no framework. Takes a condition tree and an already
// resolved context and returns a verdict plus a tree-shaped trace. Duplicated
// outside this repository, where the trace is rendered as a per-leaf pass/fail
// annotation, so it is possible to see why an account did not match.
//
// Two deliberate choices:
//
// 1. Nothing short-circuits. The context is fully loaded before evaluation, so
//    visiting every branch costs nothing and yields a complete trace. A partial
//    trace would make a preview useless on the exact trees that need
//    explaining.
// 2. Everything fails to "unknown" rather than false. See TriState in types.ts.

const and = (parts: TriState[]): TriState => {
  if (parts.includes('false')) return 'false'
  if (parts.includes('unknown')) return 'unknown'
  return 'true'
}

const or = (parts: TriState[]): TriState => {
  if (parts.includes('true')) return 'true'
  if (parts.includes('unknown')) return 'unknown'
  return 'false'
}

const negate = (part: TriState): TriState =>
  part === 'true' ? 'false' : part === 'false' ? 'true' : 'unknown'

const bool = (value: boolean): TriState => (value ? 'true' : 'false')

const isAbsent = (value: AttributeValue): boolean =>
  value === null || value === undefined

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function compareOperator(
  op: Operator,
  actual: AttributeValue,
  expected: unknown,
): { result: TriState; note?: string } {
  // exists is the one operator that can judge an absent value.
  if (op === 'exists') {
    const wanted = expected === undefined ? true : expected === true
    return { result: bool(isAbsent(actual) !== wanted) }
  }

  if (isAbsent(actual)) {
    return {
      result: 'unknown',
      note: 'This account has no value for that attribute yet.',
    }
  }

  switch (op) {
    case 'eq':
    case 'ne': {
      if (Array.isArray(actual)) {
        return { result: 'unknown', note: 'Use contains for a list attribute.' }
      }
      if (typeof actual !== typeof expected) {
        return {
          result: 'unknown',
          note: `Cannot compare ${typeof actual} with ${typeof expected}.`,
        }
      }
      const same = actual === expected
      return { result: bool(op === 'eq' ? same : !same) }
    }

    case 'in':
    case 'nin': {
      if (!Array.isArray(expected)) {
        return { result: 'unknown', note: 'This operator needs a list value.' }
      }
      if (Array.isArray(actual)) {
        return { result: 'unknown', note: 'Use contains for a list attribute.' }
      }
      const found = expected.includes(actual)
      return { result: bool(op === 'in' ? found : !found) }
    }

    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (!isNumber(actual) || !isNumber(expected)) {
        return { result: 'unknown', note: 'This operator needs two numbers.' }
      }
      if (op === 'gt') return { result: bool(actual > expected) }
      if (op === 'gte') return { result: bool(actual >= expected) }
      if (op === 'lt') return { result: bool(actual < expected) }
      return { result: bool(actual <= expected) }
    }

    case 'between': {
      if (!isNumber(actual)) {
        return { result: 'unknown', note: 'This operator needs a number.' }
      }
      if (
        !Array.isArray(expected) ||
        expected.length !== 2 ||
        !isNumber(expected[0]) ||
        !isNumber(expected[1])
      ) {
        return {
          result: 'unknown',
          note: 'This operator needs a [min, max] pair.',
        }
      }
      // Inclusive at both ends.
      return {
        result: bool(actual >= expected[0] && actual <= expected[1]),
      }
    }

    case 'contains': {
      if (!Array.isArray(actual)) {
        return {
          result: 'unknown',
          note: 'This operator only applies to a list attribute.',
        }
      }
      if (typeof expected !== 'string') {
        return { result: 'unknown', note: 'This operator needs a text value.' }
      }
      return { result: bool(actual.includes(expected)) }
    }

    default:
      return { result: 'unknown', note: `Unknown operator "${op}".` }
  }
}

function evaluateLeaf(
  node: { attr: string; op: Operator; value?: unknown },
  context: EvaluationContext,
): NodeTrace {
  const descriptor: AttributeDescriptor | undefined = ATTRIBUTES_BY_KEY.get(
    node.attr,
  )

  // An attribute this build does not know about. A registry running behind the
  // registry running behind can then only under-show, never crash or over-show.
  if (!descriptor) {
    return {
      kind: 'leaf',
      result: 'unknown',
      attr: node.attr,
      op: node.op,
      value: node.value,
      note: 'This build does not know that attribute.',
    }
  }

  if (!descriptor.operators.includes(node.op)) {
    return {
      kind: 'leaf',
      result: 'unknown',
      attr: node.attr,
      op: node.op,
      value: node.value,
      actual: context[node.attr],
      note: `"${node.op}" cannot be used with ${descriptor.label}.`,
    }
  }

  const actual = context[node.attr]
  const { result, note } = compareOperator(node.op, actual, node.value)

  return {
    kind: 'leaf',
    result,
    attr: node.attr,
    op: node.op,
    value: node.value,
    actual,
    note,
  }
}

function walk(node: ConditionNode, context: EvaluationContext): NodeTrace {
  if (!node || typeof node !== 'object') {
    return { kind: 'invalid', result: 'unknown', note: 'Not a condition.' }
  }

  if ('all' in node) {
    if (!Array.isArray(node.all)) {
      return {
        kind: 'invalid',
        result: 'unknown',
        note: '"all" must be a list of conditions.',
      }
    }
    // An empty "all" is true: nothing was required. This is how an untargeted
    // notification is expressed, so it must not fail closed.
    const children = node.all.map((child) => walk(child, context))
    return {
      kind: 'all',
      result: and(children.map((c) => c.result)),
      children,
    }
  }

  if ('any' in node) {
    if (!Array.isArray(node.any)) {
      return {
        kind: 'invalid',
        result: 'unknown',
        note: '"any" must be a list of conditions.',
      }
    }
    // An empty "any" is false: no alternative could be satisfied.
    const children = node.any.map((child) => walk(child, context))
    return {
      kind: 'any',
      result: or(children.map((c) => c.result)),
      children,
    }
  }

  if ('not' in node) {
    const child = walk(node.not, context)
    return { kind: 'not', result: negate(child.result), child }
  }

  if ('attr' in node) {
    return evaluateLeaf(node, context)
  }

  return {
    kind: 'invalid',
    result: 'unknown',
    note: 'A condition needs one of all, any, not or attr.',
  }
}

export function evaluateCondition(
  node: ConditionNode | null | undefined,
  context: EvaluationContext,
): EvaluationResult {
  // No audience at all means everyone, the same as an empty "all".
  if (node === null || node === undefined) {
    return {
      passed: true,
      result: 'true',
      trace: { kind: 'all', result: 'true', children: [] },
    }
  }

  const trace = walk(node, context)
  return { passed: trace.result === 'true', result: trace.result, trace }
}

/** Every attribute key a tree mentions, including ones we do not recognise. */
export function referencedAttributes(
  node: ConditionNode | null | undefined,
): string[] {
  const found = new Set<string>()
  const visit = (current: ConditionNode) => {
    if (!current || typeof current !== 'object') return
    if ('all' in current && Array.isArray(current.all))
      current.all.forEach(visit)
    else if ('any' in current && Array.isArray(current.any))
      current.any.forEach(visit)
    else if ('not' in current) visit(current.not)
    else if ('attr' in current) found.add(current.attr)
  }
  if (node) visit(node)
  return [...found]
}
