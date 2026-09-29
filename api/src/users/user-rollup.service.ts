import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { AnyBulkWriteOperation, Model, Types } from 'mongoose'
import { ApiKey } from '../auth/schemas/api-key.schema'
import { Device } from '../gateway/schemas/device.schema'
import { SMS } from '../gateway/schemas/sms.schema'
import { Subscription } from '../billing/schemas/subscription.schema'
import { User, UserDocument } from './schemas/user.schema'

// Owns user.rollup. This is the only place the counts behind it are derived, so
// the stored numbers can be read elsewhere rather than the aggregation being
// reimplemented, which would risk a preview disagreeing with the live feed.
//
// Nothing here runs on the message send path. The rollup holds device and API
// key facts, which change rarely; the message counts it deliberately does not
// hold are counted on demand, because the quota window slides.

/**
 * The earliest date an account actually paid, across its paid subscriptions.
 *
 * Each row's effective date is the provider's start date where it reported one,
 * else when we recorded the row. Taking the minimum of those rather than reading
 * one chosen row matters because the two orderings can disagree.
 */
function earliestPaymentDate(
  subscriptions: Array<{ createdAt?: Date; subscriptionStartDate?: Date }>,
): Date | undefined {
  let earliest: Date | undefined
  for (const subscription of subscriptions || []) {
    const effective =
      subscription?.subscriptionStartDate ?? subscription?.createdAt
    if (!effective) continue
    const at = new Date(effective)
    if (!earliest || at < earliest) earliest = at
  }
  return earliest
}

interface RollupFacts {
  deviceCount: number
  apiKeyCount: number
  totalSentSms: number
  minAppVersionCode?: number
}

@Injectable()
export class UserRollupService {
  private readonly logger = new Logger(UserRollupService.name)

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Device.name) private readonly deviceModel: Model<any>,
    @InjectModel(ApiKey.name) private readonly apiKeyModel: Model<any>,
    @InjectModel(SMS.name) private readonly smsModel: Model<any>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<any>,
  ) {}

  /** Recompute one account from source and store it. */
  async recomputeForUser(userId: Types.ObjectId | string): Promise<void> {
    const id = new Types.ObjectId(String(userId))
    const facts = await this.factsFor(id)
    // timestamps off: the rollup is derived telemetry, and bumping updatedAt
    // would make a maintenance write indistinguishable from a real change to
    // the account.
    await this.userModel.updateOne(
      { _id: id },
      { $set: this.toUpdate(facts) },
      { timestamps: false },
    )
  }

  /**
   * Called when an account's devices or API keys change. A recount rather than a
   * delta: it is a single indexed read on a small collection, and it cannot
   * drift the way a missed increment would.
   *
   * Never throws. This keeps derived reporting data current; it must not be able
   * to fail a device registration or an API key revocation, and the nightly
   * sweep repairs anything a failure here leaves stale.
   */
  async refreshQuietly(userId: Types.ObjectId | string | undefined): Promise<void> {
    if (!userId) return
    try {
      await this.recomputeForUser(userId)
    } catch (error) {
      this.logger.warn(
        `Could not refresh rollup for ${String(userId)}: ${error?.message ?? error}`,
      )
    }
  }

  /**
   * The same facts for many accounts in two aggregations rather than two queries
   * each.
   *
   * This matters more than it looks: the application runs in Europe and the
   * database in us-east-1, so a round trip costs about 90ms. Measured against
   * production, the per-account path took 562ms, which is nearly six hours for
   * the whole base and would have been repeated by the nightly sweep. Grouping
   * server side also keeps the result small, which is the shape this database's
   * egress bill wants.
   */
  private async factsForMany(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, RollupFacts>> {
    const [devices, apiKeys] = await Promise.all([
      this.deviceModel.aggregate([
        { $match: { user: { $in: userIds } } },
        {
          $group: {
            _id: '$user',
            deviceCount: { $sum: 1 },
            totalSentSms: { $sum: { $ifNull: ['$sentSMSCount', 0] } },
            // Same precedence the dashboard uses: the heartbeat-reported build
            // wins over the one recorded at registration.
            minAppVersionCode: {
              $min: {
                $ifNull: ['$appVersionInfo.versionCode', '$appVersionCode'],
              },
            },
          },
        },
      ]),
      this.apiKeyModel.aggregate([
        { $match: { user: { $in: userIds } } },
        {
          $group: {
            _id: '$user',
            // Only unrevoked keys count, but the pass has to see all of them to
            // derive the first one, so it is one group rather than two queries.
            apiKeyCount: {
              $sum: {
                $cond: [
                  { $eq: [{ $ifNull: ['$revokedAt', null] }, null] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ])

    const byId = new Map<string, RollupFacts>()
    for (const id of userIds) {
      byId.set(String(id), {
        deviceCount: 0,
        apiKeyCount: 0,
        totalSentSms: 0,
        minAppVersionCode: undefined,
      })
    }
    for (const row of devices as any[]) {
      const facts = byId.get(String(row._id))
      if (!facts) continue
      facts.deviceCount = row.deviceCount ?? 0
      facts.totalSentSms = row.totalSentSms ?? 0
      facts.minAppVersionCode =
        typeof row.minAppVersionCode === 'number'
          ? row.minAppVersionCode
          : undefined
    }
    for (const row of apiKeys as any[]) {
      const facts = byId.get(String(row._id))
      if (facts) facts.apiKeyCount = row.apiKeyCount ?? 0
    }
    return byId
  }

  private async factsFor(userId: Types.ObjectId): Promise<RollupFacts> {
    // Projected: device documents carry around ten telemetry subdocuments now,
    // and none of them are wanted here.
    const devices = await this.deviceModel
      .find({ user: userId })
      .select('sentSMSCount appVersionCode appVersionInfo.versionCode')
      .lean()

    const apiKeyCount = await this.apiKeyModel.countDocuments({
      user: userId,
      revokedAt: null,
    })

    let totalSentSms = 0
    let minAppVersionCode: number | undefined
    for (const device of devices) {
      totalSentSms += device.sentSMSCount || 0
      // Same precedence the dashboard uses: the heartbeat-reported version wins
      // over the one recorded at registration.
      const code =
        typeof device.appVersionInfo?.versionCode === 'number'
          ? device.appVersionInfo.versionCode
          : typeof device.appVersionCode === 'number'
            ? device.appVersionCode
            : undefined
      if (code !== undefined) {
        minAppVersionCode =
          minAppVersionCode === undefined
            ? code
            : Math.min(minAppVersionCode, code)
      }
    }

    return {
      deviceCount: devices.length,
      apiKeyCount,
      totalSentSms,
      minAppVersionCode,
    }
  }

  private toUpdate(facts: RollupFacts): Record<string, unknown> {
    const update: Record<string, unknown> = {
      'rollup.deviceCount': facts.deviceCount,
      'rollup.apiKeyCount': facts.apiKeyCount,
      'rollup.totalSentSms': facts.totalSentSms,
      'rollup.computedAt': new Date(),
    }
    // Absent rather than zero when no device reported a version: zero would read
    // as an ancient build and wrongly target the account for an update prompt.
    if (facts.minAppVersionCode === undefined) {
      update['rollup.minAppVersionCode'] = null
    } else {
      update['rollup.minAppVersionCode'] = facts.minAppVersionCode
    }
    return update
  }

  /**
   * Recompute every account in batches. Used by the nightly job and by the
   * one-off backfill. Returns how many accounts were written.
   */
  async recomputeAll(options?: {
    batchSize?: number
    onlyMissing?: boolean
    /** Recompute anything not measured within this many days. */
    staleAfterDays?: number
    /** Stop after this many accounts, so a repair pass stays bounded. */
    maxAccounts?: number
  }): Promise<number> {
    const batchSize = options?.batchSize ?? 500
    const maxAccounts = options?.maxAccounts ?? Infinity

    const missing = { 'rollup.computedAt': { $exists: false } }
    let filter: Record<string, unknown> = {}
    if (options?.staleAfterDays !== undefined) {
      // Repair shape: never measured, or measured too long ago to trust. A missed
      // change hook leaves a stale rollup that nothing else would notice.
      const cutoff = new Date(
        Date.now() - options.staleAfterDays * 24 * 60 * 60 * 1000,
      )
      filter = {
        $or: [missing, { 'rollup.computedAt': { $lt: cutoff } }],
      }
    } else if (options?.onlyMissing) {
      filter = missing
    }

    let processed = 0
    let lastId: Types.ObjectId | undefined

    for (;;) {
      if (processed >= maxAccounts) break
      const remaining = maxAccounts - processed
      const page = await this.userModel
        .find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
        .select('_id')
        .sort({ _id: 1 })
        .limit(Math.min(batchSize, remaining))
        .lean()

      if (!page.length) break

      const ids = page.map((row) => row._id as Types.ObjectId)
      const facts = await this.factsForMany(ids)
      const operations: AnyBulkWriteOperation[] = ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: this.toUpdate(facts.get(String(id))) },
          timestamps: false,
        },
      }))

      if (operations.length) {
        await this.userModel.bulkWrite(operations)
      }
      processed += page.length
      lastId = page[page.length - 1]._id as Types.ObjectId
    }

    return processed
  }

  /**
   * Fill in milestones for accounts that predate them. They were added in
   * September 2026 and never backfilled, so every milestone attribute currently
   * reads false for older accounts, which would quietly exclude exactly the
   * established accounts a campaign most wants.
   *
   * Written with $min so a real earlier date is never replaced by a later
   * derived one, and so re-running cannot move a date forward.
   *
   * Returns how many accounts actually changed, so a second run reports zero.
   */
  async backfillMilestones(options?: { batchSize?: number }): Promise<number> {
    const batchSize = options?.batchSize ?? 500
    let processed = 0
    let lastId: Types.ObjectId | undefined

    for (;;) {
      const page = await this.userModel
        .find(lastId ? { _id: { $gt: lastId } } : {})
        .select('_id milestones')
        .sort({ _id: 1 })
        .limit(batchSize)
        .lean()

      if (!page.length) break

      const ids = page.map((row) => row._id as Types.ObjectId)
      const derivedByUser = await this.derivedMilestonesForMany(ids)

      const operations: AnyBulkWriteOperation[] = []
      for (const id of ids) {
        const derived = derivedByUser.get(String(id)) ?? {}
        const update: Record<string, unknown> = {}
        for (const [field, value] of Object.entries(derived)) {
          if (value) update[`milestones.${field}`] = value
        }
        if (!Object.keys(update).length) continue
        operations.push({
          updateOne: {
            filter: { _id: id },
            update: { $min: update },
            // Also makes modifiedCount mean something: with timestamps on,
            // updatedAt changes on every pass and every account counts as
            // modified even when no milestone moved.
            timestamps: false,
          },
        })
      }

      if (operations.length) {
        // The modified count, not the attempted count. Every $min is issued
        // whether or not it changes anything, so reporting attempts would tell a
        // re-run it had written dates it merely re-confirmed.
        const result = await this.userModel.bulkWrite(operations)
        processed += result.modifiedCount ?? 0
      }
      lastId = page[page.length - 1]._id as Types.ObjectId
    }

    return processed
  }

  /**
   * Milestone dates for many accounts in four aggregations.
   *
   * The message pass is the expensive one, so it groups over the
   * {user, createdAt} index and returns one date per account rather than reading
   * documents. Per account this was five round trips; over the whole base that
   * was the difference between minutes and hours.
   */
  private async derivedMilestonesForMany(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, Record<string, Date | undefined>>> {
    const firstBy = async (
      model: Model<any>,
      match: Record<string, unknown>,
      field: string,
      expression: unknown = '$createdAt',
    ) => {
      const rows = await model.aggregate([
        { $match: { user: { $in: userIds }, ...match } },
        { $group: { _id: '$user', at: { $min: expression } } },
      ])
      return rows.map((row: any) => [String(row._id), { [field]: row.at }])
    }

    const [devices, apiKeys, sms, paid] = await Promise.all([
      firstBy(this.deviceModel, {}, 'firstDeviceAt'),
      firstBy(this.apiKeyModel, {}, 'firstApiKeyAt'),
      firstBy(this.smsModel, {}, 'firstSmsAt'),
      // The provider's start date where it reported one, else when we recorded
      // the row, taken across every paid subscription rather than off whichever
      // was recorded first: the two orderings can disagree.
      firstBy(this.subscriptionModel, { amount: { $gt: 0 } }, 'firstPaidAt', {
        $ifNull: ['$subscriptionStartDate', '$createdAt'],
      }),
    ])

    const byId = new Map<string, Record<string, Date | undefined>>()
    for (const group of [devices, apiKeys, sms, paid]) {
      for (const [id, entry] of group as Array<
        [string, Record<string, Date | undefined>]
      >) {
        byId.set(id, { ...(byId.get(id) ?? {}), ...entry })
      }
    }
    return byId
  }

  /** How many accounts have never had a rollup computed. */
  async countMissing(): Promise<number> {
    return this.userModel.countDocuments({
      'rollup.computedAt': { $exists: false },
    })
  }
}
