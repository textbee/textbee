import { Types } from 'mongoose'
import { AuthService } from '../auth/auth.service'
import { serverHash } from '../device-links/device-link-input'
import { GatewayService } from './gateway.service'
import { InMemoryModel, Row } from '../../test/in-memory-model'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({ sendEach: jest.fn() }),
}))

// Connect completion racing another completion, a disconnect and a repeat,
// on in-memory collections with the real AuthService key methods.

const phoneA = { installId: 'install-a', phoneId: 'a'.repeat(64), phoneSigner: 's'.repeat(64) }
const phoneB = { installId: 'install-b', phoneId: 'b'.repeat(64), phoneSigner: 's'.repeat(64) }

describe('connect completion races', () => {
  let devices: InMemoryModel
  let links: InMemoryModel
  let apiKeys: InMemoryModel
  let auth: AuthService
  let gateway: GatewayService
  let userId: Types.ObjectId
  let device: Row
  const env = { ...process.env }

  beforeEach(() => {
    process.env = { ...env, DEVICE_LINK_SECRET: 'test-secret' }
    devices = new InMemoryModel()
    links = new InMemoryModel()
    apiKeys = new InMemoryModel()
    userId = new Types.ObjectId()
    device = devices.seed({ user: userId, enabled: true, fcmToken: 'push', brand: 'Google', model: 'Pixel 8' })
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
      { distinct: async () => [], updateMany: async () => ({}) } as any,
      none,
      none,
      auth,
      none,
      none,
      none,
      none,
      { refreshQuietly: jest.fn() } as any,
      { refresh: jest.fn() } as any,
      links as any,
    )
  })

  afterEach(() => {
    process.env = { ...env }
  })

  // A delivered request for the device, and the key that the phone holds
  const delivered = async (phone = phoneA) => {
    const link = links.seed({
      status: 'delivered',
      user: userId,
      deviceId: device._id,
      phoneId: serverHash('phone', phone.phoneId),
    })
    const key = await auth.createSignInKey(userId, device._id, 'Phone sign-in: Pixel 8', link._id)
    link.apiKeyId = key.id
    return { link, key: apiKeys.rows.find((row) => String(row._id) === String(key.id))! }
  }
  // As the update route: the device names the request's key, then the connect completes
  const complete = (key: Row, phone = phoneA) => {
    device.apiKey = key._id
    return gateway.completeSignInConnect(String(device._id), key as any, phone)
  }
  const live = () => apiKeys.rows.filter((row) => !row.revokedAt).map((row) => String(row._id))

  it('two phones completing one device at once: the newer connect wins', async () => {
    const a = await delivered(phoneA)
    const b = await delivered(phoneB)
    await Promise.all([complete(a.key, phoneA), complete(b.key, phoneB)])
    expect(live()).toEqual([String(b.key._id)])
    expect(b.link.status).toBe('completed')
  })

  it('the older connect completing first is replaced by the newer one', async () => {
    const a = await delivered(phoneA)
    const b = await delivered(phoneB)
    await complete(a.key, phoneA)
    await complete(b.key, phoneB)
    expect(live()).toEqual([String(b.key._id)])
    expect(device).toMatchObject({ phoneId: serverHash('phone', phoneB.phoneId), phoneIdSource: 'sign-in' })
    expect([a.link.status, b.link.status]).toEqual(['completed', 'completed'])
  })

  it('the older connect completing last changes nothing', async () => {
    const a = await delivered(phoneA)
    const b = await delivered(phoneB)
    await complete(b.key, phoneB)
    await complete(a.key, phoneA)
    expect(live()).toEqual([String(b.key._id)])
    expect(device.phoneId).toBe(serverHash('phone', phoneB.phoneId))
    expect(a.link.status).toBe('delivered')
  })

  it('completion, then disconnect: the device is off and the key revoked', async () => {
    const a = await delivered()
    await complete(a.key)
    await gateway.disconnectDevice(String(device._id), a.key as any, phoneA)
    expect(device.enabled).toBe(false)
    expect(device.fcmToken).toBeUndefined()
    expect(live()).toEqual([])
  })

  it('disconnect, then a late completion: nothing is recorded for the gone phone', async () => {
    const a = await delivered()
    await gateway.disconnectDevice(String(device._id), a.key as any, phoneA)
    await complete(a.key)
    expect(device.enabled).toBe(false)
    expect(device.phoneId).toBeUndefined()
    expect(a.link.status).toBe('delivered')
    expect(live()).toEqual([])
  })

  it('completion and disconnect at once: the device ends off and the key revoked', async () => {
    const a = await delivered()
    await Promise.all([
      complete(a.key),
      gateway.disconnectDevice(String(device._id), a.key as any, phoneA),
    ])
    expect(device.enabled).toBe(false)
    expect(live()).toEqual([])
  })

  it('a completion with a key a repeat replaced stops, and the new key completes', async () => {
    const a = await delivered()
    // A repeat revokes the key it gave before and hands out a new one
    await auth.revokeApiKeyIfLive(a.key._id)
    const fresh = await auth.createSignInKey(userId, device._id, 'Phone sign-in: Pixel 8', a.link._id)
    a.link.apiKeyId = fresh.id
    const freshKey = apiKeys.rows.find((row) => String(row._id) === String(fresh.id))!

    await complete(a.key)
    expect(a.link.status).toBe('delivered')
    expect(device.phoneId).toBeUndefined()

    await complete(freshKey)
    expect(a.link.status).toBe('completed')
    expect(device.phoneIdSource).toBe('sign-in')
    expect(live()).toEqual([String(fresh.id)])
  })

  it('a completion with other phone headers than the request had gets no sign-in mark', async () => {
    const a = await delivered(phoneA)
    await complete(a.key, phoneB)
    expect(device.phoneId).toBeUndefined()
    expect(device.phoneIdSource).toBeUndefined()
    expect(a.link.status).toBe('completed')
  })

  it('a completion revokes a stray key of the same request, even a newer one', async () => {
    const a = await delivered()
    const stray = await auth.createSignInKey(userId, device._id, 'Phone sign-in: Pixel 8', a.link._id)
    await complete(a.key)
    expect(live()).toEqual([String(a.key._id)])
    expect(live()).not.toContain(String(stray.id))
  })

  it('a normal reconnect keeps the sign-in mark, a disconnect lowers it', async () => {
    const a = await delivered(phoneA)
    await complete(a.key, phoneA)
    const b = await delivered(phoneA)
    await complete(b.key, phoneA)
    expect(device.phoneIdSource).toBe('sign-in')
    await gateway.disconnectDevice(String(device._id), b.key as any, phoneA)
    expect(device.phoneIdSource).toBe('heartbeat')
    expect(device.phoneId).toBe(serverHash('phone', phoneA.phoneId))
  })

  it('keys made in the same millisecond are ordered by id', async () => {
    const a = await delivered()
    const b = await delivered()
    const sameTime = new Date('2026-11-26T12:00:00.000Z')
    a.key.createdAt = sameTime
    b.key.createdAt = sameTime
    const [older, newer] = [a.key, b.key].sort((x, y) => String(x._id).localeCompare(String(y._id)))
    await auth.revokeOtherSignInKeys(device._id, newer._id)
    expect(older.revokedAt).toBeInstanceOf(Date)
    await auth.revokeOtherSignInKeys(device._id, older._id)
    expect(newer.revokedAt).toBeUndefined()
  })

  it('an older completion that passed its key check cannot overwrite a newer identity', async () => {
    const a = await delivered(phoneA)
    const b = await delivered(phoneB)
    // A's update and its key check run; A then pauses before its identity write
    device.apiKey = a.key._id
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realLive = auth.isKeyLive.bind(auth)
    let paused = false
    jest.spyOn(auth, 'isKeyLive').mockImplementation(async (id) => {
      const live = await realLive(id)
      if (!paused && String(id) === String(a.key._id)) {
        paused = true
        await gate
      }
      return live
    })
    const first = gateway.completeSignInConnect(String(device._id), a.key as any, phoneA)
    while (!paused) await new Promise((resolve) => setImmediate(resolve))
    // B's update records its key, and B completes
    await complete(b.key, phoneB)
    release()
    await first
    expect(device.phoneId).toBe(serverHash('phone', phoneB.phoneId))
    expect(device.apiKey).toBe(b.key._id)
    expect(a.link.status).toBe('delivered')
    expect(live()).toEqual([String(b.key._id)])
  })

  it('a disconnect changes nothing when another install took the device over after the read', async () => {
    const a = await delivered()
    device.ownerInstallId = phoneA.installId
    // The disconnect reads install A as the owner; then, before its write,
    // another install's update takes the device
    const realFindById = devices.findById.bind(devices)
    jest.spyOn(devices, 'findById').mockImplementationOnce(
      (id: unknown) =>
        ({
          lean: async () => {
            const read = await realFindById(id).lean()
            expect(read.ownerInstallId).toBe(phoneA.installId)
            device.ownerInstallId = 'install-other'
            return read
          },
        }) as any,
    )
    await gateway.disconnectDevice(String(device._id), a.key as any, phoneA)
    expect(device.enabled).toBe(true)
    expect(device.fcmToken).toBe('push')
    expect(device.ownerInstallId).toBe('install-other')
    expect(live()).toEqual([])
  })

  it('a newer sign-in that completes during a disconnect keeps its phone id mark', async () => {
    const a = await delivered(phoneA)
    await complete(a.key, phoneA)
    expect(device.phoneIdSource).toBe('sign-in')
    const b = await delivered(phoneB)
    // After the disconnect of A turned the device off, B's update and completion run
    const realRevoke = auth.revokeApiKeyIfLive.bind(auth)
    jest.spyOn(auth, 'revokeApiKeyIfLive').mockImplementationOnce(async (id) => {
      await complete(b.key, phoneB)
      return realRevoke(id)
    })
    await gateway.disconnectDevice(String(device._id), a.key as any, phoneA)
    expect(b.link.status).toBe('completed')
    expect(device).toMatchObject({
      apiKey: b.key._id,
      phoneId: serverHash('phone', phoneB.phoneId),
      phoneIdSource: 'sign-in',
    })
  })

  it('a disconnect lowers the phone id mark of its own sign-in', async () => {
    const a = await delivered(phoneA)
    await complete(a.key, phoneA)
    await gateway.disconnectDevice(String(device._id), a.key as any, phoneA)
    expect(device.phoneIdSource).toBe('heartbeat')
  })

  describe('default device asked for at approval', () => {
    const defaults = () => devices.rows.filter((row) => row.isDefault === true).map((row) => String(row._id))
    const ask = (link: Row, fields: Row = { action: 'new', makeDefault: true }) => Object.assign(link, fields)

    it('a completion makes the device the default with the set-default writes', async () => {
      const old = devices.seed({ user: userId, enabled: true, isDefault: true })
      const a = await delivered()
      ask(a.link)
      const clear = jest.spyOn(devices, 'updateMany')
      const set = jest.spyOn(devices, 'findByIdAndUpdate')
      await complete(a.key)
      expect(a.link.status).toBe('completed')
      expect(defaults()).toEqual([String(device._id)])
      expect(old.isDefault).toBe(false)
      expect(clear).toHaveBeenCalledWith(
        { user: userId, _id: { $ne: device._id }, isDefault: true },
        { $set: { isDefault: false } },
      )
      expect(set.mock.calls).toEqual([
        [device._id, { $set: { isDefault: true } }, { returnDocument: 'after' }],
      ])
    })

    it('runs once: a second update with the same key changes no default', async () => {
      devices.seed({ user: userId, enabled: true, isDefault: true })
      const a = await delivered()
      ask(a.link)
      await complete(a.key)
      // The user picks another default afterwards
      const picked = devices.seed({ user: userId, enabled: true, isDefault: true })
      device.isDefault = false
      await complete(a.key)
      expect(defaults()).toEqual([String(picked._id)])
    })

    it('a completion that lost its race sets no default', async () => {
      const old = devices.seed({ user: userId, enabled: true, isDefault: true })
      const a = await delivered(phoneA)
      const b = await delivered(phoneB)
      ask(a.link)
      await complete(b.key, phoneB)
      await complete(a.key, phoneA)
      expect(a.link.status).toBe('delivered')
      expect(defaults()).toEqual([String(old._id)])
    })

    it.each([
      ['without the flag', { action: 'new' }],
      ['with the flag false', { action: 'new', makeDefault: false }],
      ['for a reconnect', { action: 'reconnect', makeDefault: true }],
    ])('changes no default %s', async (_label, fields) => {
      const old = devices.seed({ user: userId, enabled: true, isDefault: true })
      const a = await delivered()
      ask(a.link, fields)
      const set = jest.spyOn(devices, 'findByIdAndUpdate')
      await complete(a.key)
      expect(a.link.status).toBe('completed')
      expect(defaults()).toEqual([String(old._id)])
      expect(set).not.toHaveBeenCalled()
    })

    it('a first device ignores the flag and stays the default', async () => {
      device.isDefault = true
      const a = await delivered()
      ask(a.link)
      const set = jest.spyOn(devices, 'findByIdAndUpdate')
      await complete(a.key)
      expect(defaults()).toEqual([String(device._id)])
      expect(set).not.toHaveBeenCalled()
    })
  })

  it('a completion moves the phone id off another device of the account', async () => {
    const other = devices.seed({
      user: userId,
      phoneId: serverHash('phone', phoneA.phoneId),
      phoneSigner: phoneA.phoneSigner,
      phoneIdSource: 'heartbeat',
    })
    const a = await delivered()
    await complete(a.key)
    expect(other).not.toHaveProperty('phoneId')
    expect(other).not.toHaveProperty('phoneIdSource')
    expect(device.phoneIdSource).toBe('sign-in')
  })
})
