import { Types } from 'mongoose'
import {
  LARGE_BATCH_REFRESH_MS,
  LARGE_BATCH_THRESHOLD,
  SmsBatchStatusService,
} from './sms-batch-status.service'

describe('SmsBatchStatusService', () => {
  const batchId = new Types.ObjectId()
  let statusRows: Array<{ _id: { batch: Types.ObjectId; status: string }; n: number }>
  let batches: Array<Record<string, any>>

  const smsModel = { aggregate: jest.fn() }
  const smsBatchModel = { find: jest.fn(), bulkWrite: jest.fn() }
  let service: SmsBatchStatusService

  const rowsFor = (id: Types.ObjectId, counts: Record<string, number>) =>
    Object.entries(counts).map(([status, n]) => ({ _id: { batch: id, status }, n }))

  const writeFor = (id: Types.ObjectId) =>
    smsBatchModel.bulkWrite.mock.calls
      .flatMap(([writes]) => writes)
      .find((w) => String(w.updateOne.filter._id) === String(id))?.updateOne

  beforeEach(() => {
    jest.clearAllMocks()
    statusRows = rowsFor(batchId, { sent: 1 })
    batches = [{ _id: batchId, recipientCount: 1, status: 'processing' }]
    smsModel.aggregate.mockImplementation(() => ({ read: async () => statusRows }))
    smsBatchModel.find.mockImplementation((filter) => ({
      select: () => ({
        lean: async () =>
          filter._id?.$in
            ? batches.filter((b) => filter._id.$in.some((id) => String(id) === String(b._id)))
            : [],
        limit: () => ({ lean: async () => batches.map((b) => ({ _id: b._id })) }),
      }),
    }))
    smsBatchModel.bulkWrite.mockResolvedValue({ modifiedCount: 1 })
    service = new SmsBatchStatusService(smsModel as any, smsBatchModel as any)
  })

  afterEach(() => {
    service.onModuleDestroy()
    jest.useRealTimers()
  })

  it('writes a finished batch with its counters and completion time', async () => {
    statusRows = rowsFor(batchId, { sent: 1, delivered: 2, failed: 1 })

    await service.refresh([batchId])

    expect(smsModel.aggregate.mock.calls[0][0][0]).toEqual({
      $match: { smsBatch: { $in: [batchId] } },
    })
    const { filter, update } = writeFor(batchId)
    // An older read must not overwrite a newer one
    expect(filter.$or[1].statusCheckedAt.$lte).toBe(update.$set.statusCheckedAt)
    expect(update.$set).toEqual({
      status: 'partial_success',
      successCount: 3,
      sentCount: 1,
      deliveredCount: 2,
      failureCount: 1,
      unknownCount: 0,
      pendingCount: 0,
      dispatchedCount: 0,
      statusCheckedAt: expect.any(Date),
      completedAt: update.$set.statusCheckedAt,
    })
    expect(update.$unset).toBeUndefined()
  })

  it('keeps the completion time while the final status stays the same', async () => {
    const finishedAt = new Date('2026-10-01T00:00:00Z')
    batches = [{ _id: batchId, recipientCount: 2, status: 'completed', completedAt: finishedAt }]
    statusRows = rowsFor(batchId, { delivered: 2 })

    await service.refresh([batchId])

    expect(writeFor(batchId).update.$set.completedAt).toBe(finishedAt)
  })

  it('clears the completion time while messages are still in flight', async () => {
    statusRows = rowsFor(batchId, { dispatched: 1, unknown: 1 })

    await service.refresh([batchId.toHexString()])

    const { update } = writeFor(batchId)
    expect(update.$set.status).toBe('processing')
    expect(update.$set.completedAt).toBeUndefined()
    expect(update.$unset).toEqual({ completedAt: 1 })
  })

  it('stops a batch with no messages from waiting forever', async () => {
    statusRows = []

    await service.refresh([batchId])

    expect(writeFor(batchId).update).toEqual({
      $set: { status: 'unknown', statusCheckedAt: expect.any(Date) },
    })
  })

  it('handles many batches with one read and one write', async () => {
    const other = new Types.ObjectId()
    batches.push({ _id: other, recipientCount: 1, status: 'processing' })
    statusRows = [...rowsFor(batchId, { sent: 1 }), ...rowsFor(other, { failed: 1 })]

    await service.refresh([undefined, null, 'nope', batchId, String(batchId), { _id: batchId }, other])

    expect(smsBatchModel.find).toHaveBeenCalledTimes(1)
    expect(smsModel.aggregate).toHaveBeenCalledTimes(1)
    expect(smsBatchModel.bulkWrite).toHaveBeenCalledTimes(1)
    expect(writeFor(batchId).update.$set.status).toBe('completed')
    expect(writeFor(other).update.$set.status).toBe('failed')
  })

  it('skips a batch that no longer exists', async () => {
    batches = []

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

  it('retries a failed refresh on the next call to retryFailed', async () => {
    smsModel.aggregate.mockImplementationOnce(() => ({
      read: async () => {
        throw new Error('db down')
      },
    }))
    await service.refresh([batchId])
    expect(smsBatchModel.bulkWrite).not.toHaveBeenCalled()

    await expect(service.retryFailed()).resolves.toBe(1)
    expect(writeFor(batchId).update.$set.status).toBe('completed')
    // Retried batches leave the list
    await expect(service.retryFailed()).resolves.toBe(0)
  })

  it('coalesces refreshes of a large batch into one delayed pass', async () => {
    jest.useFakeTimers()
    batches[0].recipientCount = LARGE_BATCH_THRESHOLD + 1

    await service.refresh([batchId])
    await service.refresh([batchId])
    expect(smsModel.aggregate).not.toHaveBeenCalled()

    await jest.advanceTimersByTimeAsync(LARGE_BATCH_REFRESH_MS)
    expect(smsModel.aggregate).toHaveBeenCalledTimes(1)
    expect(smsBatchModel.bulkWrite).toHaveBeenCalledTimes(1)

    // A report after the pass schedules a new one
    await service.refresh([batchId])
    await jest.advanceTimersByTimeAsync(LARGE_BATCH_REFRESH_MS)
    expect(smsModel.aggregate).toHaveBeenCalledTimes(2)
  })

  it('recalculates recent batches whose processing state went stale', async () => {
    const now = new Date('2026-10-04T12:00:00Z')

    await expect(service.recomputeStaleProcessing(now)).resolves.toBe(1)

    const [filter] = smsBatchModel.find.mock.calls[0]
    expect(filter.status).toBe('processing')
    expect(filter.createdAt.$gte.getTime()).toBe(now.getTime() - 30 * 864e5)
    expect(filter.$or[1].statusCheckedAt.$lt.getTime()).toBe(now.getTime() - 10 * 60 * 1000)
    expect(smsBatchModel.bulkWrite).toHaveBeenCalledTimes(1)
  })
})
