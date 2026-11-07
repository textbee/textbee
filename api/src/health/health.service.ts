import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { InjectConnection } from '@nestjs/mongoose'
import { Queue } from 'bull'
import { Connection } from 'mongoose'

const PROBE_TIMEOUT_MS = 5_000

export type DependencyState = 'ok' | 'error'

export interface HealthResult {
  status: 'ok' | 'error'
  mongo: DependencyState
  redis: DependencyState
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} probe timed out`)), PROBE_TIMEOUT_MS),
    ),
  ])
}

@Injectable()
export class HealthService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue('sms') private readonly smsQueue: Queue,
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
      await withTimeout(this.smsQueue.client.ping(), 'redis')
      return 'ok'
    } catch {
      return 'error'
    }
  }
}
