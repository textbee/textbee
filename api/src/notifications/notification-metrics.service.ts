import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Interval } from '@nestjs/schedule'
import { Model } from 'mongoose'
import {
  FilteredNotification,
  ServedNotification,
} from './rules/notification-ranker'
import { NodeTrace } from './rules/types'
import {
  NotificationDailyStats,
  NotificationDailyStatsDocument,
} from './schemas/notification-daily-stats.schema'

// Counters for the dashboard notification engine, kept in process and flushed
// on a timer. The database is a region away and its egress bill is already
// worth watching, so the feed request path gains no write and no read from any
// of this: one flush every 60 seconds is 1,440 writes a day whatever the
// traffic.
//
// A hard crash loses at most 60 seconds of counters. That is the deliberate
// trade: these are counters, and durability for them would cost more than the
// numbers are worth.
//
// Like the existing crons this assumes pm2's single instance in fork mode. If
// that ever changes the counters still merge correctly, because every path here
// is $inc or $addToSet rather than a read followed by a write.

const FLUSH_MS = 60_000

/** Keeps the sample a sample rather than a second copy of the account base. */
const CAP_BLOCKED_SAMPLE_LIMIT = 200

export type FeedOutcome =
  | 'served'
  | 'engine_off'
  | 'global_off'
  | 'no_candidates'
  | 'zero_served'

// 'served' has no counter of its own: it is feeds minus the other five, and a
// sixth field would only be another thing that can disagree.
const OUTCOME_FIELD: Record<FeedOutcome, string | null> = {
  served: null,
  engine_off: 'feedsEngineOff',
  global_off: 'feedsGlobalOff',
  no_candidates: 'feedsNoCandidates',
  zero_served: 'feedsZeroServed',
}

export interface FeedMetricsInput {
  outcome: FeedOutcome
  latencyMs: number
  userId?: string
  served?: ServedNotification[]
  filtered?: FilteredNotification[]
  at?: Date
}

export interface EventMetricsInput {
  notificationId: string
  type: 'impression' | 'click' | 'dismiss'
  /** A replayed dismissal, counted apart from a real one. */
  migrated?: boolean
  at?: Date
}

export interface CoverageMetricsInput {
  accounts: number
  rollupComputed: number
  milestoneFirstSms: number
  stateRows: number
  at?: Date
}

interface DayBucket {
  inc: Record<string, number>
  capSample: string[]
  capSampleSent: number
}

export const utcDay = (at: Date): string => at.toISOString().slice(0, 10)

const latencyBucket = (ms: number): string => {
  if (ms < 50) return 'lt50'
  if (ms < 150) return 'lt150'
  if (ms < 500) return 'lt500'
  if (ms < 1500) return 'lt1500'
  return 'gte1500'
}

/** Attribute keys hold dots, which a update path would read as nesting. */
const safeAttrKey = (attr: string): string => attr.split('.').join('_')

// Leaves only. A parent node is unknown because a child was, so counting
// parents would report the same gap several times with no attribute to fix.
const collectUnknownAttrs = (
  trace: NodeTrace | undefined,
  into: Set<string>,
): void => {
  if (!trace) return
  if (trace.kind === 'leaf') {
    if (trace.result === 'unknown') into.add(trace.attr)
    return
  }
  if (trace.kind === 'not') {
    collectUnknownAttrs(trace.child, into)
    return
  }
  if (trace.kind === 'all' || trace.kind === 'any') {
    for (const child of trace.children) collectUnknownAttrs(child, into)
  }
}

// The owner's known problem: operational tiles nobody can dismiss take the
// whole budget while something else waits for it. At least one tile has to have
// been served, otherwise an empty feed would read as crowded out.
const isCapBlockedBySystem = (
  served: ServedNotification[],
  filtered: FilteredNotification[],
): boolean =>
  served.length > 0 &&
  filtered.some((entry) => entry.reason === 'capped') &&
  served.every(
    (entry) => entry.kind === 'system' && entry.dismissible === false,
  )

@Injectable()
export class NotificationMetricsService implements OnApplicationShutdown {
  private readonly logger = new Logger(NotificationMetricsService.name)

  private days: Record<string, DayBucket> = {}

  constructor(
    @InjectModel(NotificationDailyStats.name)
    private readonly statsModel: Model<NotificationDailyStatsDocument>,
  ) {}

  private bucket(at: Date | undefined): DayBucket {
    const day = utcDay(at ?? new Date())
    if (!this.days[day]) {
      this.days[day] = { inc: {}, capSample: [], capSampleSent: 0 }
    }
    return this.days[day]
  }

  private add(bucket: DayBucket, path: string, by = 1): void {
    bucket.inc[path] = (bucket.inc[path] ?? 0) + by
  }

  recordFeed(input: FeedMetricsInput): void {
    const bucket = this.bucket(input.at)
    const served = input.served ?? []
    const filtered = input.filtered ?? []

    this.add(bucket, 'feeds')
    const outcomeField = OUTCOME_FIELD[input.outcome]
    if (outcomeField) this.add(bucket, outcomeField)

    this.add(bucket, 'latencyMsTotal', Math.max(0, Math.round(input.latencyMs)))
    this.add(bucket, `latencyBuckets.${latencyBucket(input.latencyMs)}`)

    for (const entry of served) {
      this.add(bucket, `servedById.${entry.id}`)
    }

    const unknown = new Set<string>()
    for (const entry of filtered) {
      this.add(bucket, `filteredByIdReason.${entry.id}:${entry.reason}`)
      this.add(bucket, `filteredByReason.${entry.reason}`)
      collectUnknownAttrs(entry.trace, unknown)
    }
    // Once per feed, not once per node: a tree can reach the same missing
    // attribute many times and that is still one account we cannot judge.
    for (const attr of unknown) {
      this.add(bucket, `unknownAttrs.${safeAttrKey(attr)}`)
    }

    if (isCapBlockedBySystem(served, filtered)) {
      this.add(bucket, 'capBlockedBySystem')
      if (
        input.userId &&
        bucket.capSampleSent + bucket.capSample.length <
          CAP_BLOCKED_SAMPLE_LIMIT &&
        !bucket.capSample.includes(input.userId)
      ) {
        bucket.capSample.push(input.userId)
      }
    }
  }

  recordFeedError(at?: Date): void {
    const bucket = this.bucket(at)
    this.add(bucket, 'feeds')
    this.add(bucket, 'feedsErrored')
  }

  recordCandidateCache(hit: boolean, at?: Date): void {
    const bucket = this.bucket(at)
    this.add(bucket, hit ? 'candidateCacheHits' : 'candidateCacheMisses')
  }

  recordEvent(input: EventMetricsInput): void {
    const bucket = this.bucket(input.at)
    const id = input.notificationId
    if (input.type === 'impression') {
      this.add(bucket, `impressionsById.${id}`)
    } else if (input.type === 'click') {
      this.add(bucket, `clicksById.${id}`)
    } else if (input.migrated) {
      this.add(bucket, `migratedDismissesById.${id}`)
    } else {
      this.add(bucket, `dismissesById.${id}`)
    }
  }

  @Interval(FLUSH_MS)
  async flush(): Promise<void> {
    const today = utcDay(new Date())

    for (const [day, bucket] of Object.entries(this.days)) {
      const inc = bucket.inc
      const capSample = bucket.capSample
      bucket.inc = {}
      bucket.capSample = []
      bucket.capSampleSent += capSample.length

      const empty = !Object.keys(inc).length && !capSample.length
      // Yesterday's bucket is only kept until it has nothing left to send.
      if (empty && day !== today) {
        delete this.days[day]
        continue
      }
      if (empty) continue

      const update: Record<string, unknown> = { $setOnInsert: { day } }
      if (Object.keys(inc).length) update.$inc = inc
      if (capSample.length) {
        update.$addToSet = { capBlockedSample: { $each: capSample } }
      }

      try {
        await this.statsModel.updateOne({ day }, update, { upsert: true })
      } catch (error) {
        // Swallowed on purpose. A failed flush loses one window of counters,
        // which must not take a request or the process down.
        this.logger.error(
          `Notification metrics flush failed for ${day}: ${
            error?.message ?? error
          }`,
        )
      }
    }
  }

  /** One extra write a day, from the health task. */
  async recordCoverage(input: CoverageMetricsInput): Promise<void> {
    const at = input.at ?? new Date()
    const day = utcDay(at)
    await this.statsModel.updateOne(
      { day },
      {
        $set: {
          coverage: {
            accounts: input.accounts,
            rollupComputed: input.rollupComputed,
            milestoneFirstSms: input.milestoneFirstSms,
            stateRows: input.stateRows,
            at,
          },
        },
        $setOnInsert: { day },
      },
      { upsert: true },
    )
  }

  /** So a pm2 reload does not drop the open window. */
  async onApplicationShutdown(): Promise<void> {
    await this.flush()
  }
}
