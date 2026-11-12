import { Logger } from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import {
  APP_CONFIG_ID,
  APP_CONFIG_READ_TIMEOUT_MS,
  APP_CONFIG_REFRESH_MS,
  APP_CONFIG_RETRY_MS,
  AppConfigProvider,
  appConfigProviderFactory,
} from './app-config.provider'
import { resolveSetting, setPlatformValues } from './app-settings'
import { deviceConfigFor } from './device-config'
import { AppConfig } from './schemas/app-config.schema'

describe('AppConfigProvider', () => {
  const env = { ...process.env }
  let read: jest.Mock
  let maxTimeMS: jest.Mock
  let model: { findById: jest.Mock }
  let provider: AppConfigProvider
  let errorSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    delete process.env.PERIODIC_JOB_MINUTES
    delete process.env.PULL_ENABLED
    setPlatformValues({})
    read = jest.fn().mockResolvedValue(null)
    maxTimeMS = jest.fn().mockImplementation(() => ({ lean: read }))
    model = {
      findById: jest
        .fn()
        .mockImplementation(() => ({ select: () => ({ maxTimeMS }) })),
    }
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

  it('gives up on a read that never settles and reads again on the next tick', async () => {
    read.mockImplementationOnce(() => new Promise(() => undefined))

    const started = provider.start()
    await jest.advanceTimersByTimeAsync(APP_CONFIG_READ_TIMEOUT_MS)
    await started

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('timed out')
    expect(resolveSetting('periodicJobMinutes')).toBe(30)

    read.mockResolvedValueOnce({ values: { periodicJobMinutes: 90 } })
    await jest.advanceTimersByTimeAsync(APP_CONFIG_RETRY_MS)

    expect(model.findById).toHaveBeenCalledTimes(2)
    expect(resolveSetting('periodicJobMinutes')).toBe(90)
    expect(errorSpy).toHaveBeenCalledTimes(1)
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
})
