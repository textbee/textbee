import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { AuthModule } from '../auth/auth.module'
import { LoginSessionGuard } from '../auth/guards/login-session.guard'
import { ApiKey, ApiKeySchema } from '../auth/schemas/api-key.schema'
import { BillingModule } from '../billing/billing.module'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'
import { MailModule } from '../mail/mail.module'
import { UsersModule } from '../users/users.module'
import { DeviceLinksController } from './device-links.controller'
import { DeviceLinksService } from './device-links.service'
import { DeviceLink, DeviceLinkSchema } from './schemas/device-link.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeviceLink.name, schema: DeviceLinkSchema },
      { name: Device.name, schema: DeviceSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
    ]),
    AuthModule,
    UsersModule,
    forwardRef(() => BillingModule),
    MailModule,
  ],
  controllers: [DeviceLinksController],
  providers: [DeviceLinksService, LoginSessionGuard],
})
export class DeviceLinksModule {}
