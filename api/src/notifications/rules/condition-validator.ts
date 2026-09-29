import { ATTRIBUTES_BY_KEY } from './attributes'
import { ConditionNode, Operator } from './types'

// This API has no global ValidationPipe, so class-validator decorators here are
// decorative and bodies reach services as they were sent. A condition tree is
// operator-authored and ends up driving what thousands of accounts see, so it
// gets checked by hand before it is stored or trusted, the same way
// users/attribution.ts sanitises its input.
//
// Evaluation already fails closed on anything malformed. This exists so a
// mistake is reported at authoring time instead of silently matching nobody.

const MAX_DEPTH = 10
const MAX_NODES = 200
const NODE_KEYS = ['all', 'any', 'not', 'attr', 'op', 'value']

const LIST_OPERATORS: Operator[] = ['in', 'nin']
const NUMERIC_OPERATORS: Operator[] = ['gt', 'gte', 'lt', 'lte']

export interface ValidationIssue {
  path: string
  message: string
}

function checkLeafValue(
  node: { attr: string; op: Operator; value?: unknown },
  path: string,
  issues: ValidationIssue[],
): void {
  const descriptor = ATTRIBUTES_BY_KEY.get(node.attr)
  if (!descriptor) {
    issues.push({ path, message: `Unknown attribute "${node.attr}".` })
    return
  }

  if (!descriptor.operators.includes(node.op)) {
    issues.push({
      path,
      message: `Operator "${node.op}" cannot be used with "${node.attr}".`,
    })
    return
  }

  const { op, value } = node

  if (op === 'exists') {
    if (value !== undefined && typeof value !== 'boolean') {
      issues.push({ path, message: 'exists takes true or false.' })
    }
    return
  }

  if (LIST_OPERATORS.includes(op)) {
    if (!Array.isArray(value) || value.length === 0) {
      issues.push({ path, message: `${op} needs a non-empty list.` })
    }
    return
  }

  if (op === 'between') {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== 'number' ||
      typeof value[1] !== 'number'
    ) {
      issues.push({ path, message: 'between needs a [min, max] number pair.' })
    } else if (value[0] > value[1]) {
      issues.push({ path, message: 'between needs min not above max.' })
    }
    return
  }

  if (NUMERIC_OPERATORS.includes(op)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ path, message: `${op} needs a number.` })
    }
    return
  }

  if (op === 'contains') {
    if (typeof value !== 'string' || value === '') {
      issues.push({ path, message: 'contains needs a text value.' })
    }
    return
  }

  // eq and ne, typed by the attribute.
  if (descriptor.type === 'boolean' && typeof value !== 'boolean') {
    issues.push({ path, message: `"${node.attr}" compares against true or false.` })
    return
  }
  if (descriptor.type === 'number' && typeof value !== 'number') {
    issues.push({ path, message: `"${node.attr}" compares against a number.` })
    return
  }
  if (
    (descriptor.type === 'string' || descriptor.type === 'enum') &&
    typeof value !== 'string'
  ) {
    issues.push({ path, message: `"${node.attr}" compares against text.` })
  }
}

function walk(
  node: unknown,
  path: string,
  depth: number,
  counter: { seen: number },
  issues: ValidationIssue[],
): void {
  if (issues.length > 25) return

  counter.seen += 1
  if (counter.seen > MAX_NODES) {
    if (counter.seen === MAX_NODES + 1) {
      issues.push({ path, message: `More than ${MAX_NODES} conditions.` })
    }
    return
  }

  if (depth > MAX_DEPTH) {
    issues.push({ path, message: `Nested deeper than ${MAX_DEPTH} levels.` })
    return
  }

  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    issues.push({ path, message: 'Each condition must be an object.' })
    return
  }

  const keys = Object.keys(node as Record<string, unknown>)
  const unknownKeys = keys.filter((key) => !NODE_KEYS.includes(key))
  if (unknownKeys.length) {
    issues.push({
      path,
      message: `Unexpected ${unknownKeys.map((k) => `"${k}"`).join(', ')}.`,
    })
  }

  const branches = ['all', 'any', 'not', 'attr'].filter((key) => key in node)
  if (branches.length !== 1) {
    issues.push({
      path,
      message: branches.length
        ? `Use only one of ${branches.join(', ')}.`
        : 'Needs one of all, any, not or attr.',
    })
    return
  }

  const record = node as Record<string, unknown>

  if ('all' in record || 'any' in record) {
    const key = 'all' in record ? 'all' : 'any'
    const children = record[key]
    if (!Array.isArray(children)) {
      issues.push({ path, message: `"${key}" must be a list of conditions.` })
      return
    }
    children.forEach((child, index) =>
      walk(child, `${path}.${key}[${index}]`, depth + 1, counter, issues),
    )
    return
  }

  if ('not' in record) {
    walk(record.not, `${path}.not`, depth + 1, counter, issues)
    return
  }

  if (typeof record.attr !== 'string' || !record.attr) {
    issues.push({ path, message: 'attr must be an attribute key.' })
    return
  }
  if (typeof record.op !== 'string') {
    issues.push({ path, message: 'op is required alongside attr.' })
    return
  }

  checkLeafValue(
    record as { attr: string; op: Operator; value?: unknown },
    path,
    issues,
  )
}

/** Empty when the tree is safe to store. An absent audience means everyone. */
export function validateCondition(
  node: ConditionNode | null | undefined,
): ValidationIssue[] {
  if (node === null || node === undefined) return []
  const issues: ValidationIssue[] = []
  walk(node, 'audience', 0, { seen: 0 }, issues)
  return issues
}
