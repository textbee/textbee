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

// The limits in force; tests lower them to stay fast
export const deviceRouteLimits = {
  perDevice: DEVICE_ROUTE_LIMIT,
  perIp: DEVICE_ROUTE_IP_LIMIT,
  perIpWhenOff: IP_THROTTLE_LIMIT,
}

export function deviceRouteThrottleEnabled(): boolean {
  return resolveSetting('deviceRouteThrottleEnabled') as boolean
}

export const deviceRouteIpLimit = (): number =>
  deviceRouteThrottleEnabled()
    ? deviceRouteLimits.perIp
    : deviceRouteLimits.perIpWhenOff

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
    const rawId = http.getRequest()?.params?.id
    // Only a device route has an id to count; anything else is not this guard's
    if (!Types.ObjectId.isValid(rawId)) return true
    // One device gets one key in any form of its id
    const id = new Types.ObjectId(rawId).toHexString()
    const key = `device:${context.getClass().name}:${context.getHandler().name}:${id}`
    const limit = deviceRouteLimits.perDevice
    const { totalHits, timeToExpire, isBlocked, timeToBlockExpire } =
      await this.storage.increment(
        key,
        DEVICE_ROUTE_TTL_MS,
        limit,
        DEVICE_ROUTE_TTL_MS,
        THROTTLER_NAME,
      )

    if (isBlocked) {
      setHeader(res, 'Retry-After', timeToBlockExpire)
      throw new ThrottlerException()
    }
    setHeader(res, 'X-RateLimit-Limit-device', limit)
    setHeader(
      res,
      'X-RateLimit-Remaining-device',
      Math.max(0, limit - totalHits),
    )
    setHeader(res, 'X-RateLimit-Reset-device', timeToExpire)
    return true
  }
}

function setHeader(res: any, name: string, value: number) {
  if (typeof res?.header === 'function') res.header(name, value)
  else if (typeof res?.setHeader === 'function') res.setHeader(name, value)
}
