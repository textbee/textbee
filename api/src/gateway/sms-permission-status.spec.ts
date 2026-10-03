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

const models = (lastSent: any, device: any = null, reporting: any[] = []) => {
  const lastChain = chain(lastSent)
  const smsModel: any = { findOne: jest.fn().mockReturnValue(lastChain) }
  const deviceModel: any = {
    findById: jest.fn().mockReturnValue(chain(device)),
    find: jest.fn().mockReturnValue(chain(reporting)),
  }
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
      source: 'failure',
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
      source: null,
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

  describe('with heartbeat reports', () => {
    const OTHER_DEVICE_ID = new Types.ObjectId()
    const heartbeat = { includeHeartbeat: true }
    const reportingDevice = (id: Types.ObjectId, lastHeartbeat: Date, extra = {}) => ({
      _id: id,
      brand: 'samsung',
      model: 'SM-A166U',
      appStateInfo: { hasSendSmsPermission: false },
      lastHeartbeat,
      ...extra,
    })

    it('flags a phone that reports the permission off before any send', async () => {
      const m = models(null, null, [
        reportingDevice(DEVICE_ID, new Date('2026-09-27T11:00:00.000Z')),
      ])

      const status = await loadSmsPermissionStatus(
        m.smsModel,
        m.deviceModel,
        USER_ID,
        NOW,
        heartbeat,
      )

      expect(m.deviceModel.find).toHaveBeenCalledWith({
        user: USER_ID,
        enabled: true,
        'appStateInfo.hasSendSmsPermission': false,
        lastHeartbeat: { $gte: new Date('2026-09-20T12:00:00.000Z') },
      })
      expect(status).toEqual({
        needsSmsPermission: true,
        hoursSinceFailure: null,
        deviceId: String(DEVICE_ID),
        deviceName: 'samsung SM-A166U',
        failedAt: null,
        source: 'heartbeat',
      })
    })

    it('flags it after a message that worked, naming the latest reporter', async () => {
      const m = models({ status: 'sent', device: DEVICE_ID }, null, [
        reportingDevice(DEVICE_ID, new Date('2026-09-26T11:00:00.000Z')),
        reportingDevice(OTHER_DEVICE_ID, new Date('2026-09-27T11:00:00.000Z'), {
          name: 'Office phone',
        }),
      ])

      const status = await loadSmsPermissionStatus(
        m.smsModel,
        m.deviceModel,
        USER_ID,
        NOW,
        heartbeat,
      )

      expect(status.needsSmsPermission).toBe(true)
      expect(status.source).toBe('heartbeat')
      expect(status.deviceId).toBe(String(OTHER_DEVICE_ID))
      expect(status.deviceName).toBe('Office phone')
    })

    it('ignores a report older than 7 days', async () => {
      // The query filters on lastHeartbeat, so a stale phone is never returned.
      const m = models({ status: 'sent', device: DEVICE_ID }, null, [])

      const status = await loadSmsPermissionStatus(
        m.smsModel,
        m.deviceModel,
        USER_ID,
        NOW,
        heartbeat,
      )

      const query = m.deviceModel.find.mock.calls[0][0]
      const tenDaysAgo = new Date('2026-09-17T12:00:00.000Z')
      expect(tenDaysAgo < query.lastHeartbeat.$gte).toBe(true)
      expect(status).toEqual({
        needsSmsPermission: false,
        hoursSinceFailure: null,
        deviceId: null,
        deviceName: null,
        failedAt: null,
        source: null,
      })
    })

    it('lets the failure path win and skips the device scan', async () => {
      const m = models(
        { status: 'failed', errorCode: 'PERMISSION_DENIED', failedAt: FAILED_AT, device: DEVICE_ID },
        { brand: 'samsung', model: 'SM-A166U', appStateInfo: { hasSendSmsPermission: false } },
        [reportingDevice(OTHER_DEVICE_ID, new Date('2026-09-27T11:00:00.000Z'))],
      )

      const status = await loadSmsPermissionStatus(
        m.smsModel,
        m.deviceModel,
        USER_ID,
        NOW,
        heartbeat,
      )

      expect(m.deviceModel.find).not.toHaveBeenCalled()
      expect(status.source).toBe('failure')
      expect(status.deviceId).toBe(String(DEVICE_ID))
      expect(status.failedAt).toEqual(FAILED_AT)
    })

    it('ignores a report older than a send that worked from that phone', async () => {
      const report = (id: Types.ObjectId) =>
        reportingDevice(id, new Date('2026-09-27T11:00:00.000Z'), {
          appStateInfo: {
            hasSendSmsPermission: false,
            lastUpdated: new Date('2026-09-27T11:00:00.000Z'),
          },
        })
      const sent = {
        status: 'sent',
        device: DEVICE_ID,
        createdAt: new Date('2026-09-27T11:20:00.000Z'),
      }

      const same = models(sent, null, [report(DEVICE_ID)])
      const cleared = await loadSmsPermissionStatus(same.smsModel, same.deviceModel, USER_ID, NOW, heartbeat)
      expect(cleared.needsSmsPermission).toBe(false)
      expect(cleared.source).toBeNull()

      const other = models(sent, null, [report(OTHER_DEVICE_ID)])
      const flagged = await loadSmsPermissionStatus(other.smsModel, other.deviceModel, USER_ID, NOW, heartbeat)
      expect(flagged.source).toBe('heartbeat')
      expect(flagged.deviceId).toBe(String(OTHER_DEVICE_ID))
    })

    it('leaves the heartbeat path off unless asked', async () => {
      const m = models(null, null, [
        reportingDevice(DEVICE_ID, new Date('2026-09-27T11:00:00.000Z')),
      ])

      const status = await loadSmsPermissionStatus(m.smsModel, m.deviceModel, USER_ID, NOW)

      expect(m.deviceModel.find).not.toHaveBeenCalled()
      expect(status.needsSmsPermission).toBeNull()
    })
  })
})
