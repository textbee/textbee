import { FactoryProvider, Logger, OnModuleDestroy } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AppConfig, AppConfigDocument } from './schemas/app-config.schema'
import {
  droppedPlatformKeys,
  envBool,
  envSnapshot,
  setPlatformValues,
} from './app-settings'

export const APP_CONFIG_ID = 'android'
export const APP_CONFIG_REFRESH_MS = 60_000
export const APP_CONFIG_RETRY_MS = 5_000
export const APP_CONFIG_READ_TIMEOUT_MS = 5_000
export const APP_CONFIG_WRITE_TIMEOUT_MS = 5_000
// A read still pending after this long counts as lost, and one new read may start
export const APP_CONFIG_STALLED_READ_MS = 60_000

// Keeps the platform document in memory, so settings resolve without a database read
export class AppConfigProvider implements OnModuleDestroy {
  private readonly logger = new Logger(AppConfigProvider.name)
  private timer?: NodeJS.Timeout
  private refreshing = false
  private loaded = false
  private stopped = false
  private lastSnapshot?: string
  private readSeq = 0
  private pendingRead?: { id: number; startedAt: number }

  constructor(private appConfigModel: Model<AppConfigDocument>) {}

  // First read, then the refresh loop: every 5 seconds until a read works, then every 60
  async start(): Promise<void> {
    await this.refresh()
    this.scheduleNext()
    void this.writeEnvSnapshot()
  }

  // Never awaited by startup and never throws
  async writeEnvSnapshot(): Promise<void> {
    if (!envBool('APP_CONFIG_ENV_SNAPSHOT_ENABLED', true)) return
    try {
      await withTimeout(
        this.appConfigModel
          .updateOne(
            { _id: APP_CONFIG_ID },
            { $set: { env: envSnapshot(), envUpdatedAt: new Date() } },
            { upsert: true },
          )
          .maxTimeMS(APP_CONFIG_WRITE_TIMEOUT_MS),
        APP_CONFIG_WRITE_TIMEOUT_MS,
        'write',
      )
    } catch (error) {
      this.logger.error(
        `Could not write the env snapshot: ${error?.message ?? error}`,
      )
    }
  }

  onModuleDestroy() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return
    const now = Date.now()
    if (
      this.pendingRead &&
      now - this.pendingRead.startedAt <= APP_CONFIG_STALLED_READ_MS
    )
      return
    this.refreshing = true
    const id = ++this.readSeq
    this.pendingRead = { id, startedAt: now }
    let timedOut = false
    const read = Promise.resolve(this.readQuery()).then(
      (doc) => {
        this.settleRead(id)
        // A late result counts only when no newer read has started
        if (timedOut && id === this.readSeq) this.apply(doc?.values)
        return doc
      },
      (error) => {
        this.settleRead(id)
        throw error
      },
    )
    try {
      const doc = await withTimeout(read, APP_CONFIG_READ_TIMEOUT_MS, 'read')
      this.apply(doc?.values)
    } catch (error) {
      timedOut = true
      // Keeps the last values read; before a first good read, env and built-in values apply
      this.logger.error(
        `Could not read the app config: ${error?.message ?? error}`,
      )
    } finally {
      this.refreshing = false
    }
  }

  private scheduleNext() {
    if (this.stopped) return
    const delay = this.loaded ? APP_CONFIG_REFRESH_MS : APP_CONFIG_RETRY_MS
    this.timer = setTimeout(async () => {
      await this.refresh()
      this.scheduleNext()
    }, delay)
    this.timer.unref()
  }

  private readQuery() {
    return this.appConfigModel
      .findById(APP_CONFIG_ID)
      .select({ values: 1 })
      .maxTimeMS(APP_CONFIG_READ_TIMEOUT_MS)
      .lean<{ values?: unknown } | null>()
  }

  private settleRead(id: number) {
    if (this.pendingRead?.id === id) this.pendingRead = undefined
  }

  private apply(values: unknown) {
    this.warnOnChange(values)
    setPlatformValues(values)
    this.loaded = true
  }

  private warnOnChange(values: unknown) {
    const snapshot = JSON.stringify(values ?? null)
    if (snapshot === this.lastSnapshot) return
    this.lastSnapshot = snapshot
    const dropped = droppedPlatformKeys(values)
    if (dropped.length > 0) {
      this.logger.warn(
        `App config values ignored, unknown or invalid: ${dropped.join(', ')}`,
      )
    }
  }
}

async function withTimeout<T>(
  work: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms} ms`)),
      ms,
    )
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

// An async factory, so the first read ends before any module's onModuleInit runs
export const appConfigProviderFactory: FactoryProvider<AppConfigProvider> = {
  provide: AppConfigProvider,
  inject: [getModelToken(AppConfig.name)],
  useFactory: async (model: Model<AppConfigDocument>) => {
    const provider = new AppConfigProvider(model)
    await provider.start()
    return provider
  },
}
