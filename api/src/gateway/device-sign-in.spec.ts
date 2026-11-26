import { Types } from 'mongoose'
import { GatewayService } from './gateway.service'
import { serverHash } from '../device-links/device-link-input'

jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({ sendEach: jest.fn() }),
}))

// What the device routes record for a phone that signed in, and for the
// headers every newer app build sends.

const USER_ID = new Types.ObjectId('665f1c2ab3d4e5f6a7b8c9a1')
const DEVICE_ID = '665f1c2ab3d4e5f6a7b8c9d0'
const OTHER_DEVICE_ID = '665f1c2ab3d4e5f6a7b8c9d9'
const KEY_ID = new Types.ObjectId('665f1c2ab3d4e5f6a7b8c9e1')
const LINK_ID = new Types.ObjectId('665f1c2ab3d4e5f6a7b8c9f1')
const PHONE = 'a'.repeat(64)
const SIGNER = 'b'.repeat(64)
const headers = { installId: 'install-new', phoneId: PHONE, phoneSigner: SIGNER }

type Call = [string, ...unknown[]]

class Query implements PromiseLike<unknown> {
  constructor(private readonly value: () => unknown) {}
  lean() {
    return this
  }
  select() {
    return this
  }
  sort() {
    return this
  }
  exec() {
    return Promise.resolve(this.value())
  }
  then<A, B>(ok?: (value: unknown) => A | PromiseLike<A>, ko?: (reason: any) => B | PromiseLike<B>) {
    return Promise.resolve(this.value()).then(ok, ko)
  }
}

function model(calls: Call[], handlers: Record<string, (...args: any[]) => unknown> = {}) {
  return new Proxy(
    {},
    {
      get: (_target, method: string) => {
        if (method === 'then') return undefined
        return (...args: unknown[]) => {
          calls.push([method, ...args])
          return new Query(() => (handlers[method] ? handlers[method](...args) : null))
        }
      },
    },
  )
}

describe('device routes and phone sign-in', () => {
  let deviceCalls: Call[]
  let smsCalls: Call[]
  let linkCalls: Call[]
  let stored: Record<string, any>
  let link: Record<string, any> | null
  let authService: Record<string, jest.Mock>
  let rollup: { refreshQuietly: jest.Mock }
  let batchStatus: { refresh: jest.Mock }
  let batchIds: unknown[]
  let service: GatewayService
  const env = { ...process.env }

  const build = () => {
    deviceCalls = []
    smsCalls = []
    linkCalls = []
    const deviceModel = model(deviceCalls, {
      findById: () => (stored ? { ...stored } : null),
      find: () => [],
      findByIdAndUpdate: () => ({ ...stored }),
      findOne: () => null,
      countDocuments: () => 1,
      create: (doc) => ({ _id: new Types.ObjectId(DEVICE_ID), ...doc }),
      updateOne: () => ({ matchedCount: 1 }),
      findByIdAndDelete: () => ({ ...stored }),
    })
    authService = {
      revokeOtherSignInKeys: jest.fn().mockResolvedValue(undefined),
      revokeSignInKeysOfDevice: jest.fn().mockResolvedValue(undefined),
      revokeApiKeyIfLive: jest.fn().mockResolvedValue(undefined),
      getUserApiKeys: jest.fn(),
    }
    rollup = { refreshQuietly: jest.fn() }
    batchStatus = { refresh: jest.fn().mockResolvedValue(undefined) }
    service = new GatewayService(
      deviceModel as any,
      model([], { updateOne: () => ({ upsertedCount: 1 }) }) as any,
      model(smsCalls, { countDocuments: () => 0, distinct: () => batchIds }) as any,
      model([]) as any,
      model([]) as any,
      authService as any,
      {} as any,
      { getUserLimits: jest.fn(async () => ({ deviceLimit: -1 })) } as any,
      { isQueueEnabled: () => false } as any,
      { markMilestone: jest.fn().mockResolvedValue(false) } as any,
      rollup as any,
      batchStatus as any,
      model(linkCalls, { findOne: () => (link ? { ...link } : null) }) as any,
    )
  }

  beforeEach(() => {
    batchIds = []
    process.env = { ...env, DEVICE_LINK_SECRET: 'test-secret' }
    stored = {
      _id: new Types.ObjectId(DEVICE_ID),
      user: USER_ID,
      enabled: true,
      fcmToken: 'push-old',
      appVersionCode: 23,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    }
    link = { _id: LINK_ID, status: 'delivered', deviceId: new Types.ObjectId(DEVICE_ID), user: USER_ID }
    build()
  })

  afterEach(() => {
    process.env = { ...env }
  })

  const lastSet = (method: string) => {
    const call = [...deviceCalls].reverse().find(([name]) => name === method)
    return (call?.[2] as any)?.$set ?? call?.[2]
  }

  describe('owner record', () => {
    it('records the install that sends a push address with its install id header', async () => {
      await service.updateDevice(DEVICE_ID, { fcmToken: 'push-new' } as any, { phone: headers })
      expect(lastSet('findByIdAndUpdate')).toMatchObject({ ownerInstallId: 'install-new' })
    })

    it('records nothing without the header or without a push address', async () => {
      await service.updateDevice(DEVICE_ID, { fcmToken: 'push-new', installId: 'body-id' } as any, {
        phone: {},
      })
      expect(lastSet('findByIdAndUpdate')).not.toHaveProperty('ownerInstallId')
      await service.updateDevice(DEVICE_ID, { name: 'Office' } as any, { phone: headers })
      expect(lastSet('findByIdAndUpdate')).not.toHaveProperty('ownerInstallId')
    })

    it('lets the body install id keep feeding the push owner when the header differs', async () => {
      await service.updateDevice(DEVICE_ID, { fcmToken: 'push-new', installId: 'body-id' } as any, {
        phone: headers,
      })
      expect(lastSet('findByIdAndUpdate')).toMatchObject({
        pushInstallId: 'body-id',
        ownerInstallId: 'install-new',
      })
    })

    it('records the owner of a new registration', async () => {
      await service.registerDevice(
        { fcmToken: 'push-new', model: 'Pixel 8', brand: 'Google' } as any,
        { _id: USER_ID } as any,
        KEY_ID,
        headers,
      )
      const created = deviceCalls.find(([name]) => name === 'create')?.[1] as any
      expect(created.ownerInstallId).toBe('install-new')
    })
  })

  describe('the key of an update', () => {
    it('records a sign-in key on the device', async () => {
      await service.updateDevice(DEVICE_ID, { fcmToken: 'push-new' } as any, { apiKeyId: KEY_ID })
      expect(String(lastSet('findByIdAndUpdate').apiKey)).toBe(String(KEY_ID))
    })

    it('records no key when none is passed, as for a hand-made key', async () => {
      await service.updateDevice(DEVICE_ID, { fcmToken: 'push-new' } as any)
      expect(lastSet('findByIdAndUpdate')).not.toHaveProperty('apiKey')
    })
  })

  describe('connect completed', () => {
    const signInKey = { _id: KEY_ID, linkedDevice: DEVICE_ID, deviceLink: LINK_ID }

    it('moves the phone id here, takes it from the other devices, revokes the other keys and completes the request', async () => {
      await service.completeSignInConnect(DEVICE_ID, signInKey, headers)
      const hash = serverHash('phone', PHONE)
      const setPhone = deviceCalls.find(([name, filter]) => name === 'updateOne' && String((filter as any)._id) === DEVICE_ID)
      expect((setPhone?.[2] as any).$set).toEqual({ phoneId: hash, phoneSigner: SIGNER })
      const unset = deviceCalls.find(([name]) => name === 'updateMany')
      expect(unset?.[1]).toMatchObject({ user: USER_ID, phoneId: hash })
      expect(String((unset?.[1] as any)._id.$ne)).toBe(DEVICE_ID)
      expect(unset?.[2]).toEqual({ $unset: { phoneId: 1, phoneSigner: 1 } })
      expect(authService.revokeOtherSignInKeys).toHaveBeenCalledWith(new Types.ObjectId(DEVICE_ID), KEY_ID)
      const completed = linkCalls.find(([name]) => name === 'updateOne')
      expect(completed?.[1]).toEqual({ _id: LINK_ID, status: 'delivered' })
      expect((completed?.[2] as any).$set.status).toBe('completed')
      expect((completed?.[2] as any).$set.completedAt).toBeInstanceOf(Date)
    })

    it('still completes when the phone sent no phone id', async () => {
      await service.completeSignInConnect(DEVICE_ID, signInKey, { installId: 'install-new' })
      expect(deviceCalls.filter(([name]) => name === 'updateOne' || name === 'updateMany')).toEqual([])
      expect(authService.revokeOtherSignInKeys).toHaveBeenCalled()
      expect(linkCalls.some(([name]) => name === 'updateOne')).toBe(true)
    })

    it('does nothing once the request is completed, or for another device', async () => {
      link = null
      await service.completeSignInConnect(DEVICE_ID, signInKey, headers)
      expect(authService.revokeOtherSignInKeys).not.toHaveBeenCalled()
      link = { _id: LINK_ID, status: 'delivered', deviceId: new Types.ObjectId(OTHER_DEVICE_ID), user: USER_ID }
      await service.completeSignInConnect(DEVICE_ID, signInKey, headers)
      expect(authService.revokeOtherSignInKeys).not.toHaveBeenCalled()
      await service.completeSignInConnect(DEVICE_ID, { ...signInKey, linkedDevice: OTHER_DEVICE_ID }, headers)
      expect(linkCalls).toEqual([
        ['findOne', { _id: LINK_ID, status: 'delivered' }, 'deviceId user'],
        ['findOne', { _id: LINK_ID, status: 'delivered' }, 'deviceId user'],
      ])
    })

    it('never fails the update', async () => {
      authService.revokeOtherSignInKeys.mockRejectedValue(new Error('down'))
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      await expect(service.completeSignInConnect(DEVICE_ID, signInKey, headers)).resolves.toBeUndefined()
    })
  })

  describe('phone id from a heartbeat', () => {
    it('is written only when the device has none, and only with both headers', async () => {
      await service.heartbeat(DEVICE_ID, {} as any, undefined, headers)
      const phoneWrites = () =>
        deviceCalls.filter(([name, filter]) => name === 'updateOne' && 'phoneId' in (filter as any))
      const write = phoneWrites()[0]
      expect(write?.[1]).toEqual({ _id: stored._id, phoneId: { $exists: false } })
      expect((write?.[2] as any).$set).toEqual({ phoneId: serverHash('phone', PHONE), phoneSigner: SIGNER })

      build()
      stored.phoneId = 'older'
      await service.heartbeat(DEVICE_ID, {} as any, undefined, headers)
      expect(phoneWrites()).toEqual([])

      build()
      delete stored.phoneId
      await service.heartbeat(DEVICE_ID, {} as any, undefined, { phoneId: PHONE })
      expect(phoneWrites()).toEqual([])
    })

    it('is not written without a secret for the server hashes', async () => {
      delete process.env.DEVICE_LINK_SECRET
      delete process.env.JWT_SECRET
      await service.heartbeat(DEVICE_ID, {} as any, undefined, headers)
      expect(
        deviceCalls.filter(([name, filter]) => name === 'updateOne' && 'phoneId' in (filter as any)),
      ).toEqual([])
    })
  })

  describe('disconnect', () => {
    const signInKey = { _id: KEY_ID, source: 'device-link' }
    const handMade = { _id: KEY_ID }

    it('turns the device off, drops its push address and owner, fails waiting messages, revokes the sign-in key', async () => {
      stored.ownerInstallId = 'install-new'
      await expect(service.disconnectDevice(DEVICE_ID, signInKey, headers)).resolves.toEqual({
        disconnected: true,
      })
      const write = deviceCalls.find(([name]) => name === 'updateOne')
      expect(write?.[2]).toEqual({
        $set: { enabled: false },
        $unset: {
          fcmToken: 1,
          pushInstallId: 1,
          ownerInstallId: 1,
          dispatchBusyUntil: 1,
          dispatchPriorityBusyUntil: 1,
        },
      })
      const failed = smsCalls.find(([name]) => name === 'updateMany')
      expect(failed?.[1]).toEqual({ device: stored._id, status: 'pending' })
      expect(JSON.stringify(failed?.[2])).toContain('Device disconnected')
      expect(authService.revokeApiKeyIfLive).toHaveBeenCalledWith(KEY_ID)
    })

    it('refreshes the status of the batches whose waiting messages it failed', async () => {
      const batchA = new Types.ObjectId()
      const batchB = new Types.ObjectId()
      batchIds = [batchA, batchB]
      await service.disconnectDevice(DEVICE_ID, { _id: KEY_ID }, {})
      const read = smsCalls.find(([name]) => name === 'distinct')
      expect(read?.slice(1)).toEqual(['smsBatch', { device: stored._id, status: 'pending' }])
      const readAt = smsCalls.indexOf(read!)
      const failAt = smsCalls.findIndex(([name]) => name === 'updateMany')
      expect(readAt).toBeLessThan(failAt)
      expect(batchStatus.refresh).toHaveBeenCalledWith([batchA, batchB])
    })

    it('refreshes no batch when nothing was waiting, and none for another install', async () => {
      await service.disconnectDevice(DEVICE_ID, { _id: KEY_ID }, {})
      stored.ownerInstallId = 'install-owner'
      batchIds = [new Types.ObjectId()]
      await service.disconnectDevice(DEVICE_ID, { _id: KEY_ID }, {})
      expect(batchStatus.refresh).not.toHaveBeenCalled()
    })

    it('disconnects a device without an owner on record', async () => {
      await service.disconnectDevice(DEVICE_ID, handMade, {})
      expect(deviceCalls.some(([name]) => name === 'updateOne')).toBe(true)
      expect(authService.revokeApiKeyIfLive).not.toHaveBeenCalled()
    })

    it('changes nothing on the device for another install, but still revokes a sign-in key', async () => {
      stored.ownerInstallId = 'install-owner'
      await service.disconnectDevice(DEVICE_ID, signInKey, headers)
      await service.disconnectDevice(DEVICE_ID, signInKey, {})
      expect(deviceCalls.some(([name]) => name === 'updateOne')).toBe(false)
      expect(smsCalls.some(([name]) => name === 'updateMany')).toBe(false)
      expect(authService.revokeApiKeyIfLive).toHaveBeenCalledTimes(2)
    })

    it('never revokes a hand-made key', async () => {
      stored.ownerInstallId = 'install-new'
      await service.disconnectDevice(DEVICE_ID, handMade, headers)
      expect(authService.revokeApiKeyIfLive).not.toHaveBeenCalled()
    })

    it('answers 404 for a device that is gone', async () => {
      stored = undefined as any
      await expect(service.disconnectDevice(DEVICE_ID, handMade, headers)).rejects.toMatchObject({
        status: 404,
      })
    })
  })

  describe('calls from another install', () => {
    const owned = () => ({ _id: stored._id, ownerInstallId: 'install-owner' })
    const appCall = (path: string, method = 'POST') => ({
      method,
      route: { path: `/api/v1/gateway/devices/:id${path}` },
      apiKey: { _id: KEY_ID },
    })
    const counted = () => deviceCalls.filter(([name]) => name === 'updateOne')

    it('counts an app call with another or no install id', async () => {
      service.recordOtherInstallCall(owned(), appCall('/heartbeat'), { installId: 'install-other' })
      service.recordOtherInstallCall(owned(), appCall('/receive-sms'), {})
      service.recordOtherInstallCall(owned(), appCall('', 'PATCH'), {})
      expect(counted()).toHaveLength(3)
      expect(counted()[0][2]).toEqual({
        $inc: { 'otherInstallCalls.count': 1 },
        $set: { 'otherInstallCalls.lastAt': expect.any(Date) },
      })
    })

    it('counts nothing for the owner, a device without an owner, a dashboard login or another route', async () => {
      service.recordOtherInstallCall(owned(), appCall('/heartbeat'), { installId: 'install-owner' })
      service.recordOtherInstallCall({ _id: stored._id }, appCall('/heartbeat'), {})
      service.recordOtherInstallCall(owned(), { ...appCall('/heartbeat'), apiKey: undefined }, {})
      service.recordOtherInstallCall(owned(), appCall('/sms/:smsId', 'GET'), {})
      expect(counted()).toHaveLength(0)
    })
  })

  it('revokes the sign-in keys of a deleted device', async () => {
    await service.deleteDevice(DEVICE_ID)
    expect(authService.revokeSignInKeysOfDevice).toHaveBeenCalledWith(new Types.ObjectId(DEVICE_ID))
  })

  it('counts only hand-made keys in the account totals', async () => {
    authService.getUserApiKeys.mockResolvedValue([
      { _id: 1 },
      { _id: 2, source: 'device-link' },
      { _id: 3 },
    ])
    deviceCalls = []
    const stats = await service.getStatsForUser({ _id: USER_ID } as any)
    expect(stats.totalApiKeyCount).toBe(2)
  })
})
