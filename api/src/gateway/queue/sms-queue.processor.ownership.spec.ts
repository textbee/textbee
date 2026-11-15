import { SmsQueueProcessor } from './sms-queue.processor'
import { readPipelineUpdate } from '../../../test/pipeline-update'
import * as firebaseAdmin from 'firebase-admin'
import { FcmSendTimeoutError } from './send-timeout'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({
    sendEach: jest.fn(),
  }),
}))

// Rows are kept in memory so the take step behaves like the real collection
describe('SmsQueueProcessor push ownership', () => {
  const originalEnv = { ...process.env }
  const deviceId = 'device123'
  const smsBatchId = 'batch123'
  let rows: Record<string, any>
  let device: any
  let processor: SmsQueueProcessor
  let sendEach: jest.SpyInstance

  const fcmMessage = (smsId: string) => ({
    token: 'fcm-token',
    android: { priority: 'high', ttl: 72 * 3600 * 1000 },
    data: { smsData: JSON.stringify({ smsId }) },
  })
  const job = (...smsIds: string[]) =>
    ({ id: 1, data: { deviceId, smsBatchId, fcmMessages: smsIds.map(fcmMessage) } }) as any

  const smsModel = {
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
    find: jest.fn(),
  }
  const deviceModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  }
  const batchStatus = { refresh: jest.fn() }
  const webhookService = { deliverNotification: jest.fn() }
  const usersService = { markMilestone: jest.fn() }

  const ok = (count: number) => ({
    successCount: count,
    failureCount: 0,
    responses: Array.from({ length: count }, (_, i) => ({ success: true, messageId: `fcm-${i}` })),
  })
  const rejectedBy = (code: string) => ({
    successCount: 0,
    failureCount: 1,
    responses: [{ success: false, error: { code, message: code } }],
  })

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, RECOVERABLE_PUSH_FAILURES_ENABLED: 'true' }
    delete process.env.RECOVERY_POLL_ENABLED
    delete process.env.PULL_ENABLED

    rows = {
      'sms-1': { status: 'pending', metadata: { appVersionCode: 20 } },
      'sms-2': { status: 'pending', metadata: { appVersionCode: 20 } },
    }
    device = {
      _id: deviceId,
      user: { _id: 'user123' },
      appVersionInfo: { versionCode: 20 },
      lastHeartbeat: new Date(),
    }

    deviceModel.findById.mockReturnValue({
      populate: () => ({ exec: jest.fn().mockImplementation(async () => device) }),
    })
    deviceModel.findByIdAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(true) })
    deviceModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
    batchStatus.refresh.mockResolvedValue(undefined)
    usersService.markMilestone.mockResolvedValue(false)
    smsModel.bulkWrite.mockResolvedValue({})

    // The take step: only waiting rows that no run has marked
    smsModel.updateMany.mockImplementation(async (filter: any, update: any) => {
      if (filter['metadata.pushJob']?.$exists === false) {
        const minStamp = filter['metadata.appVersionCode']?.$gte
        for (const id of filter._id.$in) {
          const row = rows[id]
          if (!row || !filter.status.$in.includes(row.status) || row.metadata.pushJob) continue
          if (minStamp !== undefined && !(row.metadata.appVersionCode >= minStamp)) continue
          for (const [key, value] of Object.entries<any>(update.$set)) {
            row.metadata[key.replace('metadata.', '')] = value
          }
        }
      }
      return { modifiedCount: 1 }
    })
    smsModel.find.mockImplementation((filter: any) => {
      const token = filter['metadata.pushJob']
      const result = token
        ? Object.entries(rows)
            .filter(([id, row]) => filter._id.$in.includes(id) && row.metadata.pushJob === token)
            .map(([id, row]) => ({ _id: id, metadata: row.metadata }))
        : []
      const query: any = Promise.resolve(result)
      query.select = () => ({ lean: async () => result })
      return query
    })

    processor = new SmsQueueProcessor(
      deviceModel as any,
      smsModel as any,
      webhookService as any,
      usersService as any,
      batchStatus as any,
    )
    sendEach = jest.spyOn(firebaseAdmin.messaging(), 'sendEach')
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  const pushed = () => sendEach.mock.calls.flatMap(([messages]) => messages)
  const updatesFor = (key: string) =>
    smsModel.updateMany.mock.calls.filter(([, update]) =>
      Array.isArray(update)
        ? update.some((stage: any) => stage.$set?.[key] !== undefined)
        : update.$set?.[key] !== undefined,
    )

  it('pushes nothing when the same job runs a second time', async () => {
    sendEach.mockResolvedValue(ok(2) as any)

    await processor.handleSendSms(job('sms-1', 'sms-2'))
    expect(pushed()).toHaveLength(2)

    sendEach.mockClear()
    const result = await processor.handleSendSms(job('sms-1', 'sms-2'))

    expect(sendEach).not.toHaveBeenCalled()
    expect(result).toEqual({ successCount: 0, failureCount: 0, responses: [] })
    expect(smsModel.bulkWrite).toHaveBeenCalledTimes(1)
  })

  it.each(['dispatched', 'sent', 'delivered', 'failed'])(
    'does not push a row that is already %s',
    async (status) => {
      rows['sms-1'].status = status
      sendEach.mockResolvedValue(ok(1) as any)

      await processor.handleSendSms(job('sms-1', 'sms-2'))

      expect(pushed().map((message) => JSON.parse(message.data.smsData).smsId)).toEqual(['sms-2'])
    },
  )

  it('does not mark a row it did not take as failed when the push throws', async () => {
    rows['sms-1'].status = 'sent'
    sendEach.mockRejectedValue(Object.assign(new Error('boom'), { code: 'app/network-error' }))

    await expect(processor.handleSendSms(job('sms-1', 'sms-2'))).rejects.toThrow('boom')

    const [failedFilter] = updatesFor('status')[0]
    expect(failedFilter._id.$in).toEqual(['sms-2'])
  })

  it('keeps the long push lifetime for a device that does not pull', async () => {
    sendEach.mockResolvedValue(ok(1) as any)
    await processor.handleSendSms(job('sms-1'))

    expect(pushed()[0].android.ttl).toBe(72 * 3600 * 1000)
    expect(updatesFor('metadata.claimableAt')).toHaveLength(0)
    expect(rows['sms-1'].metadata.handedTo).toBe('fcm')
  })

  describe('a device that pulls', () => {
    beforeEach(() => {
      device.appVersionInfo.versionCode = 22
      device.pullInfo = { pullCapable: true }
      device.pushInstallId = 'install-a'
      device.installId = 'install-b'
      device.configOverrides = { pullEnabled: true }
      rows['sms-1'].metadata.appVersionCode = 22
    })

    it('gets a 30 minute push and a claim time 40 minutes out, set when the row is taken', async () => {
      sendEach.mockResolvedValue(ok(1) as any)
      const before = Date.now()
      await processor.handleSendSms(job('sms-1'))

      expect(pushed()[0].android.ttl).toBe(30 * 60 * 1000)
      const [[filter, update]] = updatesFor('metadata.claimableAt')
      // One write takes the row and sets the claim time
      expect(filter['metadata.pushJob']).toEqual({ $exists: false })
      expect(filter['metadata.appVersionCode']).toEqual({ $gte: 20 })
      expect(update.$set['metadata.pushJob']).toEqual(expect.any(String))
      const lease = update.$set['metadata.claimableAt'].getTime() - before
      expect(lease).toBeGreaterThanOrEqual(40 * 60 * 1000)
      expect(lease).toBeLessThan(41 * 60 * 1000)
      expect(rows['sms-1'].metadata.handedTo).toBe('install-a')
    })

    it('keeps the long lifetime for a row queued for a build that cannot claim', async () => {
      rows['sms-1'].metadata.appVersionCode = 18
      sendEach.mockResolvedValue(ok(1) as any)
      await processor.handleSendSms(job('sms-1'))

      expect(pushed()[0].android.ttl).toBe(72 * 3600 * 1000)
      expect(rows['sms-1'].metadata.claimableAt).toBeUndefined()
    })

    it('leaves the row waiting, not failed, when the push outcome is unclear', async () => {
      sendEach.mockRejectedValue(new FcmSendTimeoutError(120000))

      await expect(processor.handleSendSms(job('sms-1'))).rejects.toThrow()

      const statusWrites = updatesFor('status')
      expect(statusWrites.every(([filter]) => filter._id.$in.length === 0)).toBe(true)
      expect(webhookService.deliverNotification).not.toHaveBeenCalled()
    })
  })

  describe('a rejected push', () => {
    it('stays claimable for a build that can claim, with no failed status', async () => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      sendEach.mockResolvedValue(rejectedBy('messaging/registration-token-not-registered') as any)

      await processor.handleSendSms(job('sms-1'))

      const writes = smsModel.bulkWrite.mock.calls[0][0]
      expect(writes).toHaveLength(2)
      const [held, failed] = writes.map((write: any) => write.updateOne)
      expect(held.filter['metadata.appVersionCode']).toEqual({ $gte: 20 })
      // A row a claim took while the push was in flight is left to the claim
      expect(held.filter.status).toEqual({ $in: ['pending', 'unknown'] })
      expect(held.filter['metadata.pushJob']).toBe(rows['sms-1'].metadata.pushJob)
      expect(failed.filter.status).toEqual({ $in: ['pending', 'unknown'] })
      const heldUpdate = readPipelineUpdate(held.update)
      expect(heldUpdate.set['metadata.claimableAt']).toBeInstanceOf(Date)
      expect(heldUpdate.set.status).toBeUndefined()
      expect(heldUpdate.unset).toEqual(['metadata.handedTo'])
      expect(heldUpdate.history[0].code).toBe('FCM_TOKEN_NOT_REGISTERED')
      // The failed write is limited to rows a claim can never return
      expect(failed.filter.$or).toEqual([
        { 'metadata.appVersionCode': { $lt: 20 } },
        { 'metadata.appVersionCode': { $exists: false } },
        { requestedAt: { $lt: expect.any(Date) } },
        { requestedAt: { $exists: false } },
      ])
      // Held only while a claim can still return the row
      const windowMs = Date.now() - held.filter.requestedAt.$gte.getTime()
      expect(Math.round(windowMs / 3600000)).toBe(72)
      expect(readPipelineUpdate(failed.update).set.status).toBe('failed')
    })

    it.each([
      ['an older build', () => (device.appVersionInfo.versionCode = 18)],
      ['a device with recovery off', () => (process.env.RECOVERY_POLL_ENABLED = 'false')],
      ['a device silent for over a day', () => (device.lastHeartbeat = new Date(Date.now() - 25 * 3600 * 1000))],
    ])('fails at once for %s, as before', async (_name, arrange) => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      arrange()
      sendEach.mockResolvedValue(rejectedBy('messaging/registration-token-not-registered') as any)

      await processor.handleSendSms(job('sms-1'))

      const writes = smsModel.bulkWrite.mock.calls[0][0]
      expect(writes).toHaveLength(1)
      expect(writes[0].updateOne.filter).toEqual({
        _id: 'sms-1',
        'metadata.pushJob': rows['sms-1'].metadata.pushJob,
        status: { $in: ['pending', 'unknown'] },
      })
      expect(readPipelineUpdate(writes[0].updateOne.update).set.status).toBe('failed')
    })

    it('fails at once when the error does not prove a rejection', async () => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      sendEach.mockResolvedValue(rejectedBy('messaging/internal-error') as any)

      await processor.handleSendSms(job('sms-1'))

      const writes = smsModel.bulkWrite.mock.calls[0][0]
      expect(writes).toHaveLength(1)
      expect(readPipelineUpdate(writes[0].updateOne.update).set.status).toBe('failed')
    })

    it('marks nothing when the rows could not be taken', async () => {
      smsModel.updateMany.mockRejectedValueOnce(new Error('db down'))

      await expect(processor.handleSendSms(job('sms-1'))).rejects.toThrow('db down')

      expect(sendEach).not.toHaveBeenCalled()
      expect(updatesFor('status')).toHaveLength(0)
      expect(webhookService.deliverNotification).not.toHaveBeenCalled()
    })

    it('names no install when the last install to report does not hold the push token', async () => {
      device.appVersionInfo.versionCode = 22
      device.pullInfo = { pullCapable: true }
      device.installId = 'install-b'
      device.configOverrides = { pullEnabled: true }
      sendEach.mockResolvedValue(ok(1) as any)

      await processor.handleSendSms(job('sms-1'))

      expect(rows['sms-1'].metadata.handedTo).toBe('fcm')
      expect(rows['sms-1'].metadata.claimableAt).toBeUndefined()
      expect(pushed()[0].android.ttl).toBe(72 * 3600 * 1000)
    })

    it('holds every row of a rejected call for a build that can claim', async () => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      sendEach.mockRejectedValue(
        Object.assign(new Error('bad credential'), { code: 'app/invalid-credential' }),
      )

      await expect(processor.handleSendSms(job('sms-1', 'sms-2'))).rejects.toThrow()

      const [[heldFilter, heldUpdate]] = updatesFor('metadata.claimableAt')
      expect(heldFilter._id.$in).toEqual(['sms-1', 'sms-2'])
      expect(heldFilter.status).toEqual({ $in: ['pending', 'unknown'] })
      expect(heldFilter['metadata.pushJob']).toBe(rows['sms-1'].metadata.pushJob)
      expect(heldFilter['metadata.appVersionCode']).toEqual({ $gte: 20 })
      expect(readPipelineUpdate(heldUpdate).set.status).toBeUndefined()
      const [[failedFilter]] = updatesFor('status')
      expect(failedFilter.$or).toEqual([
        { 'metadata.appVersionCode': { $lt: 20 } },
        { 'metadata.appVersionCode': { $exists: false } },
        { requestedAt: { $lt: expect.any(Date) } },
        { requestedAt: { $exists: false } },
      ])
    })
  })

  it('re-stamps rows when the phone now runs a build that cannot claim', async () => {
    device.appVersionInfo.versionCode = 18
    sendEach.mockResolvedValue(ok(1) as any)

    await processor.handleSendSms(job('sms-1'))

    const [[filter, update]] = updatesFor('metadata.appVersionCode')
    expect(filter['metadata.appVersionCode']).toEqual({ $gte: 20 })
    expect(update.$set['metadata.appVersionCode']).toBe(18)
  })
})
