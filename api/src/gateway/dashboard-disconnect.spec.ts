import { Types } from 'mongoose'
import { AuthService } from '../auth/auth.service'
import { GatewayService } from './gateway.service'
import { InMemoryModel, Row } from '../../test/in-memory-model'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({ sendEach: jest.fn() }),
}))

// The dashboard's Disconnect phone revokes a phone sign-in key; the device of
// that key is turned off as by the app's own disconnect. On in-memory
// collections with the real AuthService key methods.

describe('dashboard disconnect', () => {
  let devices: InMemoryModel
  let apiKeys: InMemoryModel
  let sms: InMemoryModel
  let auth: AuthService
  let gateway: GatewayService
  let billing: { getUserLimits: jest.Mock; notifyDeviceLimitReached: jest.Mock }
  let batchStatus: { refresh: jest.Mock }
  let userId: Types.ObjectId
  let device: Row
  let key: Row

  const signInKey = (deviceId = device._id, user = userId) =>
    apiKeys.seed({ user, source: 'device-link', linkedDevice: deviceId, revokedAt: null })
  const handMadeKey = () => apiKeys.seed({ user: userId, revokedAt: null })
  const revoke = async (row: Row) => {
    row.revokedAt = new Date()
    await gateway.disconnectRevokedSignInKey(row as any)
  }

  beforeEach(() => {
    devices = new InMemoryModel()
    apiKeys = new InMemoryModel()
    sms = new InMemoryModel()
    userId = new Types.ObjectId()
    device = devices.seed({
      user: userId,
      enabled: true,
      fcmToken: 'push',
      ownerInstallId: 'install-a',
      brand: 'Google',
      model: 'Pixel 8',
    })
    key = signInKey()
    device.apiKey = key._id
    billing = {
      getUserLimits: jest.fn().mockResolvedValue({ deviceLimit: -1 }),
      notifyDeviceLimitReached: jest.fn().mockResolvedValue(undefined),
    }
    batchStatus = { refresh: jest.fn() }
    const none = {} as any
    auth = new AuthService(
      none,
      { refreshQuietly: jest.fn() } as any,
      none,
      apiKeys as any,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      devices as any,
    )
    gateway = new GatewayService(
      devices as any,
      none,
      sms as any,
      none,
      none,
      auth,
      none,
      billing as any,
      none,
      none,
      { refreshQuietly: jest.fn() } as any,
      batchStatus as any,
      none,
    )
  })

  describe('revoking a sign-in key', () => {
    it('turns the device off, removes its push address, fails its waiting messages and records why', async () => {
      const batch = new Types.ObjectId()
      sms.seed({ device: device._id, status: 'pending', smsBatch: batch })
      const failed = jest.spyOn(sms, 'updateMany')

      await revoke(key)

      expect(device.enabled).toBe(false)
      expect(device.fcmToken).toBeUndefined()
      expect(device.ownerInstallId).toBeUndefined()
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
      expect(device.turnedOffAt).toBeInstanceOf(Date)
      expect(failed).toHaveBeenCalledWith(
        { device: device._id, status: 'pending' },
        expect.anything(),
        expect.anything(),
      )
      expect(batchStatus.refresh).toHaveBeenCalledWith([batch])
    })

    it('changes nothing when the device uses another live key', async () => {
      const other = handMadeKey()
      device.apiKey = other._id
      await revoke(key)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push' })
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('turns the device off when the key it used last is revoked too', async () => {
      const other = handMadeKey()
      other.revokedAt = new Date()
      device.apiKey = other._id
      await revoke(key)
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('changes nothing when another live sign-in key is tied to the device', async () => {
      signInKey()
      await revoke(key)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push' })
    })

    it('changes nothing on a device of another account', async () => {
      const otherUser = new Types.ObjectId()
      const foreign = signInKey(device._id, otherUser)
      device.apiKey = foreign._id
      await revoke(foreign)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push' })
    })

    it('leaves a device the user turned off alone, without a record', async () => {
      device.enabled = false
      await revoke(key)
      expect(device.fcmToken).toBe('push')
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('does nothing for a hand-made key', async () => {
      const handMade = handMadeKey()
      device.apiKey = handMade._id
      await revoke(handMade)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push' })
    })
  })

  describe('the record', () => {
    beforeEach(async () => {
      await revoke(key)
    })

    it('is cleared when the user turns the device on with the switch', async () => {
      await gateway.updateDevice(String(device._id), { enabled: true } as any)
      expect(device.enabled).toBe(true)
      expect(device.turnedOffBy).toBeUndefined()
      expect(device.turnedOffAt).toBeUndefined()
    })

    it('is cleared when the device is turned off another way', async () => {
      await gateway.updateDevice(String(device._id), { enabled: false } as any)
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('is cleared when a phone connects by sign-in and the approval kept it off', async () => {
      const next = signInKey()
      await gateway.updateDevice(String(device._id), { fcmToken: 'push-2' } as any, {
        apiKeyId: next._id,
      })
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('is cleared by the app disconnect', async () => {
      device.ownerInstallId = 'install-b'
      await gateway.disconnectDevice(String(device._id), undefined, { installId: 'install-b' })
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('stays through an update that does not set enabled', async () => {
      await gateway.updateDevice(String(device._id), { name: 'Office phone' } as any)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })
  })

  describe('a new working key on an old build', () => {
    beforeEach(async () => {
      await revoke(key)
    })

    const reportPush = (handMade = true) =>
      gateway.updateDevice(String(device._id), { fcmToken: 'push-2' } as any, {
        handMadeKey: handMade,
      })

    it('turns the device on again and clears the record', async () => {
      await reportPush()
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push-2' })
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('leaves the device off and keeps the record over the device limit', async () => {
      billing.getUserLimits.mockResolvedValue({ deviceLimit: 1 })
      devices.seed({ user: userId, enabled: true })
      await expect(reportPush()).resolves.toBeTruthy()
      expect(device).toMatchObject({ enabled: false, fcmToken: 'push-2' })
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
      expect(billing.notifyDeviceLimitReached).not.toHaveBeenCalled()
    })

    it('turns the device on within the limit', async () => {
      billing.getUserLimits.mockResolvedValue({ deviceLimit: 1 })
      await reportPush()
      expect(device.enabled).toBe(true)
    })

    it('needs a key: a dashboard login changes nothing', async () => {
      await reportPush(false)
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('needs the push address', async () => {
      await gateway.updateDevice(String(device._id), { appVersionCode: 20 } as any, {
        handMadeKey: true,
      })
      expect(device.enabled).toBe(false)
    })

    it('keeps an explicit off', async () => {
      await gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-2', enabled: false } as any,
        { handMadeKey: true },
      )
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('leaves a device the user turned off alone', async () => {
      device.turnedOffBy = undefined
      await reportPush()
      expect(device.enabled).toBe(false)
    })
  })
})
