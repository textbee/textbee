import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ApiKey, ApiKeySchema } from '../auth/schemas/api-key.schema'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import {
  Subscription,
  SubscriptionSchema,
} from '../billing/schemas/subscription.schema'
import { User, UserSchema } from './schemas/user.schema'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'
import { UserRollupService } from './user-rollup.service'
import { UserRollupTask } from './tasks/user-rollup.task'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      // Read-only here, so the rollup can be derived in one place rather than
      // in each app that needs the numbers. Schema registration only; this
      // module imports neither GatewayModule nor AuthModule.
      { name: Device.name, schema: DeviceSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      { name: SMS.name, schema: SMSSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [UsersController],
  providers: [UsersService, UserRollupService, UserRollupTask],
  exports: [MongooseModule, UsersService, UserRollupService],
})
export class UsersModule {}
