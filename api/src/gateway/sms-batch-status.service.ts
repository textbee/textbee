import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { SMS } from './schemas/sms.schema'
import { SMSBatch } from './schemas/sms-batch.schema'
import { countMessageStatuses, summarizeBatch } from './batch-summary'

// Batches above this size are recalculated at most once per window
export const LARGE_BATCH_THRESHOLD = 50
export const LARGE_BATCH_REFRESH_MS = 10_000

const STALE_PROCESSING_MS = 10 * 60 * 1000
const STALE_PROCESSING_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const STALE_PROCESSING_LIMIT = 200

type BatchState = {
  _id: Types.ObjectId
  recipientCount?: number
  status?: string
  completedAt?: Date
}

function toObjectId(id: unknown): Types.ObjectId | null {
  const raw = (id as { _id?: unknown })?._id ?? id
  if (raw instanceof Types.ObjectId) return raw
  const text = raw == null ? '' : String(raw)
  return Types.ObjectId.isValid(text) ? new Types.ObjectId(text) : null
}

@Injectable()
export class SmsBatchStatusService implements OnModuleDestroy {
  private readonly logger = new Logger(SmsBatchStatusService.name)
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
  ) {}

  onModuleDestroy() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  // Call after any message status change. Never throws.
  async refresh(batchIds: unknown[]): Promise<void> {
    try {
      const ids = this.uniqueIds(batchIds).filter(
        (id) => !this.timers.has(id.toHexString()),
      )
      if (ids.length === 0) return

      const batches = await this.loadBatches(ids)
      const now: BatchState[] = []
      for (const batch of batches) {
        if ((batch.recipientCount ?? 0) > LARGE_BATCH_THRESHOLD) {
          this.schedule(batch._id)
        } else {
          now.push(batch)
        }
      }
      await this.write(now)
    } catch (error) {
      this.logger.warn(`Batch refresh failed: ${error?.message}`)
    }
  }

  // Recalculates status and counters from the batches' messages
  async recompute(batchIds: Types.ObjectId[]): Promise<void> {
    await this.write(await this.loadBatches(batchIds))
  }

  // Catches batches whose last refresh was lost, e.g. to a restart
  async recomputeStaleProcessing(now = new Date()): Promise<number> {
    const stale = await this.smsBatchModel
      .find({
        status: 'processing',
        createdAt: { $gte: new Date(now.getTime() - STALE_PROCESSING_LOOKBACK_MS) },
        $or: [
          { statusCheckedAt: { $exists: false } },
          { statusCheckedAt: { $lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
        ],
      } as any)
      .select({ _id: 1 })
      .limit(STALE_PROCESSING_LIMIT)
      .lean()
    if (stale.length > 0) {
      await this.recompute(stale.map((batch) => batch._id as Types.ObjectId))
    }
    return stale.length
  }

  private uniqueIds(batchIds: unknown[]): Types.ObjectId[] {
    const unique = new Map<string, Types.ObjectId>()
    for (const id of batchIds) {
      const objectId = toObjectId(id)
      if (objectId) unique.set(objectId.toHexString(), objectId)
    }
    return [...unique.values()]
  }

  private async loadBatches(ids: Types.ObjectId[]): Promise<BatchState[]> {
    if (ids.length === 0) return []
    return this.smsBatchModel
      .find({ _id: { $in: ids } })
      .select({ recipientCount: 1, status: 1, completedAt: 1 })
      .lean<BatchState[]>()
  }

  // One aggregate and one bulk write for any number of batches
  private async write(batches: BatchState[]): Promise<void> {
    if (batches.length === 0) return
    const checkedAt = new Date()
    const rows = await this.smsModel
      .aggregate<{ _id: { batch: Types.ObjectId; status: string | null }; n: number }>([
        { $match: { smsBatch: { $in: batches.map((batch) => batch._id) } } },
        {
          $group: {
            _id: { batch: '$smsBatch', status: '$status' },
            n: { $sum: 1 },
          },
        },
      ])
      .read('primary')

    const byBatch = new Map<string, Array<{ _id: string | null; n: number }>>()
    for (const row of rows) {
      const key = String(row._id.batch)
      if (!byBatch.has(key)) byBatch.set(key, [])
      byBatch.get(key)!.push({ _id: row._id.status, n: row.n })
    }

    const writes = batches.map((batch) => ({
      updateOne: {
        // A slower pass that read older data must not overwrite a newer one
        filter: {
          _id: batch._id,
          $or: [
            { statusCheckedAt: { $exists: false } },
            { statusCheckedAt: { $lte: checkedAt } },
          ],
        },
        update: this.updateFor(batch, byBatch.get(String(batch._id)) ?? [], checkedAt),
      },
    }))
    await this.smsBatchModel.bulkWrite(writes as any, { ordered: false })
  }

  private updateFor(
    batch: BatchState,
    rows: Array<{ _id: string | null; n: number }>,
    checkedAt: Date,
  ): Record<string, any> {
    const { total, status, ...counts } = summarizeBatch(countMessageStatuses(rows))

    // A batch left with no messages cannot finish, so it stops waiting
    if (total === 0) {
      return batch.status === 'processing'
        ? { $set: { status: 'unknown', statusCheckedAt: checkedAt } }
        : { $set: { statusCheckedAt: checkedAt } }
    }

    if (status === 'processing') {
      return {
        $set: { status, ...counts, statusCheckedAt: checkedAt },
        $unset: { completedAt: 1 },
      }
    }
    // Keeps the time the batch first reached this status
    const completedAt =
      batch.status === status && batch.completedAt ? batch.completedAt : checkedAt
    return { $set: { status, ...counts, statusCheckedAt: checkedAt, completedAt } }
  }

  private schedule(batchId: Types.ObjectId) {
    const key = batchId.toHexString()
    if (this.timers.has(key)) return
    const timer = setTimeout(() => {
      this.timers.delete(key)
      this.recompute([batchId]).catch((error) =>
        this.logger.warn(`Batch ${key} recompute failed: ${error?.message}`),
      )
    }, LARGE_BATCH_REFRESH_MS)
    timer.unref?.()
    this.timers.set(key, timer)
  }
}
