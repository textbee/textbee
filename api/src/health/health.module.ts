import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { QueueWatchdogTask } from './queue-watchdog.task'

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'sms' },
      { name: 'webhook-delivery' },
      { name: 'billing-notifications' },
    ),
  ],
  controllers: [HealthController],
  providers: [HealthService, QueueWatchdogTask],
})
export class HealthModule {}
