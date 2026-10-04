import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SMS } from '../schemas/sms.schema';
import { SMSBatch } from '../schemas/sms-batch.schema';
import { SmsBatchStatusService } from '../sms-batch-status.service';

// Rows expired per round, and rounds per run
export const EXPIRE_CHUNK_SIZE = 5000;
const EXPIRE_MAX_ROUNDS = 20;

@Injectable()
export class SmsStatusUpdateTask {
  private readonly logger = new Logger(SmsStatusUpdateTask.name);

  constructor(
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    private batchStatus: SmsBatchStatusService,
  ) {}

  /**
   * Cron job that runs every 5 minutes to update the status of SMS messages
   * that have been pending or dispatched for more than 20 minutes without any status updates.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { waitForCompletion: true })
  async handlePendingSmsTimeout() {
    this.logger.log('Running cron job to update stale pending and dispatched SMS messages');

    const twentyMinutesAgo = new Date();
    twentyMinutesAgo.setMinutes(twentyMinutesAgo.getMinutes() - 20);

    try {
      const pendingCount = await this.expireMessages(
        {
          status: 'pending',
          requestedAt: { $lt: twentyMinutesAgo },
          // Paced messages are not stale until their own wave was due
          $or: [
            { dispatchDueAt: { $exists: false } },
            { dispatchDueAt: { $lt: twentyMinutesAgo } },
          ],
        },
        'Status update timeout - no response received after 20 minutes',
      );
      this.logger.log(
        `Updated ${pendingCount} SMS messages from 'pending' to 'unknown' status`,
      );

      const dispatchedCount = await this.expireMessages(
        {
          status: 'dispatched',
          dispatchedAt: { $lt: twentyMinutesAgo },
        },
        'Status update timeout - no response from device after dispatch',
      );
      this.logger.log(
        `Updated ${dispatchedCount} SMS messages from 'dispatched' to 'unknown' status`,
      );

      const batchResult = await this.smsBatchModel.updateMany(
        {
          status: 'pending',
          createdAt: { $lt: twentyMinutesAgo },
        },
        {
          $set: {
            status: 'unknown',
            error:
              'Status update timeout - no response received after 20 minutes',
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
        { $set: { status: 'unknown', errorMessage } },
      );
      modified += result.modifiedCount;
      await this.batchStatus.refresh(rows.map((row) => row.smsBatch));

      if (rows.length < EXPIRE_CHUNK_SIZE) break;
    }
    return modified;
  }
}
