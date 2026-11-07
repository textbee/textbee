import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { Response } from 'express'
import { HealthService } from './health.service'

/** Liveness and dependency probe for uptime monitors. No auth, no rate limit. */
@ApiExcludeController()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response) {
    const result = await this.health.check()
    res
      .status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(result)
  }
}
