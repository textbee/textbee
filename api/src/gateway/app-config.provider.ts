import { FactoryProvider, Logger, OnModuleDestroy } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { AppConfig, AppConfigDocument } from './schemas/app-config.schema'
import { droppedPlatformKeys, setPlatformValues } from './app-settings'

export const APP_CONFIG_ID = 'android'
export const APP_CONFIG_REFRESH_MS = 60_000
export const APP_CONFIG_RETRY_MS = 5_000
export const APP_CONFIG_READ_TIMEOUT_MS = 5_000

// Keeps the platform document in memory, so settings resolve without a database read
export class AppConfigProvider implements OnModuleDestroy {
  private readonly logger = new Logger(AppConfigProvider.name)
  private timer?: NodeJS.Timeout
  private refreshing = false
  private loaded = false
  private stopped = false
  private lastSnapshot?: string

  constructor(private appConfigModel: Model<AppConfigDocument>) {}

  // First read, then the refresh loop: every 5 seconds until a read works, then every 60
  async start(): Promise<void> {
    await this.refresh()
    this.scheduleNext()
  }

  onModuleDestroy() {
    this.stopped = true
    clearTimeout(this.timer)
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const values = await this.readValues()
      this.warnOnChange(values)
      setPlatformValues(values)
      this.loaded = true
    } catch (error) {
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

  private async readValues(): Promise<unknown> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`read timed out after ${APP_CONFIG_READ_TIMEOUT_MS} ms`),
          ),
        APP_CONFIG_READ_TIMEOUT_MS,
      )
    })
    try {
      const doc = await Promise.race([
        this.appConfigModel
          .findById(APP_CONFIG_ID)
          .select({ values: 1 })
          .maxTimeMS(APP_CONFIG_READ_TIMEOUT_MS)
          .lean<{ values?: unknown } | null>(),
        timeout,
      ])
      return doc?.values
    } finally {
      clearTimeout(timer)
    }
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
