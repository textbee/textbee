import { SmsQueueProcessor } from './sms-queue.processor'
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
          filter: { _id: 'sms-1', status: { $nin: ['sent', 'delivered'] } },
          update: {
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
    expect(writes[0].updateOne.update.$set).toEqual(
      expect.objectContaining({
        status: 'failed',
        errorCode: 'FCM_TOKEN_NOT_REGISTERED',
      }),
    )
    expect(writes[0].updateOne.update.$inc).toEqual({ dispatchAttempts: 1 })
    const history = writes[0].updateOne.update.$push['metadata.errorHistory']
    expect(history.$slice).toBe(-5)
    expect(history.$each[0]).toEqual(
      expect.objectContaining({
        code: 'FCM_TOKEN_NOT_REGISTERED',
        source: 'fcm',
      }),
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

  it('withholds the push for a listed user and marks the message', async () => {
    process.env.FCM_SEND_SKIP_USER_IDS = userId
    const sendEach = jest.spyOn(firebaseAdmin.messaging(), 'sendEach')

    const response = await processor.handleSendSms(job)

    expect(sendEach).not.toHaveBeenCalled()
    expect(response.successCount).toBe(1)
    const [writes] = mockSmsModel.bulkWrite.mock.calls[0]
    // A phone report that landed first is not overwritten
    expect(writes[0].updateOne.filter.status).toEqual({ $nin: ['sent', 'delivered'] })
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
})
