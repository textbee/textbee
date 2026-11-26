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
  const complete = (key: Row, phone = phoneA) =>
    gateway.completeSignInConnect(String(device._id), key as any, phone)
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
