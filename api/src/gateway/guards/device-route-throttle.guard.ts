import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import {
  InjectThrottlerStorage,
  ThrottlerException,
  ThrottlerStorage,
} from '@nestjs/throttler'
import { Types } from 'mongoose'
import { IP_THROTTLE_LIMIT } from '../../auth/guards/throttle-by-ip.guard'
import { resolveSetting } from '../app-settings'

export const DEVICE_ROUTE_LIMIT = 600
export const DEVICE_ROUTE_TTL_MS = 60_000
// Per-IP limit of the device routes, for phones that share a carrier address
export const DEVICE_ROUTE_IP_LIMIT = 3000
const THROTTLER_NAME = 'device'

export function deviceRouteThrottleEnabled(): boolean {
  return resolveSetting('deviceRouteThrottleEnabled') as boolean
}

export const deviceRouteIpLimit = (): number =>
  deviceRouteThrottleEnabled() ? DEVICE_ROUTE_IP_LIMIT : IP_THROTTLE_LIMIT

// Goes after AuthGuard and CanModifyDevice, so only the owner spends the budget
@Injectable()
export class DeviceRouteThrottleGuard implements CanActivate {
  constructor(
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!deviceRouteThrottleEnabled()) return true

    const http = context.switchToHttp()
    const res = http.getResponse()
    // CanModifyDevice has checked the id; one device gets one key in any form
    const id = new Types.ObjectId(http.getRequest().params.id).toHexString()
    const key = `device:${context.getHandler().name}:${id}`
    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storage.increment(
        key,
        DEVICE_ROUTE_TTL_MS,
        DEVICE_ROUTE_LIMIT,
        DEVICE_ROUTE_TTL_MS,
        THROTTLER_NAME,
      )

    if (isBlocked) {
      setHeader(res, 'Retry-After', timeToBlockExpire)
      throw new ThrottlerException()
    }
    setHeader(res, 'X-RateLimit-Limit-device', DEVICE_ROUTE_LIMIT)
    setHeader(
      res,
      'X-RateLimit-Remaining-device',
      Math.max(0, DEVICE_ROUTE_LIMIT - totalHits),
    )
    setHeader(res, 'X-RateLimit-Reset-device', timeToExpire)
    return true
  }
}

function setHeader(res: any, name: string, value: number) {
  if (typeof res?.header === 'function') res.header(name, value)
  else if (typeof res?.setHeader === 'function') res.setHeader(name, value)
}
