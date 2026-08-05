import { Job } from 'bull'
import * as firebaseAdmin from 'firebase-admin'
import { SmsQueueProcessor } from './sms-queue.processor'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({
    sendEach: jest.fn(),
  }),
}))

describe('SmsQueueProcessor', () => {
  it('waits for the batch to enter processing before sending messages', async () => {
    let releaseProcessing: (() => void) | undefined
    const processingComplete = new Promise<void>((resolve) => {
      releaseProcessing = resolve
    })
    const sendEach = jest
      .spyOn(firebaseAdmin.messaging(), 'sendEach')
      .mockResolvedValue({
        responses: [],
        successCount: 0,
        failureCount: 0,
      })

    const smsBatchModel = {
      findByIdAndUpdate: jest.fn((_, update, options) => {
        if (update.$set?.status === 'processing') {
          return { exec: () => processingComplete }
        }
        if (options?.returnDocument === 'after') {
          return Promise.resolve({
            successCount: 0,
            failureCount: 0,
            recipientCount: 1,
          })
        }
        return Promise.resolve({})
      }),
    }
    const deviceModel = {
      findById: jest.fn(() => ({
        populate: () => ({ exec: jest.fn().mockResolvedValue(null) }),
      })),
      findByIdAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({}),
      })),
    }
    const smsModel = {
      updateMany: jest.fn(),
      find: jest.fn(),
    }
    const webhookService = { deliverNotification: jest.fn() }
    const processor = new SmsQueueProcessor(
      deviceModel as any,
      smsModel as any,
      smsBatchModel as any,
      webhookService as any,
    )

    const handling = processor.handleSendSms({
      id: 'job-1',
      data: { deviceId: 'device-1', fcmMessages: [], smsBatchId: 'batch-1' },
    } as unknown as Job<any>)

    await new Promise((resolve) => setImmediate(resolve))
    expect(sendEach).not.toHaveBeenCalled()

    releaseProcessing!()
    await handling

    expect(smsBatchModel.findByIdAndUpdate).toHaveBeenCalledWith('batch-1', {
      $set: { status: 'processing' },
    })
    expect(sendEach).toHaveBeenCalledWith([])
  })
})
