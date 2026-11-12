import { Logger } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import {
  APP_CONFIG_ID,
  APP_CONFIG_READ_TIMEOUT_MS,
  APP_CONFIG_REFRESH_MS,
  APP_CONFIG_RETRY_MS,
  APP_CONFIG_STALLED_READ_MS,
  APP_CONFIG_WRITE_TIMEOUT_MS,
  AppConfigProvider,
  appConfigProviderFactory,
} from './app-config.provider'
import {
  APP_SETTINGS,
  SETTING_KEYS,
  resolveSetting,
  setPlatformValues,
} from './app-settings'
import { deviceConfigFor } from './device-config'
import { AppConfig } from './schemas/app-config.schema'

describe('AppConfigProvider', () => {
  const env = { ...process.env }
  let read: jest.Mock
  let maxTimeMS: jest.Mock
  let write: jest.Mock
  let model: { findById: jest.Mock; updateOne: jest.Mock }
  let provider: AppConfigProvider
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    delete process.env.PERIODIC_JOB_MINUTES
    delete process.env.PULL_ENABLED
    delete process.env.APP_CONFIG_ENV_SNAPSHOT_ENABLED
    setPlatformValues({})
    read = jest.fn().mockResolvedValue(null)
    maxTimeMS = jest.fn().mockImplementation(() => ({ lean: read }))
    model = {
      findById: jest
        .fn()
        .mockImplementation(() => ({ select: () => ({ maxTimeMS }) })),
      updateOne: jest
        .fn()
        .mockImplementation(() => ({ maxTimeMS: () => write() })),
    }
    write = jest.fn().mockResolvedValue({ acknowledged: true })
    provider = new AppConfigProvider(model as any)
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    provider.onModuleDestroy()
    jest.useRealTimers()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
    process.env = { ...env }
    setPlatformValues({})
  })

  it('loads the android document in an async factory, before any onModuleInit', async () => {
    read.mockResolvedValue({
      values: { periodicJobMinutes: 60, pullEnabled: true },
    })

    expect(appConfigProviderFactory.inject).toEqual([
      getModelToken(AppConfig.name),
    ])
    provider = await appConfigProviderFactory.useFactory(model)

    expect(provider).toBeInstanceOf(AppConfigProvider)
    expect(model.findById).toHaveBeenCalledWith(APP_CONFIG_ID)
    expect(maxTimeMS).toHaveBeenCalledWith(APP_CONFIG_READ_TIMEOUT_MS)
    expect(deviceConfigFor({}).periodicJobMinutes).toBe(60)
    expect(deviceConfigFor({}).pullEnabled).toBe(true)
  })

  it('falls back to the env and built-in values when the document is missing', async () => {
    process.env.PERIODIC_JOB_MINUTES = '45'
    read.mockResolvedValue(null)

    await provider.start()

    expect(resolveSetting('periodicJobMinutes')).toBe(45)
    expect(resolveSetting('pullEnabled')).toBe(false)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('ignores a document whose values are not an object', async () => {
    read.mockResolvedValue({ values: 'periodicJobMinutes=60' })

    await provider.start()

    expect(resolveSetting('periodicJobMinutes')).toBe(30)
  })

  it('starts on env values when the first read fails and retries after 5 seconds', async () => {
    process.env.PERIODIC_JOB_MINUTES = '45'
    read.mockRejectedValueOnce(new Error('connection refused'))

    await provider.start()

    expect(resolveSetting('periodicJobMinutes')).toBe(45)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    // Many requests, no extra reads or logs
    for (let i = 0; i < 100; i++) deviceConfigFor({})
    expect(model.findById).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)

    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 60 } })
    await jest.advanceTimersByTimeAsync(APP_CONFIG_RETRY_MS)
    expect(model.findById).toHaveBeenCalledTimes(2)
    expect(resolveSetting('periodicJobMinutes')).toBe(60)

    // After a good read the normal interval applies
    await jest.advanceTimersByTimeAsync(APP_CONFIG_RETRY_MS)
    expect(model.findById).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(
      APP_CONFIG_REFRESH_MS - APP_CONFIG_RETRY_MS,
    )
    expect(model.findById).toHaveBeenCalledTimes(3)
  })

  it('gives up on a read after 5 seconds and starts no new read for 60 seconds while it hangs', async () => {
    read.mockImplementationOnce(() => new Promise(() => undefined))

    const started = provider.start()
    await jest.advanceTimersByTimeAsync(APP_CONFIG_READ_TIMEOUT_MS)
    await started

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('timed out')
    expect(resolveSetting('periodicJobMinutes')).toBe(30)

    // Retry ticks keep coming every 5 seconds, but the stalled read blocks new ones
    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 90 } })
    const ticksInWindow =
      (APP_CONFIG_STALLED_READ_MS - APP_CONFIG_READ_TIMEOUT_MS) /
      APP_CONFIG_RETRY_MS
    for (let i = 0; i < ticksInWindow; i++) {
      await jest.advanceTimersByTimeAsync(APP_CONFIG_RETRY_MS)
      expect(model.findById).toHaveBeenCalledTimes(1)
    }
    expect(errorSpy).toHaveBeenCalledTimes(1)

    // Pending for more than 60 seconds: counted as lost, one new read starts
    await jest.advanceTimersByTimeAsync(APP_CONFIG_RETRY_MS)
    expect(model.findById).toHaveBeenCalledTimes(2)
    expect(resolveSetting('periodicJobMinutes')).toBe(90)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('ignores a late result from a timed-out read once a newer read started', async () => {
    let finishFirst: (value: unknown) => void = () => undefined
    read.mockImplementationOnce(
      () => new Promise((resolve) => (finishFirst = resolve)),
    )
    let finishSecond: (value: unknown) => void = () => undefined
    read.mockImplementationOnce(
      () => new Promise((resolve) => (finishSecond = resolve)),
    )

    const started = provider.start()
    await jest.advanceTimersByTimeAsync(APP_CONFIG_READ_TIMEOUT_MS)
    await started

    // The second read also times out, so both are late when they settle
    await jest.advanceTimersByTimeAsync(APP_CONFIG_STALLED_READ_MS)
    expect(model.findById).toHaveBeenCalledTimes(2)
    await jest.advanceTimersByTimeAsync(APP_CONFIG_READ_TIMEOUT_MS)
    expect(errorSpy).toHaveBeenCalledTimes(2)

    finishSecond({ values: { periodicJobMinutes: 90 } })
    await jest.advanceTimersByTimeAsync(0)
    expect(resolveSetting('periodicJobMinutes')).toBe(90)

    finishFirst({ values: { periodicJobMinutes: 60 } })
    await jest.advanceTimersByTimeAsync(0)
    expect(resolveSetting('periodicJobMinutes')).toBe(90)
  })

  it('uses a late result when it is the newest read', async () => {
    let finish: (value: unknown) => void = () => undefined
    read.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )

    const started = provider.start()
    await jest.advanceTimersByTimeAsync(APP_CONFIG_READ_TIMEOUT_MS)
    await started
    expect(resolveSetting('periodicJobMinutes')).toBe(30)

    finish({ values: { periodicJobMinutes: 75 } })
    await jest.advanceTimersByTimeAsync(0)
    expect(resolveSetting('periodicJobMinutes')).toBe(75)

    // The read settled, so the next tick reads again
    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)
    expect(model.findById).toHaveBeenCalledTimes(2)
  })

  it('keeps the last good values when a later read fails', async () => {
    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 60 } })
    await provider.start()

    read.mockRejectedValueOnce(new Error('timeout'))
    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)

    expect(model.findById).toHaveBeenCalledTimes(2)
    expect(resolveSetting('periodicJobMinutes')).toBe(60)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('reads only on the interval, never while configs are built between ticks', async () => {
    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 60 } })
    await provider.start()
    expect(model.findById).toHaveBeenCalledTimes(1)

    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 90 } })
    for (let i = 0; i < 10; i++) {
      await jest.advanceTimersByTimeAsync(5_999)
      expect(deviceConfigFor({}).periodicJobMinutes).toBe(60)
      expect(resolveSetting('carrierVerdictEnabled', {})).toBe(false)
    }
    expect(model.findById).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(10)
    expect(model.findById).toHaveBeenCalledTimes(2)
    expect(deviceConfigFor({}).periodicJobMinutes).toBe(90)
  })

  it('clears values removed from the document', async () => {
    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 60 } })
    await provider.start()

    read.mockResolvedValueOnce({ values: {} })
    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)

    expect(resolveSetting('periodicJobMinutes')).toBe(30)
  })

  it('stops reading after shutdown', async () => {
    await provider.start()
    provider.onModuleDestroy()

    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS * 3)

    expect(model.findById).toHaveBeenCalledTimes(1)
  })

  it('does not start a second read while one is running', async () => {
    await provider.start()
    let finish: (value: unknown) => void = () => undefined
    read.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )

    const first = provider.refresh()
    await provider.refresh()
    expect(model.findById).toHaveBeenCalledTimes(2)

    finish({ values: { periodicJobMinutes: 120 } })
    await first
    expect(resolveSetting('periodicJobMinutes')).toBe(120)
  })

  it('warns once about dropped keys, and again only when the document changes', async () => {
    const bad = {
      values: { periodicJobMinutes: 999, pullEnabled: true, oldKey: 1 },
    }
    read.mockResolvedValue(bad)
    await provider.start()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('periodicJobMinutes, oldKey')
    expect(resolveSetting('pullEnabled')).toBe(true)

    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS * 2)
    expect(model.findById).toHaveBeenCalledTimes(3)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    read.mockResolvedValue({ values: { latestVersionName: 'x'.repeat(33) } })
    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[1][0]).toContain('latestVersionName')

    read.mockResolvedValue({ values: { pullEnabled: false } })
    await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
  describe('env snapshot', () => {
    beforeEach(() => {
      for (const key of SETTING_KEYS) delete process.env[APP_SETTINGS[key].env]
    })

    it('writes each valid env value once at startup and leaves values alone', async () => {
      process.env.PERIODIC_JOB_MINUTES = ' 60 '
      process.env.PULL_ENABLED = 'true'
      process.env.APP_ANALYTICS_ENABLED = 'no'
      process.env.LATEST_APP_VERSION_NAME = ' 2.9.0 '
      process.env.MULTIPART_FAILURE_FINAL_ENABLED = '0'
      // Invalid or empty: left out
      process.env.LATEST_APP_VERSION_CODE = 'abc'
      process.env.DEVICE_LOG_MAX_ENTRIES = '100'
      process.env.CLAIM_MIN_GAP_SECONDS = '15.5'
      process.env.CARRIER_VERDICT_ENABLED = ''
      process.env.SENDING_MARKER_YOUNG_MINUTES = '   '

      await provider.start()
      await jest.advanceTimersByTimeAsync(0)

      expect(model.updateOne).toHaveBeenCalledTimes(1)
      const [filter, update, options] = model.updateOne.mock.calls[0]
      expect(filter).toEqual({ _id: APP_CONFIG_ID })
      expect(options).toEqual({ upsert: true })
      expect(Object.keys(update)).toEqual(['$set'])
      expect(Object.keys(update.$set)).toEqual(['env', 'envUpdatedAt'])
      expect(update.$set.env).toEqual({
        pullEnabled: true,
        periodicJobMinutes: 60,
        latestVersionName: '2.9.0',
        analyticsEnabled: false,
        multipartFailureFinalEnabled: false,
      })
      expect(update.$set.envUpdatedAt).toBeInstanceOf(Date)
      expect(errorSpy).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS * 3)
      expect(model.updateOne).toHaveBeenCalledTimes(1)
    })

    it('writes an empty object when no env var is set, so stale keys go', async () => {
      await provider.start()
      await jest.advanceTimersByTimeAsync(0)

      expect(model.updateOne.mock.calls[0][1].$set.env).toEqual({})
    })

    it('never reads the env snapshot back', async () => {
      read.mockResolvedValue({
        values: { pullEnabled: false },
        env: { periodicJobMinutes: 90, pullEnabled: true },
      })

      await provider.start()

      expect(resolveSetting('periodicJobMinutes')).toBe(30)
      expect(resolveSetting('pullEnabled')).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('logs a failed write once and keeps running', async () => {
      process.env.PERIODIC_JOB_MINUTES = '60'
      read.mockResolvedValue({ values: { pullEnabled: true } })
      write.mockRejectedValueOnce(new Error('not authorized'))

      await expect(provider.start()).resolves.toBeUndefined()
      await jest.advanceTimersByTimeAsync(0)

      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0][0]).toContain('not authorized')
      expect(resolveSetting('pullEnabled')).toBe(true)
      expect(resolveSetting('periodicJobMinutes')).toBe(60)
    })

    it('does not hold up startup on a write that never settles', async () => {
      write.mockImplementationOnce(() => new Promise(() => undefined))

      provider = await appConfigProviderFactory.useFactory(model)
      expect(model.updateOne).toHaveBeenCalledTimes(1)
      expect(errorSpy).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(APP_CONFIG_WRITE_TIMEOUT_MS)
      expect(errorSpy).toHaveBeenCalledTimes(1)
      expect(errorSpy.mock.calls[0][0]).toContain('write timed out')
    })

    it('writes nothing when the switch is off', async () => {
      process.env.APP_CONFIG_ENV_SNAPSHOT_ENABLED = 'false'
      process.env.PERIODIC_JOB_MINUTES = '60'

      await provider.start()
      await jest.advanceTimersByTimeAsync(APP_CONFIG_REFRESH_MS)

      expect(model.updateOne).not.toHaveBeenCalled()
      expect(resolveSetting('periodicJobMinutes')).toBe(60)
    })
  })
})
