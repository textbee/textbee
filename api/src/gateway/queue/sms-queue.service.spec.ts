import { Test, TestingModule } from '@nestjs/testing'
import { getQueueToken } from '@nestjs/bull'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
import { Message } from 'firebase-admin/messaging'
import { EnqueueFailedError, SmsQueueService } from './sms-queue.service'

function buildMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    token: 'token',
    data: { smsData: JSON.stringify({ smsId: `sms-${i}` }) },
  }))
}

describe('SmsQueueService', () => {
  let service: SmsQueueService
  let jobSeq = 0
  const removedJobIds: number[] = []
  const queueAdd = jest.fn().mockImplementation(async () => {
    const id = ++jobSeq
    return { id, remove: jest.fn(async () => { removedJobIds.push(id) }) }
  })
  const config: Record<string, unknown> = {}

  const mockConfigService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in config ? config[key] : fallback,
    ),
  }

  async function build(overrides: Record<string, unknown> = {}) {
    for (const key of Object.keys(config)) delete config[key]
    Object.assign(config, { USE_SMS_QUEUE: true }, overrides)
    queueAdd.mockClear()
    removedJobIds.length = 0

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsQueueService,
        { provide: getQueueToken('sms'), useValue: { add: queueAdd } },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile()

    service = module.get(SmsQueueService)
  }

  beforeEach(() => build())

  it('reports whether the queue is enabled', async () => {
    expect(service.isQueueEnabled()).toBe(true)
    await build({ USE_SMS_QUEUE: false })
    expect(service.isQueueEnabled()).toBe(false)
  })

  it('enqueues a small batch as one immediate job, unchanged from before', async () => {
    const messages = buildMessages(10)

    const jobs = await service.addSendSmsJob('device-1', messages, 'batch-1')

    expect(jobs).toHaveLength(1)
    expect(queueAdd).toHaveBeenCalledTimes(1)
    const [name, data, opts] = queueAdd.mock.calls[0]
    expect(name).toBe('send-sms')
    expect(data).toEqual({
      deviceId: 'device-1',
      fcmMessages: messages,
      smsBatchId: 'batch-1',
    })
    expect(opts).toMatchObject({
      attempts: 1,
      delay: 0,
      priority: 1,
      timeout: 300_000,
    })
    expect(service.planSendSmsJob(10).waves).toEqual([
      { start: 0, end: 10, delayMs: 0 },
    ])
  })

  it('paces a large batch into waves spaced by the device send delay', async () => {
    const messages = buildMessages(120)

    const jobs = await service.addSendSmsJob(
      'device-1',
      messages,
      'batch-1',
      undefined,
      5,
    )

    expect(jobs).toHaveLength(3)
    expect(queueAdd).toHaveBeenCalledTimes(3)
    expect(queueAdd.mock.calls.map(([, , opts]) => opts.delay)).toEqual([
      0, 250_000, 500_000,
    ])
    expect(queueAdd.mock.calls.map(([, data]) => data.fcmMessages.length)).toEqual(
      [50, 50, 20],
    )
    expect(queueAdd.mock.calls[2][1].fcmMessages[0]).toBe(messages[100])
    const plan = service.planSendSmsJob(120, undefined, 5)
    expect(plan.waves).toHaveLength(3)
    expect(plan.projectedCompletionMs).toBe(500_000 + 20 * 5000)
  })

  it('uses a precomputed plan when one is passed', async () => {
    const plan = service.planSendSmsJob(100, undefined, 5)

    await service.addSendSmsJob('device-1', buildMessages(100), 'batch-1', undefined, 5, plan)

    expect(queueAdd.mock.calls.map(([, , opts]) => opts.delay)).toEqual(
      plan.waves.map((w) => w.delayMs),
    )
  })

  it('removes the waves already added when a later wave fails to enqueue', async () => {
    queueAdd
      .mockImplementationOnce(async () => ({ id: 'a', remove: jest.fn(async () => { removedJobIds.push(1) }) }))
      .mockImplementationOnce(async () => ({ id: 'b', remove: jest.fn(async () => { removedJobIds.push(2) }) }))
      .mockRejectedValueOnce(new Error('redis down'))

    const error = await service
      .addSendSmsJob('device-1', buildMessages(150), 'batch-1', undefined, 5)
      .catch((e) => e)

    expect(error).toBeInstanceOf(EnqueueFailedError)
    expect(error.message).toBe('redis down')
    expect(error.keptJobs).toEqual([])
    expect(queueAdd).toHaveBeenCalledTimes(3)
    expect(removedJobIds).toEqual([1, 2])
  })

  it('reports a wave a worker already picked up as kept', async () => {
    const running = { id: 'a', remove: jest.fn().mockRejectedValue(new Error('locked')) }
    queueAdd
      .mockImplementationOnce(async () => running)
      .mockRejectedValueOnce(new Error('redis down'))

    const error = await service
      .addSendSmsJob('device-1', buildMessages(100), 'batch-1', undefined, 5)
      .catch((e) => e)

    expect(error.keptJobs).toEqual([running])
  })

  it('removeJobs tolerates jobs that can no longer be removed', async () => {
    const ok = { remove: jest.fn().mockResolvedValue(undefined) }
    const gone = { remove: jest.fn().mockRejectedValue(new Error('already active')) }

    await expect(service.removeJobs([ok, gone] as any)).resolves.toEqual([ok])
    expect(ok.remove).toHaveBeenCalled()
    expect(gone.remove).toHaveBeenCalled()
  })

  it('adds the scheduled delay as a base under the wave spacing', async () => {
    await service.addSendSmsJob('device-1', buildMessages(100), 'batch-1', 90_000, 5)

    expect(queueAdd.mock.calls.map(([, , opts]) => opts.delay)).toEqual([
      90_000, 340_000,
    ])
  })

  it('falls back to SMS_QUEUE_IMMEDIATE_DELAY_MS as the base when not scheduled', async () => {
    await build({ SMS_QUEUE_IMMEDIATE_DELAY_MS: 1500 })

    await service.addSendSmsJob('device-1', buildMessages(60), 'batch-1', undefined, 5)

    expect(queueAdd.mock.calls.map(([, , opts]) => opts.delay)).toEqual([
      1500, 251_500,
    ])
  })

  it('caps the wave size at MAX_SMS_BATCH_SIZE and honours BULK_DISPATCH_WINDOW', async () => {
    await build({ MAX_SMS_BATCH_SIZE: 20, BULK_DISPATCH_WINDOW: 50 })
    await service.addSendSmsJob('device-1', buildMessages(40), 'batch-1', undefined, 5)
    expect(queueAdd.mock.calls.map(([, data]) => data.fcmMessages.length)).toEqual(
      [20, 20],
    )

    await build({ BULK_DISPATCH_WINDOW: 10 })
    await service.addSendSmsJob('device-1', buildMessages(25), 'batch-1', undefined, 5)
    expect(queueAdd.mock.calls.map(([, , opts]) => opts.delay)).toEqual([
      0, 50_000, 100_000,
    ])
  })

  it('setting the window above the batch size disables pacing', async () => {
    await build({ MAX_SMS_BATCH_SIZE: 5000, BULK_DISPATCH_WINDOW: 5000 })

    await service.addSendSmsJob('device-1', buildMessages(2000), 'batch-1', undefined, 5)

    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0][2].delay).toBe(0)
  })

  it('starts every wave after the pacing delay of an immediate batch', async () => {
    const plan = service.planSendSmsJob(120, undefined, 5, 400_000)

    expect(plan.waves.map((w) => w.delayMs)).toEqual([400_000, 650_000, 900_000])
    expect(plan.projectedCompletionMs).toBe(900_000 + 20 * 5000)
  })

  it('reports the wave size it plans with', async () => {
    expect(service.dispatchWaveSize()).toBe(50)
    await build({ MAX_SMS_BATCH_SIZE: 20 })
    expect(service.dispatchWaveSize()).toBe(20)
  })

  it('marks jobs with the time reserved per message on the device', async () => {
    const plan = service.planSendSmsJob(60, undefined, 7)

    await service.addSendSmsJob('device-1', buildMessages(60), 'batch-1', undefined, 7, plan, 7_000)

    for (const [, data] of queueAdd.mock.calls) {
      expect(data).toMatchObject({ inDeviceBacklog: true, backlogDelayMs: 7_000 })
    }
  })

  it('leaves jobs unmarked when no time was reserved', async () => {
    await service.addSendSmsJob('device-1', buildMessages(2), 'batch-1')

    expect(queueAdd.mock.calls[0][1]).not.toHaveProperty('inDeviceBacklog')
    expect(queueAdd.mock.calls[0][1]).not.toHaveProperty('backlogDelayMs')
  })

  it('does not count the pacing delay toward the spread warning', async () => {
    await build({ BULK_DISPATCH_MAX_SPREAD_HOURS: 1 })
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const plan = service.planSendSmsJob(100, undefined, 5, 2 * 3600 * 1000)

    await service.addSendSmsJob('device-1', buildMessages(100), 'batch-1', undefined, 5, plan)

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('warns but still enqueues every wave when the spread exceeds the cap', async () => {
    await build({ BULK_DISPATCH_MAX_SPREAD_HOURS: 1 })
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await service.addSendSmsJob('device-1', buildMessages(1000), 'batch-1', undefined, 5)

    expect(queueAdd).toHaveBeenCalledTimes(20)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('batch-1')
    warn.mockRestore()
  })
})
