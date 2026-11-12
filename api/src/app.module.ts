import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { GatewayModule } from './gateway/gateway.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ThrottlerModule } from '@nestjs/throttler'
import { APP_GUARD } from '@nestjs/core/constants'
import { WebhookModule } from './webhook/webhook.module'
import {
  IP_THROTTLE_LIMIT,
  IP_THROTTLE_TTL_MS,
  ThrottlerByIpGuard,
} from './auth/guards/throttle-by-ip.guard'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { Request, Response, NextFunction } from 'express'
import { ScheduleModule } from '@nestjs/schedule'
import { BillingModule } from './billing/billing.module'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { BullModule } from '@nestjs/bull'
import { SupportModule } from './support/support.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { NotificationsModule } from './notifications/notifications.module'
import { EventEmitterModule } from '@nestjs/event-emitter'
import { HealthModule } from './health/health.module'

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (next) {
      next()
    }
  }
}

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGO_URI),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([
      {
        ttl: IP_THROTTLE_TTL_MS,
        limit: IP_THROTTLE_LIMIT,
      },
    ]),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        return {
          redis: configService.get('REDIS_URL'),
        }
      },
    }),
    AuthModule,
    UsersModule,
    GatewayModule,
    WebhookModule,
    BillingModule,
    SupportModule,
    AnalyticsModule,
    NotificationsModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerByIpGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL })
  }
}
