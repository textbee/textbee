import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Device, DeviceSchema } from './schemas/device.schema'
import { DeviceTombstone, DeviceTombstoneSchema } from './schemas/device-tombstone.schema'
import { GatewayController } from './gateway.controller'
import { GatewayService } from './gateway.service'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { SMS, SMSSchema } from './schemas/sms.schema'
import { SMSBatch, SMSBatchSchema } from './schemas/sms-batch.schema'
import { WebhookModule } from 'src/webhook/webhook.module'
import { BillingModule } from 'src/billing/billing.module'
import { BullModule } from '@nestjs/bull'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { SmsQueueService } from './queue/sms-queue.service'
import { SmsQueueProcessor } from './queue/sms-queue.processor'
import { SmsStatusUpdateTask } from './tasks/sms-status-update.task'
import { getNumber } from '../common/config-coerce'
import { HeartbeatCheckTask } from './tasks/heartbeat-check.task'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Device.name,
        schema: DeviceSchema,
      },
      {
        name: DeviceTombstone.name,
        schema: DeviceTombstoneSchema,
      },
      {
        name: SMS.name,
        schema: SMSSchema,
      },
      {
        name: SMSBatch.name,
        schema: SMSBatchSchema,
      },
    ]),
    BullModule.registerQueueAsync({
      name: 'sms',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        limiter: {
          max: getNumber(configService, 'SMS_QUEUE_LIMITER_MAX', 20),
          duration: getNumber(configService, 'SMS_QUEUE_LIMITER_DURATION_MS', 1000),
        },
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: { age: 24 * 3600 }, // 24 hours
          removeOnFail: { age: 72 * 3600 }, // 72 hours
        },
      }),
    }),
    AuthModule,
    UsersModule,
    WebhookModule,
    forwardRef(() => BillingModule),
    ConfigModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService, SmsQueueService, SmsQueueProcessor, SmsStatusUpdateTask, HeartbeatCheckTask],
  exports: [MongooseModule, GatewayService, SmsQueueService],
})
export class GatewayModule {}
