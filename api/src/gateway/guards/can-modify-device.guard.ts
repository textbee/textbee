import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import mongoose from 'mongoose'
import { GatewayService } from '../gateway.service'
import { parseLinkHeaders } from '../../device-links/device-link-input'

@Injectable()
export class CanModifyDevice implements CanActivate {
  constructor(private gatewayService: GatewayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest()

    const deviceId = request.params.id
    const userId = request.user?.id

    const isValidId = mongoose.Types.ObjectId.isValid(deviceId)
    if (!isValidId) {
      throw new HttpException(
        { error: 'Invalid device id' },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Without a user id the scoped lookup would degrade to an unscoped one
    if (!userId) {
      throw new HttpException({ error: 'Unauthorized' }, HttpStatus.UNAUTHORIZED)
    }

    const device = await this.gatewayService.getDeviceById(
      deviceId,
      userId,
      '+ownerInstallId',
    )

    if (!device) {
      throw new HttpException(
        { error: 'Device not found' },
        HttpStatus.NOT_FOUND,
      )
    }

    this.gatewayService.recordOtherInstallCall(
      device,
      request,
      parseLinkHeaders(request.headers),
    )
    return true
  }
}
