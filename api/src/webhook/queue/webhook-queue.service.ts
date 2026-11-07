import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name)

  constructor(
    @InjectQueue('webhook-delivery')
    private readonly webhookQueue: Queue,
  ) {}

  async addWebhookDeliveryJob(notificationId: string) {
    // this.logger.debug(`Adding webhook delivery job for notification ${notificationId}`)

    // job options come from the queue defaults in webhook.module.ts
    await this.webhookQueue.add('deliver-webhook', { notificationId })
  }
}
