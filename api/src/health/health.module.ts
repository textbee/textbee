import { Module } from '@nestjs/common'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { QueueWatchdogTask } from './queue-watchdog.task'

/**
 * Reads the queues the gateway, webhook and billing modules register. It
 * must not register them again: Nest Bull creates one Queue per
 * registration and binds the processors to the last one, which would drop
 * the sms queue's rate limiter.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService, QueueWatchdogTask],
})
export class HealthModule {}
