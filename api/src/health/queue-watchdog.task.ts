import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Job, Queue } from 'bull'
import { MonitoredJob, pingJob } from '../common/job-monitor'
import { findQueueProblems, QueueSnapshot } from './queue-health'

/**
 * Every minute, reports the queues as healthy only when no job is stuck
 * active and nothing has waited too long. A stalled worker then shows up as
 * a missed ping within minutes instead of as customer emails hours later.
 */
@Injectable()
export class QueueWatchdogTask {
  private readonly logger = new Logger(QueueWatchdogTask.name)

  constructor(
    @InjectQueue('sms') private readonly smsQueue: Queue,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
    @InjectQueue('billing-notifications') private readonly billingQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    let problems: string[]
    try {
      const snapshots = await Promise.all(
        [this.smsQueue, this.webhookQueue, this.billingQueue].map((queue) =>
          this.snapshot(queue),
        ),
      )
      problems = findQueueProblems(snapshots, Date.now())
    } catch (error) {
      // Redis unreachable counts as unhealthy: no ping, so the alert fires.
      this.logger.error(`Queue watchdog could not read queues: ${error?.message ?? error}`)
      return
    }

    if (problems.length > 0) {
      this.logger.warn(`Queue watchdog: ${problems.join('; ')}`)
      return
    }

    pingJob(MonitoredJob.queueWatchdog)
  }

  private async snapshot(queue: Queue): Promise<QueueSnapshot> {
    const [active, waiting] = await Promise.all([
      queue.getActive(),
      queue.getWaiting(0, 0),
    ])
    return {
      name: queue.name,
      activeStartedAt: active
        .map((job: Job) => job.processedOn)
        .filter((at): at is number => typeof at === 'number'),
      oldestWaitingReadyAt: waiting[0] ? readyAt(waiting[0]) : null,
    }
  }
}

/** When a waiting job became eligible to run: its add time plus any delay. */
function readyAt(job: Job): number {
  return job.timestamp + (job.opts?.delay ?? 0)
}
