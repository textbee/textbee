import { SmsQueueProcessor } from './sms-queue.processor'
import { readPipelineUpdate } from '../../../test/pipeline-update'
import * as firebaseAdmin from 'firebase-admin'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({
    sendEach: jest.fn(),
  }),
}))

describe('SmsQueueProcessor.handleSendSms', () => {
  const deviceId = 'device123'
  const userId = 'user123'
  const smsBatchId = 'batch123'
  const originalEnv = { ...process.env }

  const fcmMessages = [
    {
      token: 'fcm-token',
      data: { smsData: JSON.stringify({ smsId: 'sms-1' }) },
    },
  ]

  const mockDeviceModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  }
  const mockSmsModel = {
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
    find: jest.fn(),
  }
  const mockBatchStatus = { refresh: jest.fn() }
  const mockWebhookService = { deliverNotification: jest.fn() }
  const mockUsersService = { markMilestone: jest.fn() }

  let processor: SmsQueueProcessor

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }

    mockDeviceModel.findById.mockReturnValue({
      populate: () => ({
        exec: jest.fn().mockResolvedValue({ _id: deviceId, user: { _id: userId } }),
      }),
    })
    mockDeviceModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(true),
    })
    mockDeviceModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
    mockBatchStatus.refresh.mockResolvedValue(undefined)
    mockSmsModel.updateMany.mockResolvedValue({ modifiedCount: 1 })
    mockSmsModel.find.mockResolvedValue([])
    mockUsersService.markMilestone.mockResolvedValue(false)

    processor = new SmsQueueProcessor(
      mockDeviceModel as any,
      mockSmsModel as any,
      mockWebhookService as any,
      mockUsersService as any,
      mockBatchStatus as any,
    )
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  const job = { id: 1, data: { deviceId, fcmMessages, smsBatchId } } as any

  it('pushes normally when nothing is listed for skipping', async () => {
    const sendEach = jest
      .spyOn(firebaseAdmin.messaging(), 'sendEach')
      .mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true, messageId: 'fcm-1' }],
      } as any)

    await processor.handleSendSms(job)

    expect(sendEach).toHaveBeenCalledWith(fcmMessages)
    const [writes] = mockSmsModel.bulkWrite.mock.calls[0]
    expect(writes).toEqual([
      {
        updateOne: {
          filter: { _id: 'sms-1', status: { $in: ['pending', 'dispatched', 'unknown'] } },
          update: {
            $unset: { errorMessage: '' },
            $set: {
              status: 'dispatched',
              dispatchedAt: expect.any(Date),
              'metadata.fcmMessageId': 'fcm-1',
            },
            $inc: { dispatchAttempts: 1 },
          },
        },
      },
    ])
  })

  it('records the failure and its history when the push is rejected', async () => {
    jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
      ],
    } as any)
    mockSmsModel.find.mockResolvedValue([])

    await processor.handleSendSms(job)

    const [writes] = mockSmsModel.bulkWrite.mock.calls[0]
    const failure = readPipelineUpdate(writes[0].updateOne.update)
    expect(failure.set).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'FCM_TOKEN_NOT_REGISTERED',
      }),
    )
    expect(failure.set.dispatchAttempts).toEqual({
      $add: [{ $ifNull: ['$dispatchAttempts', 0] }, 1],
    })
    expect(failure.history[0]).toEqual(
      expect.objectContaining({
        code: 'FCM_TOKEN_NOT_REGISTERED',
        source: 'push',
      }),
    )
    // A phone report the push lost to is never overwritten
    expect(writes[0].updateOne.filter).toEqual(
      expect.objectContaining({ status: { $in: ['pending', 'dispatched', 'unknown'] } }),
    )
    // The batch is recalculated from its messages after they are written
    expect(mockBatchStatus.refresh).toHaveBeenCalledWith([smsBatchId])
    expect(mockSmsModel.bulkWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mockBatchStatus.refresh.mock.invocationCallOrder[0],
    )
  })

  it('refreshes the batch after a failed handoff marks its messages', async () => {
    jest
      .spyOn(firebaseAdmin.messaging(), 'sendEach')
      .mockRejectedValueOnce(new Error('fcm down'))

    await expect(processor.handleSendSms(job)).rejects.toThrow('fcm down')

    expect(mockSmsModel.updateMany).toHaveBeenCalled()
    expect(mockBatchStatus.refresh).toHaveBeenCalledWith([smsBatchId])
  })

  it('sends failure webhooks only for messages the failed handoff changed', async () => {
    jest
      .spyOn(firebaseAdmin.messaging(), 'sendEach')
      .mockRejectedValueOnce(new Error('fcm down'))
    const changed = { _id: 'sms-1', status: 'failed' }
    mockSmsModel.find.mockResolvedValueOnce([changed])
    mockWebhookService.deliverNotification.mockResolvedValue(undefined)

    await expect(processor.handleSendSms(job)).rejects.toThrow('fcm down')

    const [, update] = mockSmsModel.updateMany.mock.calls[0]
    expect(mockSmsModel.find).toHaveBeenCalledWith({
      _id: { $in: ['sms-1'] },
      status: 'failed',
      failedAt: readPipelineUpdate(update).set.failedAt,
    })
    expect(mockWebhookService.deliverNotification).toHaveBeenCalledTimes(1)
    expect(mockWebhookService.deliverNotification).toHaveBeenCalledWith(
      expect.objectContaining({ sms: changed, event: 'MESSAGE_FAILED' }),
    )
  })

  it('fails the messages and frees the job when the push never settles', async () => {
    jest.useFakeTimers()
    jest
      .spyOn(firebaseAdmin.messaging(), 'sendEach')
      .mockReturnValueOnce(new Promise(() => undefined))

    const handled = processor.handleSendSms(job).catch((e) => e)
    await jest.advanceTimersByTimeAsync(120_000)
    const error = await handled
    jest.useRealTimers()

    expect(error.code).toBe('FCM_SEND_TIMEOUT')
    const [filter, update, options] = mockSmsModel.updateMany.mock.calls[0]
    // A phone report that landed while the push hung is kept, failures too
    expect(filter).toEqual({
      _id: { $in: ['sms-1'] },
      status: { $in: ['pending', 'dispatched', 'unknown'] },
    })
    expect(options).toEqual({ updatePipeline: true })
    const { set } = readPipelineUpdate(update)
    expect(set.dispatchAttempts).toBeDefined()
    delete set.dispatchAttempts
    expect(set).toEqual({
      status: 'failed',
      failedAt: expect.any(Date),
      errorCode: 'FCM_SEND_TIMEOUT',
      errorMessage:
        'FCM_SEND_TIMEOUT: Push to the device timed out after 120 seconds. The message may not have reached the phone.',
    })
    expect(mockBatchStatus.refresh).toHaveBeenCalledWith([smsBatchId])
  })

  it('withholds the push for a listed user and marks the message', async () => {
    process.env.FCM_SEND_SKIP_USER_IDS = userId
    const sendEach = jest.spyOn(firebaseAdmin.messaging(), 'sendEach')

    const response = await processor.handleSendSms(job)

    expect(sendEach).not.toHaveBeenCalled()
    expect(response.successCount).toBe(1)
    const [writes] = mockSmsModel.bulkWrite.mock.calls[0]
    // A phone report that landed first is not overwritten
    expect(writes[0].updateOne.filter.status).toEqual({ $in: ['pending', 'dispatched', 'unknown'] })
    // The skip path fakes a message id, so it must not be stored as one
    expect(writes[0].updateOne.update.$set).toEqual({
      status: 'dispatched',
      dispatchedAt: expect.any(Date),
      errorCode: 'FCM_SEND_SKIPPED',
    })
    expect(mockBatchStatus.refresh).toHaveBeenCalledWith([smsBatchId])
  })

  it('does not re-mark messages when persistence fails after the push', async () => {
    jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'fcm-1' }],
    } as any)
    // once: clearAllMocks keeps implementations, so a persistent rejection
    // would leak into the next test
    mockSmsModel.bulkWrite.mockRejectedValueOnce(new Error('write concern'))

    await expect(processor.handleSendSms(job)).rejects.toThrow('write concern')

    // the blanket failure belongs to a failed handoff, not a failed write
    expect(mockSmsModel.updateMany).not.toHaveBeenCalled()
    // rows the partial write did change still reach the batch
    expect(mockBatchStatus.refresh).toHaveBeenCalledWith([smsBatchId])
  })

  it('withholds the push for a listed device', async () => {
    process.env.FCM_SEND_SKIP_DEVICE_IDS = 'other-device,' + deviceId
    const sendEach = jest.spyOn(firebaseAdmin.messaging(), 'sendEach')

    await processor.handleSendSms(job)

    expect(sendEach).not.toHaveBeenCalled()
  })

  describe('device backlog', () => {
    const backlogJob = {
      id: 2,
      data: { deviceId, fcmMessages, smsBatchId, inDeviceBacklog: true },
    } as any

    function deviceWith(fields: Record<string, unknown>) {
      mockDeviceModel.findById.mockReturnValue({
        populate: () => ({
          exec: jest.fn().mockResolvedValue({
            _id: deviceId,
            user: { _id: userId },
            ...fields,
          }),
        }),
      })
    }

    function expectReleased(releaseMs: number) {
      const [filter, update, options] = mockDeviceModel.updateOne.mock.calls[0]
      expect(filter).toEqual({
        _id: deviceId,
        dispatchBusyUntil: { $gt: expect.any(Date) },
      })
      expect(update[0].$set.dispatchBusyUntil.$max[1]).toEqual({
        $subtract: ['$dispatchBusyUntil', releaseMs],
      })
      expect(options).toEqual({ updatePipeline: true, timestamps: false })
    }

    it('pushes a delayed wave to the token the device holds now', async () => {
      deviceWith({ fcmToken: 'rotated-token' })
      const sendEach = jest
        .spyOn(firebaseAdmin.messaging(), 'sendEach')
        .mockResolvedValueOnce({
          successCount: 1,
          failureCount: 0,
          responses: [{ success: true, messageId: 'fcm-1' }],
        } as any)

      await processor.handleSendSms(job)

      expect(sendEach).toHaveBeenCalledWith([
        { ...fcmMessages[0], token: 'rotated-token' },
      ])
    })

    it('gives back the send time of messages whose push failed', async () => {
      deviceWith({ smsSendDelaySeconds: 7 })
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        responses: [{ success: false, error: { code: 'messaging/internal-error' } }],
      } as any)

      await processor.handleSendSms(backlogJob)

      expectReleased(7_000)
    })

    it('gives back the send time of the whole wave when the push throws', async () => {
      jest
        .spyOn(firebaseAdmin.messaging(), 'sendEach')
        .mockRejectedValueOnce(new Error('fcm down'))

      await expect(processor.handleSendSms(backlogJob)).rejects.toThrow('fcm down')

      expectReleased(5_000)
    })

    it('leaves the backlog alone when every push succeeds', async () => {
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValueOnce({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true, messageId: 'fcm-1' }],
      } as any)

      await processor.handleSendSms(backlogJob)

      expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
    })

    it('leaves the backlog alone for a job that was not counted in it', async () => {
      jest
        .spyOn(firebaseAdmin.messaging(), 'sendEach')
        .mockRejectedValueOnce(new Error('fcm down'))

      await expect(processor.handleSendSms(job)).rejects.toThrow('fcm down')

      expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
    })

    it('still records the failure when the backlog update fails', async () => {
      mockDeviceModel.updateOne.mockRejectedValueOnce(new Error('write failed'))
      jest
        .spyOn(firebaseAdmin.messaging(), 'sendEach')
        .mockRejectedValueOnce(new Error('fcm down'))

      await expect(processor.handleSendSms(backlogJob)).rejects.toThrow('fcm down')

      expect(mockSmsModel.updateMany).toHaveBeenCalled()
    })
  })
})
