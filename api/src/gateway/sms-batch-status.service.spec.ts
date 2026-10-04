import { Types } from 'mongoose'
import {
  LARGE_BATCH_REFRESH_MS,
  LARGE_BATCH_THRESHOLD,
  SmsBatchStatusService,
} from './sms-batch-status.service'

describe('SmsBatchStatusService', () => {
  const batchId = new Types.ObjectId()
  let statusRows: Array<{ _id: string; n: number }>
  let recipientCount: number | null

  const smsModel = { aggregate: jest.fn() }
  const smsBatchModel = {
    findById: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(),
  }
  let service: SmsBatchStatusService

  beforeEach(() => {
    jest.clearAllMocks()
    statusRows = [{ _id: 'sent', n: 1 }]
    recipientCount = 1
    smsModel.aggregate.mockImplementation(() => ({
      read: async () => statusRows,
    }))
    smsBatchModel.findById.mockImplementation(() => ({
      select: () => ({
        lean: async () => (recipientCount === null ? null : { recipientCount }),
      }),
    }))
    smsBatchModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
    service = new SmsBatchStatusService(smsModel as any, smsBatchModel as any)
  })

  afterEach(() => {
    service.onModuleDestroy()
    jest.useRealTimers()
  })

  it('writes a finished batch with its counters and completion time', async () => {
    statusRows = [
      { _id: 'sent', n: 1 },
      { _id: 'delivered', n: 2 },
      { _id: 'failed', n: 1 },
    ]

    await service.refresh([batchId])

    expect(smsModel.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { smsBatch: batchId },
    })
    const [filter, update] = smsBatchModel.updateOne.mock.calls[0]
    expect(filter._id).toEqual(batchId)
    // An older read must not overwrite a newer one
    expect(filter.$or[1].statusCheckedAt.$lte).toBe(update.$set.statusCheckedAt)
    expect(update.$set).toEqual(
      expect.objectContaining({
        status: 'partial_success',
        successCount: 3,
        sentCount: 1,
        deliveredCount: 2,
        failureCount: 1,
        unknownCount: 0,
        pendingCount: 0,
        dispatchedCount: 0,
        completedAt: update.$set.statusCheckedAt,
      }),
    )
    expect(update.$unset).toBeUndefined()
  })

  it('clears the completion time while messages are still in flight', async () => {
    statusRows = [
      { _id: 'dispatched', n: 1 },
      { _id: 'unknown', n: 1 },
    ]

    await service.refresh([batchId.toHexString()])

    const [, update] = smsBatchModel.updateOne.mock.calls[0]
    expect(update.$set.status).toBe('processing')
    expect(update.$set.completedAt).toBeUndefined()
    expect(update.$unset).toEqual({ completedAt: 1 })
  })

  it('leaves a batch without messages alone', async () => {
    statusRows = []

    await service.refresh([batchId])

    expect(smsBatchModel.updateOne).not.toHaveBeenCalled()
  })

  it('skips empty and invalid ids and refreshes each batch once', async () => {
    await service.refresh([undefined, null, 'nope', batchId, String(batchId), { _id: batchId }])

    expect(smsBatchModel.findById).toHaveBeenCalledTimes(1)
    expect(smsBatchModel.updateOne).toHaveBeenCalledTimes(1)
  })

  it('skips a batch that no longer exists', async () => {
    recipientCount = null

    await service.refresh([batchId])

    expect(smsModel.aggregate).not.toHaveBeenCalled()
  })

  it('never throws to the caller', async () => {
    smsModel.aggregate.mockImplementation(() => ({
      read: async () => {
        throw new Error('db down')
      },
    }))

    await expect(service.refresh([batchId])).resolves.toBeUndefined()
  })

  it('coalesces refreshes of a large batch into one delayed pass', async () => {
    jest.useFakeTimers()
    recipientCount = LARGE_BATCH_THRESHOLD + 1

    await service.refresh([batchId])
    await service.refresh([batchId])
    expect(smsModel.aggregate).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(LARGE_BATCH_REFRESH_MS)
    expect(smsModel.aggregate).toHaveBeenCalledTimes(1)
    expect(smsBatchModel.updateOne).toHaveBeenCalledTimes(1)

    // A report after the pass schedules a new one
    await service.refresh([batchId])
    await jest.advanceTimersByTimeAsync(LARGE_BATCH_REFRESH_MS)
    expect(smsModel.aggregate).toHaveBeenCalledTimes(2)
  })

  it('recalculates recent batches whose processing state went stale', async () => {
    const now = new Date('2026-10-04T12:00:00Z')
    smsBatchModel.find.mockReturnValue({
      select: () => ({ limit: () => ({ lean: async () => [{ _id: batchId }] }) }),
    })

    await expect(service.recomputeStaleProcessing(now)).resolves.toBe(1)

    const [filter] = smsBatchModel.find.mock.calls[0]
    expect(filter.status).toBe('processing')
    expect(filter.createdAt.$gte.getTime()).toBe(now.getTime() - 30 * 864e5)
    expect(filter.$or[1].statusCheckedAt.$lt.getTime()).toBe(now.getTime() - 10 * 60 * 1000)
    expect(smsBatchModel.updateOne).toHaveBeenCalledTimes(1)
  })
})
