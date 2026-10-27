import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { BillingModule } from '../billing/billing.module'
import { Plan, PlanSchema } from '../billing/schemas/plan.schema'
import {
  Subscription,
  SubscriptionSchema,
} from '../billing/schemas/subscription.schema'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import { UsersModule } from '../users/users.module'
import { NotificationContextLoader } from './context-loader'
import { NotificationMetricsService } from './notification-metrics.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import {
  DashboardNotification,
  DashboardNotificationSchema,
} from './schemas/dashboard-notification.schema'
import {
  NotificationDailyStats,
  NotificationDailyStatsSchema,
} from './schemas/notification-daily-stats.schema'
import {
  NotificationSettings,
  NotificationSettingsSchema,
} from './schemas/notification-settings.schema'
import {
  NotificationState,
  NotificationStateSchema,
} from './schemas/notification-state.schema'
import { NotificationHealthTask } from './tasks/notification-health.task'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DashboardNotification.name, schema: DashboardNotificationSchema },
      { name: NotificationState.name, schema: NotificationStateSchema },
      { name: NotificationSettings.name, schema: NotificationSettingsSchema },
      // Written only by the metrics flush, on a timer rather than per request.
      {
        name: NotificationDailyStats.name,
        schema: NotificationDailyStatsSchema,
      },
      // Read to resolve plan, usage and sending attributes.
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: SMS.name, schema: SMSSchema },
      { name: Device.name, schema: DeviceSchema },
    ]),
    UsersModule,
    AuthModule,
    BillingModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationContextLoader,
    NotificationMetricsService,
    NotificationHealthTask,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
