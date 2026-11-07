import { Injectable } from '@nestjs/common'
import { getQueueToken } from '@nestjs/bull'
import { ModuleRef } from '@nestjs/core'
import { InjectConnection } from '@nestjs/mongoose'
import { Queue } from 'bull'
import { Connection } from 'mongoose'

export const PROBE_TIMEOUT_MS = 5_000

export type DependencyState = 'ok' | 'error'

export interface HealthResult {
  status: 'ok' | 'error'
  mongo: DependencyState
  redis: DependencyState
}

export function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} probe timed out`)),
      PROBE_TIMEOUT_MS,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly moduleRef: ModuleRef,
  ) {}

  async check(): Promise<HealthResult> {
    const [mongo, redis] = await Promise.all([this.probeMongo(), this.probeRedis()])
    return {
      status: mongo === 'ok' && redis === 'ok' ? 'ok' : 'error',
      mongo,
      redis,
    }
  }

  private async probeMongo(): Promise<DependencyState> {
    try {
      await withTimeout(this.connection.db.admin().ping(), 'mongo')
      return 'ok'
    } catch {
      return 'error'
    }
  }

  private async probeRedis(): Promise<DependencyState> {
    try {
      // The sms queue's own connection, registered by the gateway module.
      const queue = this.moduleRef.get<Queue>(getQueueToken('sms'), { strict: false })
      await withTimeout(queue.client.ping(), 'redis')
      return 'ok'
    } catch {
      return 'error'
    }
  }
}
