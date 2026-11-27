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
    let handMade: Row
    beforeEach(async () => {
      await revoke(key)
      handMade = handMadeKey()
    })

    // The app reports its push address; install-a owned the device at the disconnect
    const reportPush = ({
      keyId = handMade._id as unknown,
      header = 'install-a' as string | null,
      body = undefined as string | undefined,
    } = {}) =>
      gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-2', ...(body && { installId: body }) } as any,
        { requestKeyId: (keyId ?? undefined) as any, phone: header ? { installId: header } : {} },
      )

    it('records why, which key and which install at the disconnect', () => {
      expect(device).toMatchObject({
        turnedOffBy: 'dashboard-disconnect',
        turnedOffInstallId: 'install-a',
      })
      expect(String(device.turnedOffKeyId)).toBe(String(key._id))
    })

    it('turns the device on again for the same install and clears the record', async () => {
      await reportPush()
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push-2' })
      expect(device.turnedOffBy).toBeUndefined()
      expect(device.turnedOffInstallId).toBeUndefined()
      expect(device.turnedOffKeyId).toBeUndefined()
    })

    it('reads the install id from the body for builds that send it there', async () => {
      await reportPush({ header: null, body: 'install-a' })
      expect(device.enabled).toBe(true)
    })

    it('leaves the device off for another install, keeps the record and takes nothing from it', async () => {
      await reportPush({ header: 'install-b', body: 'install-b' })
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
      // So a later switch-on in the dashboard does not send to install-b
      expect(device.fcmToken).toBeUndefined()
      expect(device.pushInstallId).toBeUndefined()
      expect(device.ownerInstallId).toBeUndefined()
      expect(String(device.apiKey)).toBe(String(key._id))
    })

    it('takes nothing from a build that sends no install id either', async () => {
      await reportPush({ header: null })
      expect(device.fcmToken).toBeUndefined()
      expect(String(device.apiKey)).toBe(String(key._id))
    })

    it('still takes other facts of another install, such as its app version', async () => {
      await gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-2', appVersionName: '2.10.0' } as any,
        { requestKeyId: handMade._id, phone: { installId: 'install-b' } },
      )
      expect(device.appVersionName).toBe('2.10.0')
      expect(device.fcmToken).toBeUndefined()
    })

    it('lets another install turn the device on explicitly, as the user asked', async () => {
      await gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-2', enabled: true } as any,
        { requestKeyId: handMade._id, phone: { installId: 'install-b' } },
      )
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push-2', ownerInstallId: 'install-b' })
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('leaves the device off for a build that sends no install id', async () => {
      await reportPush({ header: null })
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('turns on for any install when no owner was known at the disconnect', async () => {
      delete device.turnedOffInstallId
      await reportPush({ header: null })
      expect(device.enabled).toBe(true)
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
      await reportPush({ keyId: null })
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('needs the push address', async () => {
      await gateway.updateDevice(String(device._id), { appVersionCode: 20 } as any, {
        requestKeyId: handMade._id,
        phone: { installId: 'install-a' },
      })
      expect(device.enabled).toBe(false)
    })

    it('keeps an explicit off', async () => {
      await gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-2', enabled: false } as any,
        { requestKeyId: handMade._id, phone: { installId: 'install-a' } },
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

  describe('a late call of the revoked key', () => {
    beforeEach(async () => {
      await revoke(key)
    })

    it('does not put its push address back', async () => {
      const answer = await gateway.updateDevice(
        String(device._id),
        { fcmToken: 'push-late' } as any,
        { apiKeyId: key._id, requestKeyId: key._id, phone: { installId: 'install-a' } },
      )
      expect(answer).toBeNull()
      expect(device.fcmToken).toBeUndefined()
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('does not let a late in-app toggle of the revoked key turn the device on', async () => {
      const answer = await gateway.updateDevice(String(device._id), { enabled: true } as any, {
        apiKeyId: key._id,
        requestKeyId: key._id,
      })
      expect(answer).toBeNull()
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })

    it('does not stop a new sign-in key of the device', async () => {
      const next = signInKey()
      await gateway.updateDevice(String(device._id), { fcmToken: 'push-2' } as any, {
        apiKeyId: next._id,
        requestKeyId: next._id,
      })
      expect(device.fcmToken).toBe('push-2')
      expect(device.turnedOffBy).toBeUndefined()
    })
  })

  describe('the key the device uses', () => {
    it('records a hand-made key the app reports its push address with', async () => {
      const handMade = handMadeKey()
      await gateway.updateDevice(String(device._id), { fcmToken: 'push-2' } as any, {
        requestKeyId: handMade._id,
        phone: { installId: 'install-a' },
      })
      expect(String(device.apiKey)).toBe(String(handMade._id))
      // The sign-in key is still live; revoking it leaves the device in use with the new key
      await revoke(key)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push-2' })
    })

    it('does not record the key of a call that only renames the device', async () => {
      const script = handMadeKey()
      await gateway.updateDevice(String(device._id), { name: 'Office' } as any, {
        requestKeyId: script._id,
      })
      expect(String(device.apiKey)).toBe(String(key._id))
    })
  })

  describe('the write guard', () => {
    it('changes nothing when the device takes another key between the read and the write', async () => {
      const other = handMadeKey()
      const read = devices.findOne.bind(devices)
      jest.spyOn(devices, 'findOne').mockImplementationOnce((filter: Row) => {
        const query = read(filter)
        return {
          lean: async () => {
            const row = await query.lean()
            device.apiKey = other._id
            return row
          },
        } as any
      })
      await revoke(key)
      expect(device).toMatchObject({ enabled: true, fcmToken: 'push' })
      expect(device.turnedOffBy).toBeUndefined()
    })

    it('turns off a device that never recorded a key', async () => {
      delete device.apiKey
      await revoke(key)
      expect(device.enabled).toBe(false)
      expect(device.turnedOffBy).toBe('dashboard-disconnect')
    })
  })

  describe('the device list', () => {
    const listed = async () => {
      jest.spyOn(devices, 'find').mockReturnValueOnce(
        Promise.resolve(
          devices.rows.map((row) => ({ ...row, toJSON: () => ({ _id: row._id, enabled: row.enabled }) })),
        ) as any,
      )
      const [first] = await gateway.getDevicesForUser({ _id: userId } as any)
      return first
    }

    it('says when the dashboard disconnected a device that is still off', async () => {
      await revoke(key)
      expect((await listed()).disconnectedAt).toEqual(device.turnedOffAt)
    })

    it('says nothing for a device that is on or turned off by the user', async () => {
      expect(await listed()).not.toHaveProperty('disconnectedAt')
      device.enabled = false
      expect(await listed()).not.toHaveProperty('disconnectedAt')
    })
  })
})
