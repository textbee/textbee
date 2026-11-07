import { Injectable, Logger } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { ModuleRef } from '@nestjs/core'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Job, Queue } from 'bull'
import { MonitoredJob, pingJob } from '../common/job-monitor'
import { withTimeout } from './health.service'
import { findQueueProblems, QueueSnapshot } from './queue-health'

const WATCHED_QUEUES = ['sms', 'webhook-delivery', 'billing-notifications']

/**
 * Every minute, reports the queues as healthy only when no job is stuck
 * active and nothing has waited too long. A stalled worker then shows up as
 * a missed ping within minutes.
 */
@Injectable()
export class QueueWatchdogTask {
  private readonly logger = new Logger(QueueWatchdogTask.name)

  constructor(private readonly moduleRef: ModuleRef) {}

  @Cron(CronExpression.EVERY_MINUTE, { waitForCompletion: true })
  async run() {
    let problems: string[]
    try {
      const snapshots = await withTimeout(
        Promise.all(WATCHED_QUEUES.map((name) => this.snapshot(this.queue(name)))),
        'queue watchdog',
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

  private queue(name: string): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false })
  }

  private async snapshot(queue: Queue): Promise<QueueSnapshot> {
    const [active, waiting] = await Promise.all([
      queue.getActive(),
      queue.getWaiting(0, 0),
    ])
    // A job can vanish between the id read and the hash read; skip those.
    const present = (jobs: Array<Job | null>) => jobs.filter((job): job is Job => !!job)
    const oldestWaiting = present(waiting)[0]
    return {
      name: queue.name,
      activeStartedAt: present(active)
        .map((job) => job.processedOn)
        .filter((at): at is number => typeof at === 'number'),
      oldestWaitingReadyAt: oldestWaiting ? readyAt(oldestWaiting) : null,
    }
  }
}

/** When a waiting job became eligible to run: its add time plus any delay. */
function readyAt(job: Job): number {
  return job.timestamp + (job.opts?.delay ?? 0)
}
