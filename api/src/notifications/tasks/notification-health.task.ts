import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import { Model } from 'mongoose'
import { User, UserDocument } from '../../users/schemas/user.schema'
import { NotificationMetricsService } from '../notification-metrics.service'
import {
  NotificationState,
  NotificationStateDocument,
} from '../schemas/notification-state.schema'

// How much of the account base the targeting rules can judge at all. An
// attribute nobody has data for is "unknown" to the ranker, never false, so it
// silently shrinks every audience that reads it. Without these four numbers
// there is no way to see that happening.
//
// Note there is no distributed lock anywhere in this app: the existing crons
// rely on pm2 running a single instance in fork mode. A double run here writes
// the same four counts twice, so it wastes reads rather than corrupting
// anything.
@Injectable()
export class NotificationHealthTask {
  private readonly logger = new Logger(NotificationHealthTask.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(NotificationState.name)
    private readonly stateModel: Model<NotificationStateDocument>,
    private readonly metrics: NotificationMetricsService,
  ) {}

  // 04:50, half an hour after the rollup repair at 04:20 so it measures a
  // settled base, and clear of the 06:00 webhook sweep.
  @Cron('0 50 4 * * *')
  async recordCoverage() {
    const startedAt = Date.now()
    try {
      // Four queries a day. The state count is estimated from collection
      // metadata because it is the one that grows per account per record.
      const [accounts, rollupComputed, milestoneFirstSms, stateRows] =
        await Promise.all([
          this.userModel.countDocuments({}),
          this.userModel.countDocuments({
            'rollup.computedAt': { $exists: true, $ne: null },
          }),
          this.userModel.countDocuments({
            'milestones.firstSmsAt': { $exists: true, $ne: null },
          }),
          this.stateModel.estimatedDocumentCount(),
        ])

      await this.metrics.recordCoverage({
        accounts,
        rollupComputed,
        milestoneFirstSms,
        stateRows,
      })

      this.logger.log(
        `Notification coverage: ${rollupComputed}/${accounts} rolled up, ` +
          `${milestoneFirstSms}/${accounts} have sent, ${stateRows} state rows ` +
          `in ${Date.now() - startedAt}ms`,
      )
    } catch (error) {
      // Swallowed on purpose: a failed measurement must not take the process
      // down, and the next run repeats the whole job anyway.
      this.logger.error(
        `Notification coverage sweep failed: ${error?.message ?? error}`,
      )
    }
  }
}
