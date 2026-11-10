import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Job, Queue } from 'bull'
import { ConfigService } from '@nestjs/config'
import { Message } from 'firebase-admin/messaging'
import {
  DEFAULT_BULK_DISPATCH_MAX_SPREAD_HOURS,
  DEFAULT_BULK_DISPATCH_WINDOW,
  DispatchPlan,
  isDispatchPacingEnabled,
  planDispatchWaves,
} from './dispatch-pacing'
import { SEND_JOB_TIMEOUT_MS } from './send-timeout'

@Injectable()
export class SmsQueueService {
  private readonly logger = new Logger(SmsQueueService.name)
  private readonly useSmsQueue: boolean
  private readonly maxSmsBatchSize: number
  private readonly immediateQueueDelayMs: number
  private readonly bulkDispatchWindow: number
  private readonly bulkDispatchMaxSpreadMs: number

  constructor(
    @InjectQueue('sms') private readonly smsQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.useSmsQueue = this.configService.get<boolean>('USE_SMS_QUEUE', false)
    this.maxSmsBatchSize = this.configService.get<number>(
      'MAX_SMS_BATCH_SIZE',
      100,
    )
    this.immediateQueueDelayMs = this.configService.get<number>(
      'SMS_QUEUE_IMMEDIATE_DELAY_MS',
      0,
    )
    this.bulkDispatchWindow = Number(
      this.configService.get<number>(
        'BULK_DISPATCH_WINDOW',
        DEFAULT_BULK_DISPATCH_WINDOW,
      ),
    )
    this.bulkDispatchMaxSpreadMs =
      Number(
        this.configService.get<number>(
          'BULK_DISPATCH_MAX_SPREAD_HOURS',
          DEFAULT_BULK_DISPATCH_MAX_SPREAD_HOURS,
        ),
      ) *
      3600 *
      1000
  }

  /**
   * Check if queue is enabled based on environment variable
   */
  isQueueEnabled(): boolean {
    return this.useSmsQueue
  }

  // If delayMs is provided, use it as the base for all waves (scheduled send)
  // Otherwise rely on queue limiter/concurrency and optionally fixed jitter.
  private resolveBaseDelayMs(delayMs?: number): number {
    return delayMs !== undefined && delayMs >= 0
      ? delayMs
      : this.immediateQueueDelayMs
  }

  // Messages released to the device at once
  dispatchWaveSize(): number {
    return Math.min(this.maxSmsBatchSize, this.bulkDispatchWindow)
  }

  /**
   * Plan how a batch will be released: large batches go out in waves paced
   * to the device's send delay. pacingDelayMs holds an immediate batch behind
   * the device's backlog; scheduled batches pass 0. Pure, so callers can
   * persist the plan before any job exists.
   */
  planSendSmsJob(
    messageCount: number,
    delayMs?: number,
    sendDelaySeconds?: number,
    pacingDelayMs = 0,
  ): DispatchPlan {
    return planDispatchWaves(messageCount, {
      waveSize: this.dispatchWaveSize(),
      sendDelaySeconds,
      baseDelayMs: this.resolveBaseDelayMs(delayMs) + Math.max(0, pacingDelayMs),
    })
  }

  /**
   * Remove jobs that were added but must not run. Jobs already picked up by
   * a worker cannot be removed; those are left alone.
   */
  async removeJobs(jobs: Job[]): Promise<void> {
    await Promise.allSettled(jobs.map((job) => job.remove()))
  }

  /**
   * Enqueue pushes for one batch, one job per wave of the plan. Returns the
   * added jobs so a caller can roll them back if a later step fails. If a
   * wave fails to enqueue, the waves already added are removed first.
   */
  async addSendSmsJob(
    deviceId: string,
    fcmMessages: Message[],
    smsBatchId: string,
    delayMs?: number,
    sendDelaySeconds?: number,
    plan: DispatchPlan = this.planSendSmsJob(
      fcmMessages.length,
      delayMs,
      sendDelaySeconds,
    ),
  ): Promise<Job[]> {
    // Time from the first wave to the end, so a backlog wait does not count
    const firstWaveMs = plan.waves[0]?.delayMs ?? this.resolveBaseDelayMs(delayMs)
    const pacedDurationMs = plan.projectedCompletionMs - firstWaveMs
    if (pacedDurationMs > this.bulkDispatchMaxSpreadMs) {
      this.logger.warn(
        `Batch ${smsBatchId}: ${fcmMessages.length} messages at ${plan.sendDelaySeconds}s/message are projected to take ${Math.round(pacedDurationMs / 3600000)}h to dispatch`,
      )
    }

    const inDeviceBacklog = delayMs === undefined && isDispatchPacingEnabled()
    const added: Job[] = []
    try {
      for (const wave of plan.waves) {
        const job = await this.smsQueue.add(
          'send-sms',
          {
            deviceId,
            fcmMessages: fcmMessages.slice(wave.start, wave.end),
            smsBatchId,
            // Immediate sends count toward the device backlog
            ...(inDeviceBacklog && { inDeviceBacklog: true }),
          },
          {
            priority: 1, // TODO: Make this dynamic based on users subscription plan
            attempts: 1,
            delay: wave.delayMs,
            timeout: SEND_JOB_TIMEOUT_MS,
            backoff: {
              type: 'exponential',
              delay: 5000, // 5 seconds
            },
            removeOnComplete: { age: 24 * 3600 }, // 24 hours
            removeOnFail: { age: 72 * 3600 }, // 72 hours
          },
        )
        added.push(job)
      }
    } catch (error) {
      await this.removeJobs(added)
      throw error
    }

    return added
  }
}
