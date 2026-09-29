import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { AnyBulkWriteOperation, Model, Types } from 'mongoose'
import { UserDocument } from '../users/schemas/user.schema'
import { NotificationContextLoader } from './context-loader'
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
}

export interface FeedResponse {
  engineEnabled: boolean
  settings: {
    maxTilesAtOnce: number
    maxModalsPerLoad: number
  } | null
  notifications: ServedNotification[]
}

// Active records change rarely and every dashboard load would otherwise read
// them, so they are held briefly in process. Settings are deliberately NOT
// cached: the engine flag is the rollback, and a rollback that takes a minute to
// apply is not a rollback.
const CANDIDATE_CACHE_MS = 60_000

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
    candidates: Candidate[]
  } | null = null

  constructor(
    @InjectModel(DashboardNotification.name)
    private readonly notificationModel: Model<DashboardNotificationDocument>,
    @InjectModel(NotificationState.name)
    private readonly stateModel: Model<NotificationStateDocument>,
    @InjectModel(NotificationSettings.name)
    private readonly settingsModel: Model<NotificationSettingsDocument>,
    private readonly contextLoader: NotificationContextLoader,
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

  private async loadCandidates(): Promise<Candidate[]> {
    const now = Date.now()
    if (
      this.candidateCache &&
      now - this.candidateCache.loadedAt < CANDIDATE_CACHE_MS
    ) {
      return this.candidateCache.candidates
    }

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

    this.candidateCache = { loadedAt: now, candidates }
    return candidates
  }

  /** Drops the cache so an edit shows up at once in a dev loop. */
  clearCandidateCache(): void {
    this.candidateCache = null
  }

  async getFeed(user: UserDocument, now = new Date()): Promise<FeedResponse> {
    const settings = await this.getSettings()

    if (!this.engineEnabledFor(settings, user._id)) {
      // The dashboard reads this and renders the original banners instead. No
      // other work is done, so the flag being off costs one document read.
      return { engineEnabled: false, settings: null, notifications: [] }
    }

    if (!settings.globalEnabled) {
      return {
        engineEnabled: true,
        settings: {
          maxTilesAtOnce: settings.maxTilesAtOnce,
          maxModalsPerLoad: settings.maxModalsPerLoad,
        },
        notifications: [],
      }
    }

    const candidates = await this.loadCandidates()
    if (!candidates.length) {
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

    const { served } = selectNotifications({
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
        maxTilesAtOnce: settings.maxTilesAtOnce,
        maxModalsPerLoad: settings.maxModalsPerLoad,
        systemBypassesCap: settings.systemBypassesCap,
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

    return {
      engineEnabled: true,
      settings: {
        maxTilesAtOnce: settings.maxTilesAtOnce,
        maxModalsPerLoad: settings.maxModalsPerLoad,
      },
      notifications: served,
    }
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

      for (const event of group) {
        const variantId =
          event.variantId && SAFE_VARIANT_ID.test(event.variantId)
            ? event.variantId
            : undefined

        if (event.type === 'impression') {
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
          const snoozeFrom = this.snoozeUntil(rule, now)
          if (snoozeFrom) stateSet['snoozedUntil'] = snoozeFrom
          statsInc['stats.dismisses'] = (statsInc['stats.dismisses'] ?? 0) + 1
          if (variantId) {
            const path = `stats.byVariant.${variantId}.dismisses`
            statsInc[path] = (statsInc[path] ?? 0) + 1
          }
        }
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

      if (Object.keys(statsInc).length) {
        notificationOps.push({
          updateOne: { filter: { _id: notificationId }, update: { $inc: statsInc } },
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
   * good. Null for permanent and session modes, which the ranker reads from
   * dismissedAt instead.
   */
  private snoozeUntil(
    rule: { mode?: string; snoozeHours?: number } | undefined | null,
    now: Date,
    requestedHours?: number,
  ): Date | null {
    if ((rule?.mode ?? 'permanent') !== 'snooze') return null
    const hours =
      typeof requestedHours === 'number' && Number.isFinite(requestedHours)
        ? Math.min(Math.max(requestedHours, 1), 24 * 365)
        : rule?.snoozeHours
    if (!hours) return null
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
    const snoozedUntil = this.snoozeUntil(
      (notification as any).dismiss,
      now,
      snoozeHours,
    )
    if (snoozedUntil) update.snoozedUntil = snoozedUntil

    await this.stateModel.updateOne(
      { user: user._id, notification: new Types.ObjectId(notificationId) },
      {
        $set: update,
        $setOnInsert: {
          user: user._id,
          notification: new Types.ObjectId(notificationId),
          firstSeenAt: now,
        },
      },
      { upsert: true },
    )

    await this.notificationModel.updateOne(
      { _id: notificationId },
      { $inc: { 'stats.dismisses': 1 } },
    )

    return { success: true }
  }
}
