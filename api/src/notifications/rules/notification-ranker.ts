import { evaluateCondition } from './condition-evaluator'
import { HrefTokenValues, interpolateHref } from './interpolate-href'
import {
  ConditionNode,
  EvaluationContext,
  FilterReason,
  NodeTrace,
} from './types'

// Pure. The single entry point for turning a set of candidate notifications plus
// one account's history into the finished, ordered, capped list the dashboard
// renders. Mirrored outside this repository so a preview and this feed can
// never disagree, and covered end to end by conformance-cases.ts.

export type NotificationKind = 'system' | 'campaign'
export type Placement = 'tile' | 'modal'
export type DismissMode = 'permanent' | 'snooze' | 'session'

export interface VariantAction {
  label: string
  href: string
  style?: string
  target?: string
  trackAs?: string
}

export interface Variant {
  id: string
  weight?: number
  title: string
  body?: string
  actions?: VariantAction[]
}

export interface DismissRule {
  enabled?: boolean
  mode?: DismissMode
  snoozeHours?: number
  requireSeconds?: number
}

export interface FrequencyRule {
  maxImpressionsPerUser?: number
  minHoursBetweenImpressions?: number
  maxImpressionsTotal?: number
}

export interface Candidate {
  id: string
  key: string
  kind: NotificationKind
  placement: Placement
  tone: string
  renderer?: string
  priority?: number
  weight?: number
  group?: string | null
  audience?: ConditionNode | null
  schedule?: { startsAt?: Date | null; endsAt?: Date | null } | null
  dismiss?: DismissRule | null
  frequency?: FrequencyRule | null
  variants: Variant[]
  /** All-account totals, for maxImpressionsTotal. */
  stats?: { impressions?: number } | null
  createdAt?: Date | null
}

export interface AccountState {
  notificationId: string
  impressions?: number
  lastSeenAt?: Date | null
  clickedAt?: Date | null
  dismissedAt?: Date | null
  snoozedUntil?: Date | null
}

export interface SelectionSettings {
  /** Campaign tiles shown by default. */
  maxTilesAtOnce: number
  /**
   * Operational tiles shown alongside the campaign ones, on their own budget.
   * One shared budget meant a handful of alerts nobody can dismiss made every
   * campaign unreachable for as long as the alert was true.
   */
  maxSystemTilesAtOnce?: number
  /** One shared budget across kinds, so at most one dialog is ever open. */
  maxModalsPerLoad: number
  /** Extra campaign tiles served collapsed, for a "more" control to reveal. */
  overflowTiles?: number
  /** Hold back campaign dialogs when the account saw a dialog this recently. */
  modalMinIntervalHours?: number
}

export interface SelectionInput {
  candidates: Candidate[]
  states: AccountState[]
  settings: SelectionSettings
  /** Account-level attributes. The state group is added per candidate. */
  baseContext: EvaluationContext
  now: Date
  /** Stable per account and per day, so chosen copy does not flicker. */
  seed: string
  /**
   * Values for the tokens an authored link may carry. Substituted here so the
   * dashboard keeps receiving finished hrefs and stays a renderer.
   */
  tokens?: HrefTokenValues
}

export interface ServedNotification {
  id: string
  key: string
  kind: NotificationKind
  placement: Placement
  tone: string
  renderer: string
  rank: number
  variantId: string
  title: string
  body?: string
  actions: VariantAction[]
  dismissible: boolean
  dismissAfterSeconds?: number
  /** Beyond the default-visible budget, so the renderer starts it collapsed. */
  overflow?: boolean
}

export interface FilteredNotification {
  id: string
  key: string
  reason: FilterReason
  detail?: string
  trace?: NodeTrace
}

export interface SelectionResult {
  served: ServedNotification[]
  filtered: FilteredNotification[]
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// xmur3 then mulberry32. Plain integer maths so the two repos produce identical
// sequences; Math.random would make the copy flicker between refetches, which is
// a real defect in the banners this replaces.
function seededUnit(input: string): number {
  let h = 1779033703 ^ input.length
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = (h ^= h >>> 16) >>> 0
  a |= 0
  a = (a + 0x6d2b79f5) | 0
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const unit = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  // Never exactly 0, so the weighted key below cannot collapse to 0 for every
  // weight and destroy the ordering.
  return unit === 0 ? Number.MIN_VALUE : unit
}

const asTime = (value: Date | null | undefined): number | null =>
  value === null || value === undefined ? null : new Date(value).getTime()

const daysBetween = (from: number, to: number): number =>
  Math.floor((to - from) / DAY_MS)

function stateContext(
  state: AccountState | undefined,
  now: number,
): EvaluationContext {
  const lastSeen = asTime(state?.lastSeenAt)
  return {
    'state.impressions': state?.impressions ?? 0,
    'state.daysSinceLastImpression':
      lastSeen === null ? undefined : daysBetween(lastSeen, now),
    'state.wasDismissed': Boolean(state?.dismissedAt),
    'state.wasClicked': Boolean(state?.clickedAt),
  }
}

/**
 * Efraimidis-Spirakis weighted sampling: key = u ** (1 / weight), taken in
 * descending order, gives a weighted random permutation rather than a mere
 * weighted pick, which is what a rotation among equal-priority records needs.
 */
function weightedKey(seed: string, id: string, weight: number): number {
  const w = weight > 0 ? weight : 0.0001
  return Math.pow(seededUnit(`${seed}:${id}`), 1 / w)
}

function pickVariant(
  candidate: Candidate,
  seed: string,
): Variant | undefined {
  const all = (candidate.variants || []).filter(Boolean)
  // Weight 0 retires a variant. Coercing it to 1 served the copy an author had
  // deliberately taken out of rotation.
  const variants = all.some((v) => v.weight !== 0)
    ? all.filter((v) => v.weight !== 0)
    : all
  if (!variants.length) return undefined
  if (variants.length === 1) return variants[0]

  const weights = variants.map((v) =>
    typeof v.weight === 'number' && v.weight > 0 ? v.weight : 1,
  )
  const total = weights.reduce((sum, w) => sum + w, 0)
  let cursor = seededUnit(`${seed}:variant:${candidate.id}`) * total
  for (let i = 0; i < variants.length; i += 1) {
    cursor -= weights[i]
    if (cursor <= 0) return variants[i]
  }
  return variants[variants.length - 1]
}

type Block = { reason: FilterReason; detail?: string } | null

/** Record-level: applies to every account, so it is reported before audience. */
function scheduleReason(candidate: Candidate, now: number): Block {
  const startsAt = asTime(candidate.schedule?.startsAt)
  const endsAt = asTime(candidate.schedule?.endsAt)
  if (startsAt !== null && startsAt > now) {
    return { reason: 'out_of_schedule', detail: 'Starts later.' }
  }
  if (endsAt !== null && endsAt < now) {
    return { reason: 'out_of_schedule', detail: 'Already ended.' }
  }
  return null
}

/** Account-level: this account's own history with the record. */
function accountReason(
  candidate: Candidate,
  state: AccountState | undefined,
  now: number,
): Block {
  const snoozedUntil = asTime(state?.snoozedUntil)
  if (snoozedUntil !== null && snoozedUntil > now) {
    return { reason: 'snoozed', detail: 'Snoozed by this account.' }
  }

  const mode = candidate.dismiss?.mode ?? 'permanent'
  // Only permanent stays dismissed on the strength of dismissedAt alone.
  // Session writes a wake-up time too, so reading it here as well would make
  // "gone for this visit" never come back, which is the bug it replaced.
  if (state?.dismissedAt && mode === 'permanent') {
    return { reason: 'dismissed', detail: 'Dismissed by this account.' }
  }
  // A snooze-mode record whose dismissal recorded no wake-up time would
  // otherwise come straight back, so the reader's click did nothing. Fail
  // closed and treat it as cleared until something sets a time.
  if (state?.dismissedAt && snoozedUntil === null) {
    return { reason: 'dismissed', detail: 'Dismissed with no snooze recorded.' }
  }

  const frequency = candidate.frequency
  const impressions = state?.impressions ?? 0
  if (
    typeof frequency?.maxImpressionsPerUser === 'number' &&
    impressions >= frequency.maxImpressionsPerUser
  ) {
    return {
      reason: 'frequency_exhausted',
      detail: `Seen ${impressions} of ${frequency.maxImpressionsPerUser} allowed.`,
    }
  }

  const lastSeen = asTime(state?.lastSeenAt)
  if (
    typeof frequency?.minHoursBetweenImpressions === 'number' &&
    lastSeen !== null &&
    now - lastSeen < frequency.minHoursBetweenImpressions * HOUR_MS
  ) {
    return {
      reason: 'frequency_exhausted',
      detail: `Shown within the last ${frequency.minHoursBetweenImpressions} hours.`,
    }
  }

  const totalImpressions = candidate.stats?.impressions ?? 0
  if (
    typeof frequency?.maxImpressionsTotal === 'number' &&
    totalImpressions >= frequency.maxImpressionsTotal
  ) {
    return {
      reason: 'frequency_exhausted',
      detail: `Reached its overall cap of ${frequency.maxImpressionsTotal}.`,
    }
  }

  return null
}

/**
 * Whether a campaign dialog should wait because the account has seen a dialog
 * recently. Operational dialogs are exempt: they carry their own frequency and
 * must not be muzzled by a promotion the reader saw earlier.
 *
 * Without this, closing one dialog frees the single modal slot and the next one
 * opens straight away, which reads as a chain of pop-ups.
 */
function campaignModalsHeldBack(input: SelectionInput, now: number): boolean {
  const hours = input.settings.modalMinIntervalHours
  if (!hours || hours <= 0) return false
  const modalIds = new Set(
    (input.candidates || [])
      .filter((candidate) => candidate.placement === 'modal')
      .map((candidate) => String(candidate.id)),
  )
  if (!modalIds.size) return false
  const cutoff = now - hours * 60 * 60 * 1000
  return (input.states || []).some((state) => {
    if (!modalIds.has(String(state.notificationId))) return false
    const seen = asTime(state.lastSeenAt)
    return seen !== null && seen > cutoff
  })
}

export function selectNotifications(input: SelectionInput): SelectionResult {
  const now = input.now.getTime()
  const stateById = new Map(
    (input.states || []).map((s) => [String(s.notificationId), s]),
  )
  const filtered: FilteredNotification[] = []

  interface Eligible {
    candidate: Candidate
    variant: Variant
    sortKey: number
  }
  const eligible: Eligible[] = []

  for (const candidate of input.candidates || []) {
    const state = stateById.get(String(candidate.id))

    // Audience is evaluated even for records already blocked, so a
    // preview always has a trace to annotate. It is arithmetic over an
    // already-loaded context, so this costs nothing worth saving.
    const context: EvaluationContext = {
      ...input.baseContext,
      ...stateContext(state, now),
    }
    const audience = evaluateCondition(candidate.audience, context)

    // Schedule is reported ahead of audience: it applies to everyone, so it is
    // the more fundamental answer to "why is nobody seeing this".
    const scheduleBlock = scheduleReason(candidate, now)
    if (scheduleBlock) {
      filtered.push({
        id: candidate.id,
        key: candidate.key,
        ...scheduleBlock,
        trace: audience.trace,
      })
      continue
    }

    if (!audience.passed) {
      filtered.push({
        id: candidate.id,
        key: candidate.key,
        reason: 'audience_failed',
        detail:
          audience.result === 'unknown'
            ? 'Some conditions could not be judged for this account.'
            : undefined,
        trace: audience.trace,
      })
      continue
    }

    const block = accountReason(candidate, state, now)
    if (block) {
      filtered.push({
        id: candidate.id,
        key: candidate.key,
        ...block,
        trace: audience.trace,
      })
      continue
    }

    const variant = pickVariant(candidate, input.seed)
    if (!variant) {
      filtered.push({
        id: candidate.id,
        key: candidate.key,
        reason: 'disabled',
        detail: 'No content to show.',
        trace: audience.trace,
      })
      continue
    }

    eligible.push({
      candidate,
      variant,
      sortKey: weightedKey(
        input.seed,
        candidate.id,
        candidate.weight ?? 1,
      ),
    })
  }

  // System first, then priority, then the weighted shuffle, then oldest first,
  // then id so the order is total and stable.
  eligible.sort((a, b) => {
    const systemA = a.candidate.kind === 'system' ? 0 : 1
    const systemB = b.candidate.kind === 'system' ? 0 : 1
    if (systemA !== systemB) return systemA - systemB

    const priorityA = a.candidate.priority ?? 0
    const priorityB = b.candidate.priority ?? 0
    if (priorityA !== priorityB) return priorityB - priorityA

    if (a.sortKey !== b.sortKey) return b.sortKey - a.sortKey

    const createdA = asTime(a.candidate.createdAt) ?? 0
    const createdB = asTime(b.candidate.createdAt) ?? 0
    if (createdA !== createdB) return createdA - createdB

    return a.candidate.id < b.candidate.id ? -1 : 1
  })

  const served: ServedNotification[] = []
  const usedGroups = new Set<string>()

  // Absent settings default rather than comparing against undefined, which is
  // always false and would serve without any limit at all.
  const campaignTileCap = input.settings.maxTilesAtOnce ?? 2
  const systemTileCap = input.settings.maxSystemTilesAtOnce ?? 2
  const modalCap = input.settings.maxModalsPerLoad ?? 1
  const overflowCap = input.settings.overflowTiles ?? 0

  const shown = { systemTile: 0, campaignTile: 0, modal: 0 }
  let overflowed = 0
  const holdCampaignModals = campaignModalsHeldBack(input, now)

  for (const item of eligible) {
    const { candidate, variant } = item

    const group = candidate.group || ''
    if (group && usedGroups.has(group)) {
      filtered.push({
        id: candidate.id,
        key: candidate.key,
        reason: 'group_collapsed',
        detail: `Another notification in "${group}" ranked higher.`,
      })
      continue
    }

    const isSystem = candidate.kind === 'system'
    let overflow = false

    if (candidate.placement === 'modal') {
      if (!isSystem && holdCampaignModals) {
        filtered.push({
          id: candidate.id,
          key: candidate.key,
          reason: 'capped',
          detail: `A dialog was shown within the last ${input.settings.modalMinIntervalHours} hours.`,
        })
        continue
      }
      if (shown.modal >= modalCap) {
        filtered.push({
          id: candidate.id,
          key: candidate.key,
          reason: 'capped',
          detail: `Over the limit of ${modalCap} modals.`,
        })
        continue
      }
    } else if (isSystem) {
      if (shown.systemTile >= systemTileCap) {
        filtered.push({
          id: candidate.id,
          key: candidate.key,
          reason: 'capped',
          detail: `Over the limit of ${systemTileCap} operational tiles.`,
        })
        continue
      }
    } else if (shown.campaignTile >= campaignTileCap) {
      // Past the visible budget a campaign is carried as overflow rather than
      // dropped, so a renderer can offer it instead of hiding it for good.
      if (overflowed >= overflowCap) {
        filtered.push({
          id: candidate.id,
          key: candidate.key,
          reason: 'capped',
          detail: `Over the limit of ${campaignTileCap} campaign tiles and ${overflowCap} held back.`,
        })
        continue
      }
      overflow = true
    }

    if (group) usedGroups.add(group)
    if (candidate.placement === 'modal') shown.modal += 1
    else if (isSystem) shown.systemTile += 1
    else if (overflow) overflowed += 1
    else shown.campaignTile += 1

    served.push({
      id: candidate.id,
      key: candidate.key,
      kind: candidate.kind,
      placement: candidate.placement,
      tone: candidate.tone,
      renderer: candidate.renderer || 'standard',
      rank: served.length + 1,
      variantId: variant.id,
      title: variant.title,
      body: variant.body,
      actions: (variant.actions || []).map((action) => ({
        ...action,
        href: interpolateHref(action.href, input.tokens),
      })),
      // Opt in, not opt out: a record is dismissible only if it says so. The
      // operational alerts leave this off, which is why a past-due warning
      // cannot be cleared away.
      dismissible: candidate.dismiss?.enabled === true,
      dismissAfterSeconds: candidate.dismiss?.requireSeconds,
      ...(overflow ? { overflow: true } : {}),
    })
  }

  return { served, filtered }
}
