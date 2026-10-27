import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { AnyBulkWriteOperation, Model, Types } from 'mongoose'
import { UserDocument } from '../users/schemas/user.schema'
import { NotificationContextLoader } from './context-loader'
import {
  FeedOutcome,
  NotificationMetricsService,
} from './notification-metrics.service'
import { referencedAttributes } from './rules/condition-evaluator'
import {
  Candidate,
  selectNotifications,
  ServedNotification,
} from './rules/notification-ranker'
import {
  DashboardNotification,
  DashboardNotificationDocument,
} from './schemas/dashboard-notification.schema'
import {
  NotificationSettings,
  NotificationSettingsDocument,
} from './schemas/notification-settings.schema'
import {
  NotificationState,
  NotificationStateDocument,
} from './schemas/notification-state.schema'

export type NotificationEventType = 'impression' | 'click' | 'dismiss'

export interface NotificationEventInput {
  notificationId: string
  variantId?: string
  type: NotificationEventType
  // The dashboard replays each browser's locally stored dismissals once when
  // it switches over. Those arrive with no matching impression, so counting
  // them as dismissals would put a dismiss rate above 100% on those records.
  source?: 'migration'
}

export interface DismissalMigration {
  notificationId: string
  storageKey: string
}

export interface FeedResponse {
  engineEnabled: boolean
  settings: {
    maxTilesAtOnce: number
    maxModalsPerLoad: number
  } | null
  notifications: ServedNotification[]
  /**
   * Records that supersede a flag the browser stored before any of this
   * existed. Every one of them, including records this feed held back, or a
   * dismissal the reader already made would come back when a slot freed up.
   */
  dismissalMigrations?: DismissalMigration[]
}

interface CandidateSet {
  candidates: Candidate[]
  dismissalMigrations: DismissalMigration[]
}

// Active records change rarely and every dashboard load would otherwise read
// them, so they are held briefly in process. Settings are deliberately NOT
// cached: the engine flag is the rollback, and a rollback that takes a minute to
// apply is not a rollback.
const CANDIDATE_CACHE_MS = 60_000

/** Fallback for "gone for this visit" when the setting is absent. */
const DEFAULT_SESSION_SNOOZE_HOURS = 4

const MAX_EVENTS_PER_REQUEST = 20

// Variant ids reach a Mongo update path (stats.byVariant.<id>), so they are
// restricted rather than trusted. A dot or a dollar in an operator-authored id
// would otherwise rewrite an unintended part of the document.
const SAFE_VARIANT_ID = /^[A-Za-z0-9_-]{1,40}$/

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  private candidateCache: {
    loadedAt: number
    set: CandidateSet
  } | null = null

  constructor(
    @InjectModel(DashboardNotification.name)
    private readonly notificationModel: Model<DashboardNotificationDocument>,
    @InjectModel(NotificationState.name)
    private readonly stateModel: Model<NotificationStateDocument>,
    @InjectModel(NotificationSettings.name)
    private readonly settingsModel: Model<NotificationSettingsDocument>,
    private readonly contextLoader: NotificationContextLoader,
    private readonly metrics: NotificationMetricsService,
  ) {}

  /** Read every time, never cached. See CANDIDATE_CACHE_MS. */
  async getSettings(): Promise<NotificationSettingsDocument> {
    const existing = await this.settingsModel.findOne({ scope: 'default' })
    if (existing) return existing

    // Born with the engine off, so a fresh deploy or the dev environment keeps
    // rendering the original banners until someone turns this on deliberately.
    return this.settingsModel.findOneAndUpdate(
      { scope: 'default' },
      { $setOnInsert: { scope: 'default', engineEnabled: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
  }

  private engineEnabledFor(
    settings: NotificationSettingsDocument,
    userId: Types.ObjectId,
  ): boolean {
    if (settings.engineEnabled) return true
    // The allowlist is how the engine gets proven against production data with
    // an audience of one. It only matters while the flag is off.
    return (settings.engineEnabledForUserIds || []).includes(String(userId))
  }

  private async loadCandidates(): Promise<CandidateSet> {
    const now = Date.now()
    if (
      this.candidateCache &&
      now - this.candidateCache.loadedAt < CANDIDATE_CACHE_MS
    ) {
      this.metrics.recordCandidateCache(true)
      return this.candidateCache.set
    }
    this.metrics.recordCandidateCache(false)

    // Schedule is applied per request by the ranker rather than here, so one
    // cached list serves every account regardless of when it is read.
    const records = await this.notificationModel
      .find({ status: 'active' })
      .lean()

    const candidates: Candidate[] = records.map((record: any) => ({
      id: String(record._id),
      key: record.key,
      kind: record.kind,
      placement: record.placement,
      tone: record.tone,
      renderer: record.renderer,
      priority: record.priority,
      weight: record.weight,
      group: record.group ?? null,
      audience: record.audience ?? null,
      schedule: record.schedule ?? null,
      dismiss: record.dismiss ?? null,
      frequency: record.frequency ?? null,
      variants: record.variants ?? [],
      stats: record.stats ?? null,
      createdAt: record.createdAt ?? null,
    }))

    const dismissalMigrations = records
      .filter((record: any) => record.legacyDismissalKey)
      .map((record: any) => ({
        notificationId: String(record._id),
        storageKey: String(record.legacyDismissalKey),
      }))

    const set: CandidateSet = { candidates, dismissalMigrations }
    this.candidateCache = { loadedAt: now, set }
    return set
  }

  /** Drops the cache so an edit shows up at once in a dev loop. */
  clearCandidateCache(): void {
    this.candidateCache = null
  }

  async getFeed(user: UserDocument, now = new Date()): Promise<FeedResponse> {
    const startedAt = Date.now()
    try {
      return await this.buildFeed(user, now, startedAt)
    } catch (error) {
      // A 500 here silently drops the dashboard back to its built-in messages,
      // so without this an engine that is completely broken reads exactly like
      // one that is switched off.
      this.metrics.recordFeedError(now)
      this.logger.error(
        `Notification feed failed for ${user?._id}: ${error?.message ?? error}`,
      )
      throw error
    }
  }

  // Four of the five ways this can end return an empty list, and from outside
  // they are indistinguishable. Each is counted separately so an empty
  // dashboard can be explained without guessing.
  private async buildFeed(
    user: UserDocument,
    now: Date,
    startedAt: number,
  ): Promise<FeedResponse> {
    const settings = await this.getSettings()

    if (!this.engineEnabledFor(settings, user._id)) {
      // The dashboard reads this and renders the original banners instead. No
      // other work is done, so the flag being off costs one document read.
      this.recordOutcome('engine_off', startedAt, now)
      return { engineEnabled: false, settings: null, notifications: [] }
    }

    if (!settings.globalEnabled) {
      this.recordOutcome('global_off', startedAt, now)
      return {
        engineEnabled: true,
        settings: {
          maxTilesAtOnce: settings.maxTilesAtOnce,
          maxModalsPerLoad: settings.maxModalsPerLoad,
        },
        notifications: [],
      }
    }

    const { candidates, dismissalMigrations } = await this.loadCandidates()
    if (!candidates.length) {
      this.recordOutcome('no_candidates', startedAt, now)
      return {
        engineEnabled: true,
        settings: {
          maxTilesAtOnce: settings.maxTilesAtOnce,
          maxModalsPerLoad: settings.maxModalsPerLoad,
        },
        notifications: [],
      }
    }

    const referenced = new Set<string>()
    for (const candidate of candidates) {
      for (const key of referencedAttributes(candidate.audience as any)) {
        referenced.add(key)
      }
    }

    const [context, states] = await Promise.all([
      this.contextLoader.build({ user, settings, now, referenced }),
      this.stateModel
        .find({
          user: user._id,
          notification: { $in: candidates.map((c) => new Types.ObjectId(c.id)) },
        })
        .lean(),
    ])

    const { served, filtered } = selectNotifications({
      candidates,
      states: states.map((state: any) => ({
        notificationId: String(state.notification),
        impressions: state.impressions,
        lastSeenAt: state.lastSeenAt,
        clickedAt: state.clickedAt,
        dismissedAt: state.dismissedAt,
        snoozedUntil: state.snoozedUntil,
      })),
      settings: {
        maxTilesAtOnce: settings.maxTilesAtOnce ?? 2,
        maxSystemTilesAtOnce: settings.maxSystemTilesAtOnce ?? 2,
        maxModalsPerLoad: settings.maxModalsPerLoad ?? 1,
        overflowTiles: settings.overflowTiles ?? 3,
        modalMinIntervalHours: settings.modalMinIntervalHours ?? 24,
      },
      baseContext: context,
      now,
      // Stable per account per day, so the chosen copy does not change under
      // the reader between refetches.
      seed: `${user._id}:${now.toISOString().slice(0, 10)}`,
      // Lets an authored link carry who is clicking, which is how the feedback
      // form prefills its name and email fields.
      tokens: {
        'user.id': String(user._id),
        'user.name': (user as any).name,
        'user.email': (user as any).email,
      },
    })

    // The dangerous empty feed: the engine is on and candidates existed, so
    // the rules held everything back rather than there being nothing to show.
    this.metrics.recordFeed({
      outcome: served.length ? 'served' : 'zero_served',
      latencyMs: Date.now() - startedAt,
      userId: String(user._id),
      served,
      filtered,
      at: now,
    })

    return {
      engineEnabled: true,
      settings: {
        maxTilesAtOnce: settings.maxTilesAtOnce,
        maxModalsPerLoad: settings.maxModalsPerLoad,
      },
      notifications: served,
      dismissalMigrations,
    }
  }

  /** The exits that end before the ranker runs, so only the exit is counted. */
  private recordOutcome(
    outcome: FeedOutcome,
    startedAt: number,
    now: Date,
  ): void {
    this.metrics.recordFeed({
      outcome,
      latencyMs: Date.now() - startedAt,
      at: now,
    })
  }

  /**
   * Impressions, clicks and dismissals arrive here rather than being written by
   * the feed: react-query refetches and prefetches would otherwise inflate every
   * counter.
   */
  async recordEvents(
    user: UserDocument,
    events: NotificationEventInput[],
  ): Promise<{ recorded: number }> {
    if (!Array.isArray(events) || !events.length) return { recorded: 0 }
    if (events.length > MAX_EVENTS_PER_REQUEST) {
      throw new BadRequestException(
        `At most ${MAX_EVENTS_PER_REQUEST} events per request.`,
      )
    }

    const byId = new Map<string, NotificationEventInput[]>()
    for (const event of events) {
      if (!Types.ObjectId.isValid(String(event?.notificationId))) continue
      if (!['impression', 'click', 'dismiss'].includes(event?.type)) continue
      const id = String(event.notificationId)
      byId.set(id, [...(byId.get(id) ?? []), event])
    }
    if (!byId.size) return { recorded: 0 }

    // Only count events for records that exist, so a stale or invented id cannot
    // create state rows. The dismiss rule comes along because a dismissal has to
    // be allowed before it is recorded.
    const known = await this.notificationModel
      .find({ _id: { $in: [...byId.keys()].map((id) => new Types.ObjectId(id)) } })
      .select('_id dismiss')
      .lean()
    const knownIds = new Set(known.map((n: any) => String(n._id)))
    const dismissRules = new Map<string, any>(
      known.map((n: any) => [String(n._id), n.dismiss ?? {}]),
    )

    const stateOps: AnyBulkWriteOperation[] = []
    const notificationOps: AnyBulkWriteOperation[] = []
    const now = new Date()
    let recorded = 0

    for (const [id, group] of byId) {
      if (!knownIds.has(id)) continue
      const notificationId = new Types.ObjectId(id)

      const stateSet: Record<string, unknown> = {}
      const stateInc: Record<string, number> = {}
      const statsInc: Record<string, number> = {}
      let impressed = false

      for (const event of group) {
        const variantId =
          event.variantId && SAFE_VARIANT_ID.test(event.variantId)
            ? event.variantId
            : undefined

        if (event.type === 'impression') {
          impressed = true
          stateInc['impressions'] = (stateInc['impressions'] ?? 0) + 1
          stateSet['lastSeenAt'] = now
          if (variantId) stateSet['lastVariantId'] = variantId
          statsInc['stats.impressions'] = (statsInc['stats.impressions'] ?? 0) + 1
          if (variantId) {
            const path = `stats.byVariant.${variantId}.impressions`
            statsInc[path] = (statsInc[path] ?? 0) + 1
          }
        } else if (event.type === 'click') {
          stateSet['clickedAt'] = now
          // Counted as well as stamped: clickedAt alone cannot tell 100 clicks
          // from three keen accounts apart from 100 accounts clicking once.
          stateInc['clicks'] = (stateInc['clicks'] ?? 0) + 1
          statsInc['stats.clicks'] = (statsInc['stats.clicks'] ?? 0) + 1
          if (variantId) {
            const path = `stats.byVariant.${variantId}.clicks`
            statsInc[path] = (statsInc[path] ?? 0) + 1
          }
        } else {
          // A dismissal has to be permitted before it is honoured. Without this
          // check one request could set dismissedAt on an operational alert,
          // which the ranker then treats as permanently cleared, and a past-due
          // or verification warning would never be shown to that account again.
          const rule = dismissRules.get(id)
          if (rule?.enabled !== true) continue
          stateSet['dismissedAt'] = now
          // Mirrors the dismiss endpoint. For a snooze-mode record the ranker
          // reads snoozedUntil, not dismissedAt, so writing only the latter
          // would record a dismissal that changed nothing. That is the path the
          // legacy migration uses, so it would have quietly failed to carry over
          // the dismissals it exists to carry.
          const snoozeFrom = this.snoozeUntil(
            rule,
            now,
            undefined,
            await this.sessionHoursFor(rule?.mode),
          )
          if (snoozeFrom) stateSet['snoozedUntil'] = snoozeFrom

          if (event.source === 'migration') {
            // A replay of a dismissal the browser already held, so it is kept
            // out of stats.dismisses and out of the per-variant comparison:
            // there is no impression behind it to divide by.
            statsInc['stats.migratedDismisses'] =
              (statsInc['stats.migratedDismisses'] ?? 0) + 1
          } else {
            stateInc['dismissCount'] = (stateInc['dismissCount'] ?? 0) + 1
            statsInc['stats.dismisses'] = (statsInc['stats.dismisses'] ?? 0) + 1
            if (variantId) {
              const path = `stats.byVariant.${variantId}.dismisses`
              statsInc[path] = (statsInc[path] ?? 0) + 1
            }
          }
        }
        this.metrics.recordEvent({
          notificationId: id,
          type: event.type,
          migrated: event.source === 'migration',
          at: now,
        })
        recorded += 1
      }

      // Nothing to write means nothing to upsert. Without this a skipped event,
      // such as a dismissal of something that cannot be dismissed, would still
      // create an empty state row.
      if (Object.keys(stateSet).length || Object.keys(stateInc).length) {
        stateOps.push({
          updateOne: {
            filter: { user: user._id, notification: notificationId },
            update: {
              ...(Object.keys(stateSet).length ? { $set: stateSet } : {}),
              ...(Object.keys(stateInc).length ? { $inc: stateInc } : {}),
              $setOnInsert: {
                user: user._id,
                notification: notificationId,
                firstSeenAt: now,
              },
            },
            upsert: true,
          },
        })
      }

      if (Object.keys(statsInc).length || impressed) {
        notificationOps.push({
          updateOne: {
            filter: { _id: notificationId },
            update: {
              ...(Object.keys(statsInc).length ? { $inc: statsInc } : {}),
              // Rides a write that was going out anyway. Gives "this record has
              // gone quiet" and "this one has never been served" without an
              // aggregation over every state row.
              ...(impressed
                ? {
                    $max: { 'stats.lastImpressionAt': now },
                    $min: { 'stats.firstImpressionAt': now },
                  }
                : {}),
            },
          },
        })
      }
    }

    if (stateOps.length) await this.stateModel.bulkWrite(stateOps)
    if (notificationOps.length) {
      await this.notificationModel.bulkWrite(notificationOps)
    }

    return { recorded }
  }

  /**
   * When a dismissal should hide a record until a later time rather than for
   * good. Null only for permanent mode, which the ranker reads from
   * dismissedAt instead.
   *
   * Session mode resolves to a few hours: there is no session on this side, and
   * a mode that wrote nothing left the reader's click doing nothing at all.
   * A snooze with no configured hours falls back rather than returning null,
   * for the same reason.
   */
  /**
   * Reads the configured length of "gone for this visit", and only then. The
   * settings document is not cached, so resolving it for every dismissal would
   * put a cross-region read on a path that does not otherwise need one.
   */
  private async sessionHoursFor(mode?: string): Promise<number> {
    if (mode !== 'session') return DEFAULT_SESSION_SNOOZE_HOURS
    const settings = await this.getSettings()
    return settings.sessionSnoozeHours ?? DEFAULT_SESSION_SNOOZE_HOURS
  }

  private snoozeUntil(
    rule: { mode?: string; snoozeHours?: number } | undefined | null,
    now: Date,
    requestedHours?: number,
    sessionHours = DEFAULT_SESSION_SNOOZE_HOURS,
  ): Date | null {
    const mode = rule?.mode ?? 'permanent'
    if (mode === 'permanent') return null
    const fallback = mode === 'session' ? sessionHours : 24
    const hours =
      typeof requestedHours === 'number' && Number.isFinite(requestedHours)
        ? Math.min(Math.max(requestedHours, 1), 24 * 365)
        : (rule?.snoozeHours ?? fallback)
    return new Date(now.getTime() + hours * 60 * 60 * 1000)
  }

  async dismiss(
    user: UserDocument,
    notificationId: string,
    snoozeHours?: number,
  ): Promise<{ success: true }> {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new BadRequestException('Unknown notification.')
    }

    const notification = await this.notificationModel
      .findById(notificationId)
      .select('dismiss')
      .lean()
    if (!notification) throw new BadRequestException('Unknown notification.')

    if ((notification as any).dismiss?.enabled !== true) {
      throw new BadRequestException('That notification cannot be dismissed.')
    }

    const now = new Date()
    const update: Record<string, unknown> = { dismissedAt: now }
    const rule = (notification as any).dismiss
    const snoozedUntil = this.snoozeUntil(
      rule,
      now,
      snoozeHours,
      await this.sessionHoursFor(rule?.mode),
    )
    if (snoozedUntil) update.snoozedUntil = snoozedUntil

    // The row as it was comes back from the write itself, so telling a first
    // dismissal from a repeat costs no extra round trip.
    const previous = await this.stateModel
      .findOneAndUpdate(
        { user: user._id, notification: new Types.ObjectId(notificationId) },
        {
          $set: update,
          $inc: { dismissCount: 1 },
          $setOnInsert: {
            user: user._id,
            notification: new Types.ObjectId(notificationId),
            firstSeenAt: now,
          },
        },
        { upsert: true, new: false, projection: 'dismissedAt' },
      )
      .lean()

    // A snooze-mode record comes back and can be cleared again every time, and
    // stats.dismisses is the one number copy decisions get judged by. Counting
    // every pass of that loop would inflate it per account rather than per
    // account that dismissed. dismissCount above keeps the raw number.
    if (!(previous as any)?.dismissedAt) {
      await this.notificationModel.updateOne(
        { _id: notificationId },
        { $inc: { 'stats.dismisses': 1 } },
      )
      this.metrics.recordEvent({ notificationId, type: 'dismiss', at: now })
    }

    return { success: true }
  }
}
