import { Types } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import * as jobMonitor from '../../common/job-monitor'
import {
  BATCH_RETRY_DELAY_MS,
  FCM_BATCH_SIZE,
  HeartbeatCheckTask,
  isPermanentFcmTokenError,
  PUSH_SPREAD_MS,
} from './heartbeat-check.task'

jest.mock('firebase-admin', () => {
  const sendEach = jest.fn()
  return { messaging: () => ({ sendEach }), __sendEach: sendEach }
})

const sendEach: jest.Mock = (firebaseAdmin as any).__sendEach

function devices(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    _id: new Types.ObjectId(),
    fcmToken: `token-${i}`,
  }))
}

function okResponse(count: number) {
  return {
    successCount: count,
    failureCount: 0,
    responses: Array.from({ length: count }, () => ({ success: true })),
  }
}

describe('HeartbeatCheckTask', () => {
  let task: HeartbeatCheckTask
  let sleep: jest.Mock
  let pingSpy: jest.SpyInstance
  const deviceModel = { find: jest.fn(), bulkWrite: jest.fn() }
  let stale: Array<{ _id: Types.ObjectId; fcmToken: string }>

  beforeEach(() => {
    jest.clearAllMocks()
    stale = []
    // The first find returns the whole stale set; later finds re-check a batch by id
    deviceModel.find.mockImplementation((filter) => ({
      select: () => ({
        lean: async () =>
          filter._id
            ? stale.filter((d) => filter._id.$in.some((id) => id.equals(d._id)))
            : stale,
      }),
    }))
    deviceModel.bulkWrite.mockResolvedValue({})
    task = new HeartbeatCheckTask(deviceModel as any)
    sleep = jest.fn().mockResolvedValue(undefined)
    ;(task as any).sleep = sleep
    pingSpy = jest.spyOn(jobMonitor, 'pingJob').mockImplementation(() => undefined)
  })

  afterEach(() => pingSpy.mockRestore())

  it('pings without pushing when no device is stale', async () => {
    await task.checkAndTriggerStaleHeartbeats()
    expect(sendEach).not.toHaveBeenCalled()
    expect(pingSpy).toHaveBeenCalledWith(jobMonitor.MonitoredJob.heartbeatCheck)
  })

  it('spreads the batches over the window and re-checks each batch', async () => {
    stale = devices(FCM_BATCH_SIZE * 3)
    sendEach.mockImplementation(async (msgs) => okResponse(msgs.length))

    const summary = await task.run()

    expect(summary).toMatchObject({ batches: 3, batchesSucceeded: 3, sent: 1500, failed: 0 })
    expect(sendEach).toHaveBeenCalledTimes(3)
    // no wait before the first batch, one gap before each of the others
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(Math.floor(PUSH_SPREAD_MS / 3))
    // 1 full fetch + 3 per-batch re-checks
    expect(deviceModel.find).toHaveBeenCalledTimes(4)
  })

  it('skips a batch whose devices reported on their own while waiting', async () => {
    stale = devices(FCM_BATCH_SIZE + 10)
    const secondBatch = stale.slice(FCM_BATCH_SIZE)
    sendEach.mockImplementation(async (msgs) => {
      // the second batch's devices heartbeat before their turn
      stale = stale.filter((d) => !secondBatch.includes(d))
      return okResponse(msgs.length)
    })

    const summary = await task.run()

    expect(sendEach).toHaveBeenCalledTimes(1)
    expect(summary).toMatchObject({ batches: 2, batchesSucceeded: 2, sent: FCM_BATCH_SIZE })
  })

  it('retries a failed batch once and carries on with the next ones', async () => {
    stale = devices(FCM_BATCH_SIZE * 2)
    sendEach
      .mockRejectedValueOnce(new Error('GOAWAY - ping_timeout'))
      .mockImplementation(async (msgs) => okResponse(msgs.length))

    const summary = await task.run()

    expect(sendEach).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledWith(BATCH_RETRY_DELAY_MS)
    expect(summary).toMatchObject({ batches: 2, batchesSucceeded: 2, batchesFailed: 0, sent: 1000 })
  })

  it('counts a batch as failed after two attempts and still pings when another succeeded', async () => {
    stale = devices(FCM_BATCH_SIZE * 2)
    sendEach
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockRejectedValueOnce(new Error('read ECONNRESET'))
      .mockImplementation(async (msgs) => okResponse(msgs.length))

    await task.checkAndTriggerStaleHeartbeats()

    expect(sendEach).toHaveBeenCalledTimes(3)
    expect(pingSpy).toHaveBeenCalledTimes(1)
  })

  it('does not ping when every batch failed', async () => {
    stale = devices(10)
    sendEach.mockRejectedValue(new Error('read ECONNRESET'))

    await task.checkAndTriggerStaleHeartbeats()

    expect(sendEach).toHaveBeenCalledTimes(2)
    expect(pingSpy).not.toHaveBeenCalled()
  })

  it('does not ping when the device query throws', async () => {
    deviceModel.find.mockImplementation(() => {
      throw new Error('mongo down')
    })

    await task.checkAndTriggerStaleHeartbeats()

    expect(pingSpy).not.toHaveBeenCalled()
  })

  it('invalidates tokens FCM reports as gone and keeps the others', async () => {
    stale = devices(3)
    sendEach.mockResolvedValue({
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered', message: 'gone' } },
        { success: false, error: { code: 'messaging/internal-error', message: 'try later' } },
      ],
    })

    const summary = await task.run()

    expect(summary).toMatchObject({ sent: 1, failed: 2, invalidated: 1 })
    expect(deviceModel.bulkWrite).toHaveBeenCalledTimes(1)
    const ops = deviceModel.bulkWrite.mock.calls[0][0]
    expect(ops).toHaveLength(1)
    expect(ops[0].updateOne.filter._id).toEqual(stale[1]._id)
  })

  it('recognises permanent token errors by code and by message', () => {
    expect(isPermanentFcmTokenError({ code: 'messaging/unregistered' })).toBe(true)
    expect(isPermanentFcmTokenError({ message: 'Requested entity was not found.' })).toBe(true)
    expect(isPermanentFcmTokenError({ code: 'messaging/internal-error' })).toBe(false)
    expect(isPermanentFcmTokenError(null)).toBe(false)
  })
})
