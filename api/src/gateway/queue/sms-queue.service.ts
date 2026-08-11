import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { ConfigService } from '@nestjs/config'
import { Message } from 'firebase-admin/messaging'
import { getBool, getNumber } from '../../common/config-coerce'

@Injectable()
export class SmsQueueService {
  private readonly logger = new Logger(SmsQueueService.name)
  private readonly useSmsQueue: boolean
  private readonly maxSmsBatchSize: number
  private readonly immediateQueueDelayMs: number

  constructor(
    @InjectQueue('sms') private readonly smsQueue: Queue,
    private readonly configService: ConfigService,
  ) {
    this.useSmsQueue = getBool(this.configService, 'USE_SMS_QUEUE', false)
    this.maxSmsBatchSize = getNumber(
      this.configService,
      'MAX_SMS_BATCH_SIZE',
      100,
    )
    this.immediateQueueDelayMs = getNumber(
      this.configService,
      'SMS_QUEUE_IMMEDIATE_DELAY_MS',
      0,
    )
  }

  /**
   * Check if queue is enabled based on environment variable
   */
  isQueueEnabled(): boolean {
    return this.useSmsQueue
  }

  async addSendSmsJob(
    deviceId: string,
    fcmMessages: Message[],
    smsBatchId: string,
    delayMs?: number,
  ) {
    // this.logger.debug(`Adding send-sms job for batch ${smsBatchId}`)

    // Split messages into batches of max smsBatchSize messages
    const batches = []
    for (let i = 0; i < fcmMessages.length; i += this.maxSmsBatchSize) {
      batches.push(fcmMessages.slice(i, i + this.maxSmsBatchSize))
    }

    // If delayMs is provided, use it for all batches (scheduled send)
    // Otherwise rely on queue limiter/concurrency and optionally fixed jitter.
    const useScheduledDelay = delayMs !== undefined && delayMs >= 0

    for (const batch of batches) {
      const delay = useScheduledDelay ? delayMs : this.immediateQueueDelayMs
      await this.smsQueue.add(
        'send-sms',
        {
          deviceId,
          fcmMessages: batch,
          smsBatchId,
        },
        {
          priority: 1, // TODO: Make this dynamic based on users subscription plan
          attempts: 1,
          delay: delay,
          backoff: {
            type: 'exponential',
            delay: 5000, // 5 seconds
          },
          removeOnComplete: { age: 24 * 3600 }, // 24 hours
          removeOnFail: { age: 72 * 3600 }, // 72 hours
        },
      )
    }
  }
}
