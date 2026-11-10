import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SMS } from '../schemas/sms.schema';
import { SMSBatch } from '../schemas/sms-batch.schema';
import { SmsBatchStatusService } from '../sms-batch-status.service';
import {
  STATUS_TIMEOUT_DISPATCHED_MESSAGE,
  STATUS_TIMEOUT_PENDING_MESSAGE,
} from '../error-history';
import { MonitoredJob, pingJob } from '../../common/job-monitor';

// Rows expired per round, and rounds per run
export const EXPIRE_CHUNK_SIZE = 5000;
const EXPIRE_MAX_ROUNDS = 20;

// A message whose push never went out, and a batch still pending
export const PENDING_TIMEOUT_MINUTES = 20;
const DEFAULT_DISPATCHED_TIMEOUT_MINUTES = 120;

// A pushed message may wait behind a long queue on the phone, so it gets
// longer before it turns unknown. Read on every run.
export function dispatchedTimeoutMinutes(): number {
  const parsed = Number.parseInt(process.env.SMS_DISPATCHED_TIMEOUT_MINUTES ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DISPATCHED_TIMEOUT_MINUTES;
  }
  return Math.max(PENDING_TIMEOUT_MINUTES, parsed);
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

@Injectable()
export class SmsStatusUpdateTask {
  private readonly logger = new Logger(SmsStatusUpdateTask.name);

  constructor(
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    private batchStatus: SmsBatchStatusService,
  ) {}

  /**
   * Cron job that runs every 5 minutes. It marks messages unknown when they
   * stay pending for 20 minutes, or dispatched for SMS_DISPATCHED_TIMEOUT_MINUTES
   * (default 120), with no status update. Pending batches expire after 20 minutes.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { waitForCompletion: true })
  async handlePendingSmsTimeout() {
    this.logger.log('Running cron job to update stale pending and dispatched SMS messages');

    const pendingCutoff = minutesAgo(PENDING_TIMEOUT_MINUTES);
    const dispatchedCutoff = minutesAgo(dispatchedTimeoutMinutes());

    try {
      const pendingCount = await this.expireMessages(
        {
          status: 'pending',
          requestedAt: { $lt: pendingCutoff },
          // Paced messages are not stale until their own wave was due
          $or: [
            { dispatchDueAt: { $exists: false } },
            { dispatchDueAt: { $lt: pendingCutoff } },
          ],
        },
        STATUS_TIMEOUT_PENDING_MESSAGE,
      );
      this.logger.log(
        `Updated ${pendingCount} SMS messages from 'pending' to 'unknown' status`,
      );

      const dispatchedCount = await this.expireMessages(
        {
          status: 'dispatched',
          dispatchedAt: { $lt: dispatchedCutoff },
        },
        STATUS_TIMEOUT_DISPATCHED_MESSAGE,
      );
      this.logger.log(
        `Updated ${dispatchedCount} SMS messages from 'dispatched' to 'unknown' status`,
      );

      const batchResult = await this.smsBatchModel.updateMany(
        {
          status: 'pending',
          createdAt: { $lt: pendingCutoff },
        },
        {
          $set: {
            status: 'unknown',
            error: STATUS_TIMEOUT_PENDING_MESSAGE,
          },
        },
      );
      this.logger.log(
        `Updated ${batchResult.modifiedCount} SMS batches from 'pending' to 'unknown' status`,
      );

      const retried = await this.batchStatus.retryFailed();
      const swept = await this.batchStatus.recomputeStaleProcessing();
      this.logger.log(
        `Retried ${retried} SMS batches and recalculated ${swept} still in 'processing'`,
      );
      pingJob(MonitoredJob.smsStatusSweep);
    } catch (error) {
      this.logger.error('Error updating stale pending SMS messages', error);
    }
  }

  // Marks matching messages unknown in chunks, then refreshes their batches
  private async expireMessages(
    filter: Record<string, any>,
    errorMessage: string,
  ): Promise<number> {
    let modified = 0;
    for (let round = 0; round < EXPIRE_MAX_ROUNDS; round++) {
      const rows = await this.smsModel
        .find(filter, { _id: 1, smsBatch: 1 })
        .limit(EXPIRE_CHUNK_SIZE)
        .lean();
      if (rows.length === 0) break;

      const result = await this.smsModel.updateMany(
        { ...filter, _id: { $in: rows.map((row) => row._id) } },
        // The note goes when a late report arrives; the time stays
        {
          $set: {
            status: 'unknown',
            errorMessage,
            'metadata.statusTimedOutAt': new Date(),
          },
        },
      );
      modified += result.modifiedCount;
      await this.batchStatus.refresh(rows.map((row) => row.smsBatch));

      if (rows.length < EXPIRE_CHUNK_SIZE) break;
    }
    return modified;
  }
}
