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
    const unique = new Map<string, Types.ObjectId>()
    for (const id of batchIds) {
      const objectId = toObjectId(id)
      if (objectId) unique.set(objectId.toHexString(), objectId)
    }

    for (const [key, batchId] of unique) {
      try {
        if (this.timers.has(key)) continue
        const batch = await this.smsBatchModel
          .findById(batchId)
          .select({ recipientCount: 1 })
          .lean()
        if (!batch) continue
        if ((batch.recipientCount ?? 0) > LARGE_BATCH_THRESHOLD) {
          if (!this.timers.has(key)) this.schedule(key, batchId)
        } else {
          await this.recompute(batchId)
        }
      } catch (error) {
        this.logger.warn(`Batch ${key} refresh failed: ${error?.message}`)
      }
    }
  }

  // Recalculates status and counters from the batch's messages
  async recompute(batchId: Types.ObjectId): Promise<void> {
    const checkedAt = new Date()
    const rows = await this.smsModel
      .aggregate<{ _id: string | null; n: number }>([
        { $match: { smsBatch: batchId } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ])
      .read('primary')
    const summary = summarizeBatch(countMessageStatuses(rows))
    if (summary.total === 0) return

    const { total, status, ...counts } = summary
    const update =
      status === 'processing'
        ? { $set: { status, ...counts, statusCheckedAt: checkedAt }, $unset: { completedAt: 1 } }
        : { $set: { status, ...counts, statusCheckedAt: checkedAt, completedAt: checkedAt } }

    // A slower pass that read older data must not overwrite a newer one
    await this.smsBatchModel.updateOne(
      {
        _id: batchId,
        $or: [
          { statusCheckedAt: { $exists: false } },
          { statusCheckedAt: { $lte: checkedAt } },
        ],
      } as any,
      update,
    )
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
    for (const batch of stale) {
      try {
        await this.recompute(batch._id as Types.ObjectId)
      } catch (error) {
        this.logger.warn(`Batch ${batch._id} recompute failed: ${error?.message}`)
      }
    }
    return stale.length
  }

  private schedule(key: string, batchId: Types.ObjectId) {
    const timer = setTimeout(() => {
      this.timers.delete(key)
      this.recompute(batchId).catch((error) =>
        this.logger.warn(`Batch ${key} recompute failed: ${error?.message}`),
      )
    }, LARGE_BATCH_REFRESH_MS)
    timer.unref?.()
    this.timers.set(key, timer)
  }
}
