import { Types } from 'mongoose'
import { loadSmsPermissionStatus } from './sms-permission-status'

const USER_ID = new Types.ObjectId()
const DEVICE_ID = new Types.ObjectId()
const NOW = new Date('2026-09-27T12:00:00.000Z')
const FAILED_AT = new Date('2026-09-27T09:30:00.000Z')

const chain = (result: any) => {
  const node: any = {}
  node.sort = jest.fn().mockReturnValue(node)
  node.select = jest.fn().mockReturnValue(node)
  node.lean = jest.fn().mockResolvedValue(result)
  return node
}

const models = (lastSent: any, device: any = null) => {
  const lastChain = chain(lastSent)
  const smsModel: any = { findOne: jest.fn().mockReturnValue(lastChain) }
  const deviceModel: any = { findById: jest.fn().mockReturnValue(chain(device)) }
  return { smsModel, deviceModel, lastChain }
}

describe('loadSmsPermissionStatus', () => {
  it('reports a blocked account with its device', async () => {
    const m = models(
      {
        status: 'failed',
        errorCode: 'PERMISSION_DENIED',
        failedAt: FAILED_AT,
        device: DEVICE_ID,
      },
      { brand: 'samsung', model: 'SM-A166U', appStateInfo: {} },
    )

    const status = await loadSmsPermissionStatus(
      m.smsModel,
      m.deviceModel,
      USER_ID,
      NOW,
    )

    expect(m.smsModel.findOne).toHaveBeenCalledWith({
      user: USER_ID,
      type: 'SENT',
    })
    expect(m.lastChain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 })
    expect(status).toEqual({
      needsSmsPermission: true,
      hoursSinceFailure: 2,
      deviceId: String(DEVICE_ID),
      deviceName: 'samsung SM-A166U',
      failedAt: FAILED_AT,
    })
  })

  it('reports the server time of the failure, not the phone clock', async () => {
    const reportedAt = new Date('2026-09-27T09:31:00.000Z')
    const m = models(
      {
        status: 'failed',
        errorCode: 'PERMISSION_DENIED',
        failedAt: new Date('2026-09-27T20:30:00.000Z'),
        updatedAt: reportedAt,
        device: DEVICE_ID,
      },
      {},
    )

    const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

    expect(status.failedAt).toEqual(reportedAt)
    expect(status.hoursSinceFailure).toBe(2)
  })

  it('prefers the device name the user gave', async () => {
    const m = models(
      { status: 'failed', errorCode: 'PERMISSION_DENIED', failedAt: FAILED_AT, device: DEVICE_ID },
      { name: 'Office phone', brand: 'samsung', model: 'SM-A166U' },
    )

    const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

    expect(status.deviceName).toBe('Office phone')
  })

  it('returns nulls once a later message worked', async () => {
    const m = models({ status: 'sent', device: DEVICE_ID })

    const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

    expect(m.deviceModel.findById).not.toHaveBeenCalled()
    expect(status).toEqual({
      needsSmsPermission: false,
      hoursSinceFailure: null,
      deviceId: null,
      deviceName: null,
      failedAt: null,
    })
  })

  it('does not block on a device that was removed', async () => {
    const m = models(
      { status: 'failed', errorCode: 'PERMISSION_DENIED', failedAt: FAILED_AT, device: DEVICE_ID },
      null,
    )

    const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

    expect(status.needsSmsPermission).toBe(false)
  })

  it('returns null for an account that never sent', async () => {
    const m = models(null)

    const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

    expect(status.needsSmsPermission).toBeNull()
  })
})
