import { Test, TestingModule } from '@nestjs/testing'
import { GatewayService } from './gateway.service'
import { AuthModule } from '../auth/auth.module'
import { getModelToken } from '@nestjs/mongoose'
import { Device, DeviceDocument } from './schemas/device.schema'
import { DeviceTombstone } from './schemas/device-tombstone.schema'
import { SMS } from './schemas/sms.schema'
import { SMSBatch } from './schemas/sms-batch.schema'
import { AuthService } from '../auth/auth.service'
import { WebhookService } from '../webhook/webhook.service'
import { BillingService } from '../billing/billing.service'
import { SmsQueueService } from './queue/sms-queue.service'
import { Model, Types } from 'mongoose'
import { ConfigModule } from '@nestjs/config'
import { HttpException, HttpStatus } from '@nestjs/common'
import * as firebaseAdmin from 'firebase-admin'
import { SMSType } from './sms-type.enum'
import { WebhookEvent } from '../webhook/webhook-event.enum'
import { RegisterDeviceInputDTO, SendBulkSMSInputDTO, SendSMSInputDTO } from './gateway.dto'
import { decodeCursor } from './cursor'
import { User } from '../users/schemas/user.schema'
import { UserRole } from '../users/user-roles.enum'
import { BatchResponse } from 'firebase-admin/messaging'

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({
    sendEach: jest.fn(),
  }),
}))

describe('GatewayService', () => {
  let service: GatewayService
  let deviceModel: Model<DeviceDocument>
  let deviceTombstoneModel: Model<any>
  let smsModel: Model<SMS>
  let smsBatchModel: Model<SMSBatch>
  let authService: AuthService
  let webhookService: WebhookService
  let billingService: BillingService
  let smsQueueService: SmsQueueService

  const mockDeviceModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
    exec: jest.fn(),
    countDocuments: jest.fn(),
  }

  const mockSmsModel = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
    countDocuments: jest.fn(),
  }

  const mockSmsBatchModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  }

  const mockDeviceTombstoneModel = {
    updateOne: jest.fn(),
  }

  const mockAuthService = {
    getUserApiKeys: jest.fn(),
  }

  const mockWebhookService = {
    deliverNotification: jest.fn(),
  }

  const mockBillingService = {
    canPerformAction: jest.fn(),
    getUserLimits: jest.fn(),
    notifyDeviceLimitReached: jest.fn(),
  }

  const singleWavePlan = (count: number, delayMs?: number) => ({
    waves: [{ start: 0, end: count, delayMs: delayMs ?? 0 }],
    sendDelaySeconds: 5,
    projectedCompletionMs: (delayMs ?? 0) + count * 5000,
  })

  const mockSmsQueueService = {
    isQueueEnabled: jest.fn(),
    planSendSmsJob: jest.fn(),
    addSendSmsJob: jest.fn(),
    removeJobs: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        {
          provide: getModelToken(Device.name),
          useValue: mockDeviceModel,
        },
        {
          provide: getModelToken(DeviceTombstone.name),
          useValue: mockDeviceTombstoneModel,
        },
        {
          provide: getModelToken(SMS.name),
          useValue: mockSmsModel,
        },
        {
          provide: getModelToken(SMSBatch.name),
          useValue: mockSmsBatchModel,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: WebhookService,
          useValue: mockWebhookService,
        },
        {
          provide: BillingService,
          useValue: mockBillingService,
        },
        {
          provide: SmsQueueService,
          useValue: mockSmsQueueService,
        },
      ],
      imports: [ConfigModule],
    }).compile()

    service = module.get<GatewayService>(GatewayService)
    deviceModel = module.get<Model<DeviceDocument>>(getModelToken(Device.name))
    deviceTombstoneModel = module.get<Model<any>>(
      getModelToken(DeviceTombstone.name),
    )
    smsModel = module.get<Model<SMS>>(getModelToken(SMS.name))
    smsBatchModel = module.get<Model<SMSBatch>>(getModelToken(SMSBatch.name))
    authService = module.get<AuthService>(AuthService)
    webhookService = module.get<WebhookService>(WebhookService)
    billingService = module.get<BillingService>(BillingService)
    smsQueueService = module.get<SmsQueueService>(SmsQueueService)

    // Reset all mocks
    jest.clearAllMocks()
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('registerDevice', () => {
    const mockUser = { 
      _id: 'user123', 
      name: 'Test User', 
      email: 'test@example.com',
      password: 'password',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    } as unknown as User;
    
    const mockDeviceInput: RegisterDeviceInputDTO = {
      model: 'Pixel 6',
      buildId: 'build123',
      fcmToken: 'token123',
      enabled: true,
    }
    const mockDevice = {
      _id: 'device123',
      ...mockDeviceInput,
      user: mockUser._id,
      // TODO: add more tests for different app version codes
      appVersionCode: 11,
    }

    it('should update device if it already exists', async () => {
      mockDeviceModel.findOne.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({
        ...mockDevice,
        fcmToken: 'updatedToken',
      })

      // The implementation internally uses the _id from the found device to update it
      // So we need to avoid the internal call to updateDevice which is failing in the test
      // by mocking the service method directly and restoring it after the test
      const originalUpdateDevice = service.updateDevice;
      service.updateDevice = jest.fn().mockResolvedValue({
        ...mockDevice,
        fcmToken: 'updatedToken',
      });

      const result = await service.registerDevice(mockDeviceInput, mockUser)

      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        user: mockUser._id,
        model: mockDeviceInput.model,
        buildId: mockDeviceInput.buildId,
      })
      expect(service.updateDevice).toHaveBeenCalledWith(
        mockDevice._id.toString(),
        expect.objectContaining({
          ...mockDeviceInput,
          enabled: true,
          user: mockUser,
          fcmTokenUpdatedAt: expect.any(Date),
          fcmTokenInvalidatedAt: undefined,
          fcmTokenInvalidReason: undefined,
        }),
      )
      expect(result).toBeDefined()
      
      // Restore the original method
      service.updateDevice = originalUpdateDevice;
    })

    it('should create a new device if it does not exist', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockDeviceModel.create.mockResolvedValue(mockDevice)

      const result = await service.registerDevice(mockDeviceInput, mockUser)

      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        user: mockUser._id,
        model: mockDeviceInput.model,
        buildId: mockDeviceInput.buildId,
      })
      expect(mockDeviceModel.create).toHaveBeenCalledWith({
        ...mockDeviceInput,
        user: mockUser,
        fcmTokenUpdatedAt: expect.any(Date),
        fcmTokenInvalidatedAt: undefined,
        fcmTokenInvalidReason: undefined,
      })
      expect(result).toBeDefined()
    })

    it('should default a new device to enabled when the client omits enabled', async () => {
      // 2.8+ clients register without an `enabled` field; the server must
      // still create the device enabled so it works without a manual toggle.
      const inputWithoutEnabled: RegisterDeviceInputDTO = {
        model: 'Pixel 6',
        buildId: 'build123',
        fcmToken: 'token123',
      }
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })

      await service.registerDevice(inputWithoutEnabled, mockUser)

      expect(mockDeviceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      )
    })

    describe('os version normalization', () => {
      const FINGERPRINT =
        'samsung/a13nnxx/a13:14/UP1A.231005.007/A135FXXUAEXL2:user/release-keys'

      beforeEach(() => {
        mockDeviceModel.findOne.mockResolvedValue(null)
        mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
        mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })
      })

      it('derives osVersion from a legacy client sending only BASE_OS', async () => {
        await service.registerDevice(
          { ...mockDeviceInput, os: FINGERPRINT } as RegisterDeviceInputDTO,
          mockUser,
        )

        expect(mockDeviceModel.create).toHaveBeenCalledWith(
          expect.objectContaining({
            os: 'Android',
            osVersion: '14',
            osBuildFingerprint: FINGERPRINT,
          }),
        )
      })

      it('never persists a raw BASE_OS fingerprint in the display field', async () => {
        await service.registerDevice(
          { ...mockDeviceInput, os: FINGERPRINT } as RegisterDeviceInputDTO,
          mockUser,
        )

        const created = mockDeviceModel.create.mock.calls[0][0]
        expect(created.os).toBe('Android')
      })

      it('stores no osVersion when a legacy client reports a blank BASE_OS', async () => {
        await service.registerDevice(
          { ...mockDeviceInput, os: '' } as RegisterDeviceInputDTO,
          mockUser,
        )

        const created = mockDeviceModel.create.mock.calls[0][0]
        expect(created).not.toHaveProperty('osVersion')
        expect(created).not.toHaveProperty('osBuildFingerprint')
      })

      it('passes through the version a current client reports', async () => {
        await service.registerDevice(
          {
            ...mockDeviceInput,
            os: 'Android',
            osVersion: '16',
            osApiLevel: 36,
          } as RegisterDeviceInputDTO,
          mockUser,
        )

        expect(mockDeviceModel.create).toHaveBeenCalledWith(
          expect.objectContaining({ os: 'Android', osVersion: '16', osApiLevel: 36 }),
        )
      })
    })

    it('should block registration when the device limit is already reached', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: 1 })
      mockBillingService.notifyDeviceLimitReached.mockResolvedValue(undefined)
      mockDeviceModel.countDocuments.mockResolvedValue(1)

      await expect(
        service.registerDevice(mockDeviceInput, mockUser),
      ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS })
      expect(mockDeviceModel.create).not.toHaveBeenCalled()
    })

    it('should mark the first device of a user as the default', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.countDocuments.mockResolvedValue(0)
      mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })

      await service.registerDevice(mockDeviceInput, mockUser)

      expect(mockDeviceModel.countDocuments).toHaveBeenCalledWith({
        user: mockUser._id,
      })
      expect(mockDeviceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ isDefault: true }),
      )
    })

    it('should not mark a later device as the default', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.countDocuments.mockResolvedValue(1)
      mockDeviceModel.create.mockResolvedValue({ _id: 'device456' })

      await service.registerDevice(mockDeviceInput, mockUser)

      const created = mockDeviceModel.create.mock.calls[0][0]
      expect(created.isDefault).toBeUndefined()
    })

    it('should ignore a client-sent isDefault', async () => {
      // there is no ValidationPipe, so an unknown body field would otherwise
      // be written straight through to the device
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.countDocuments.mockResolvedValue(1)
      mockDeviceModel.create.mockResolvedValue({ _id: 'device456' })

      await service.registerDevice(
        { ...mockDeviceInput, isDefault: true } as any,
        mockUser,
      )

      const created = mockDeviceModel.create.mock.calls[0][0]
      expect(created.isDefault).toBeUndefined()
    })
  })

  describe('getDevicesForUser', () => {
    const mockUser = { 
      _id: 'user123', 
      name: 'Test User', 
      email: 'test@example.com',
      password: 'password',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    } as unknown as User;
    
    const mockDevices = [
      { _id: 'device1', model: 'Pixel 6' },
      { _id: 'device2', model: 'iPhone 13' },
    ]

    it('should return a user\'s devices without the push token or serial', async () => {
      mockDeviceModel.find.mockResolvedValue(mockDevices)

      const result = await service.getDevicesForUser(mockUser)

      const [filter, projection] = mockDeviceModel.find.mock.calls[0]
      expect(filter).toEqual({ user: mockUser._id })
      // fcmToken is a push credential and serial is a hardware id; neither
      // should be shipped to the browser in the device list.
      expect(projection).toContain('-fcmToken')
      expect(projection).toContain('-serial')
      expect(result).toEqual(mockDevices)
    })
  })

  describe('getDeviceById', () => {
    const mockDevice = { _id: 'device123', model: 'Pixel 6' }

    it('should return device by id', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)

      const result = await service.getDeviceById('device123')

      expect(mockDeviceModel.findById).toHaveBeenCalledWith('device123', undefined)
      expect(result).toEqual(mockDevice)
    })

    it('should apply the given projection', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)

      await service.getDeviceById('device123', undefined, '-fcmToken -serial')

      const [, projection] = mockDeviceModel.findById.mock.calls[0]
      expect(projection).toContain('-fcmToken')
      expect(projection).toContain('-serial')
    })
  })

  // The deviceless send routes have no :id param, so CanModifyDevice cannot
  // run and ownership has to be enforced by the resolution query itself.
  describe('resolveSenderDevice', () => {
    const OWN_DEVICE = '507f1f77bcf86cd799439011'
    const OTHER_DEVICE = '507f1f77bcf86cd799439022'

    const mockUser = {
      _id: 'user123',
      role: UserRole.REGULAR,
    } as unknown as User

    const mockAdmin = {
      _id: 'admin123',
      role: UserRole.ADMIN,
    } as unknown as User

    it('resolves an explicitly requested device the user owns', async () => {
      const device = { _id: OWN_DEVICE, enabled: true, user: mockUser._id }
      mockDeviceModel.findOne.mockResolvedValueOnce(device)

      const result = await service.resolveSenderDevice(mockUser, OWN_DEVICE)

      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(OWN_DEVICE),
        user: mockUser._id,
      })
      expect(result).toEqual(device)
    })

    it('rejects a malformed device id', async () => {
      await expect(
        service.resolveSenderDevice(mockUser, 'not-an-objectid'),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { error: 'Invalid device id' },
      })
      expect(mockDeviceModel.findOne).not.toHaveBeenCalled()
    })

    it('rejects an empty device id instead of falling back to the default', async () => {
      await expect(
        service.resolveSenderDevice(mockUser, ''),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { error: 'Invalid device id' },
      })
      expect(mockDeviceModel.findOne).not.toHaveBeenCalled()
    })

    it('rejects an unknown device id', async () => {
      mockDeviceModel.findOne.mockResolvedValueOnce(null)

      await expect(
        service.resolveSenderDevice(mockUser, OTHER_DEVICE),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { error: 'Device not found' },
      })
    })

    it("rejects another user's device id", async () => {
      // the owner filter is what makes this a miss, so it never leaks
      // whether the device exists
      mockDeviceModel.findOne.mockResolvedValueOnce(null)

      await expect(
        service.resolveSenderDevice(mockUser, OTHER_DEVICE),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND })
      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(OTHER_DEVICE),
        user: mockUser._id,
      })
    })

    it('scopes an admin to their own devices like any other user', async () => {
      mockDeviceModel.findOne.mockResolvedValueOnce(null)

      await expect(
        service.resolveSenderDevice(mockAdmin, OTHER_DEVICE),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND })
      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        _id: new Types.ObjectId(OTHER_DEVICE),
        user: mockAdmin._id,
      })
    })

    it('resolves an explicitly requested device that is disabled', async () => {
      // sendSMS reports the disabled device, so the message stays canonical
      const device = { _id: OWN_DEVICE, enabled: false, user: mockUser._id }
      mockDeviceModel.findOne.mockResolvedValueOnce(device)

      const result = await service.resolveSenderDevice(mockUser, OWN_DEVICE)

      expect(result).toEqual(device)
    })

    it('prefers the enabled default device when no id is given', async () => {
      const device = { _id: OWN_DEVICE, enabled: true, isDefault: true }
      mockDeviceModel.findOne.mockResolvedValueOnce(device)

      const result = await service.resolveSenderDevice(mockUser)

      expect(mockDeviceModel.findOne).toHaveBeenCalledWith({
        user: mockUser._id,
        isDefault: true,
        enabled: true,
      })
      expect(mockDeviceModel.findOne).toHaveBeenCalledTimes(1)
      expect(result).toEqual(device)
    })

    it('falls back to the most recently active enabled device', async () => {
      const device = { _id: OTHER_DEVICE, enabled: true }
      const sort = jest.fn().mockResolvedValue(device)
      mockDeviceModel.findOne
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce({ sort })

      const result = await service.resolveSenderDevice(mockUser)

      expect(mockDeviceModel.findOne).toHaveBeenLastCalledWith({
        user: mockUser._id,
        enabled: true,
      })
      expect(sort).toHaveBeenCalledWith({ lastHeartbeat: -1, _id: -1 })
      expect(result).toEqual(device)
    })

    it('throws when the user has no enabled device', async () => {
      const sort = jest.fn().mockResolvedValue(null)
      mockDeviceModel.findOne
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce({ sort })

      await expect(service.resolveSenderDevice(mockUser)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: {
          success: false,
          error: 'No enabled device found. Enable a device or pass a deviceId.',
        },
      })
    })
  })

  describe('setDefaultDevice', () => {
    const mockDeviceId = '507f1f77bcf86cd799439011'
    const mockDevice = {
      _id: mockDeviceId,
      user: 'user123',
      enabled: true,
    }

    it('clears the previous default before marking the new one', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.updateMany.mockResolvedValue({ modifiedCount: 1 })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({
        ...mockDevice,
        isDefault: true,
      })

      const result = await service.setDefaultDevice(mockDeviceId)

      expect(mockDeviceModel.updateMany).toHaveBeenCalledWith(
        {
          user: mockDevice.user,
          _id: { $ne: mockDevice._id },
          isDefault: true,
        },
        { $set: { isDefault: false } },
      )
      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockDeviceId,
        { $set: { isDefault: true } },
        { new: true },
      )
      expect(result).toMatchObject({ isDefault: true })
    })

    it('throws if the device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(service.setDefaultDevice(mockDeviceId)).rejects.toMatchObject(
        { status: HttpStatus.NOT_FOUND, response: { error: 'Device not found' } },
      )
      expect(mockDeviceModel.updateMany).not.toHaveBeenCalled()
      expect(mockDeviceModel.findByIdAndUpdate).not.toHaveBeenCalled()
    })

    it('allows a disabled device to be made the default', async () => {
      const disabledDevice = { ...mockDevice, enabled: false }
      mockDeviceModel.findById.mockResolvedValue(disabledDevice)
      mockDeviceModel.updateMany.mockResolvedValue({ modifiedCount: 0 })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({
        ...disabledDevice,
        isDefault: true,
      })

      const result = await service.setDefaultDevice(mockDeviceId)

      expect(result).toMatchObject({ enabled: false, isDefault: true })
    })
  })

  describe('updateDevice', () => {
    const mockDeviceId = 'device123'
    const mockDeviceInput: RegisterDeviceInputDTO = {
      model: 'Pixel 6',
      buildId: 'build123',
      fcmToken: 'updatedToken',
      enabled: true,
    }
    const mockDevice = {
      _id: mockDeviceId,
      ...mockDeviceInput,
    }

    it('should update device if it exists', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({
        ...mockDevice,
        fcmToken: 'updatedToken',
      })

      const result = await service.updateDevice(mockDeviceId, mockDeviceInput)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockDeviceId,
        { $set: mockDeviceInput },
        { new: true },
      )
      expect(result).toBeDefined()
    })

    it('should throw an error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(
        service.updateDevice(mockDeviceId, mockDeviceInput),
      ).rejects.toThrow(HttpException)
      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockDeviceModel.findByIdAndUpdate).not.toHaveBeenCalled()
    })

    it('must not blank a stored osVersion when a legacy client sends an empty BASE_OS', async () => {
      // BASE_OS is '' on many devices, and '' is not null, so it reaches
      // $set unless normalizeOsFields drops it. If this regresses, a single
      // re-register wipes the backfilled version for those devices.
      mockDeviceModel.findById.mockResolvedValue({ ...mockDevice, osVersion: '14' })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, {
        ...mockDeviceInput,
        os: '',
      } as RegisterDeviceInputDTO)

      const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
      expect(update.$set).not.toHaveProperty('osVersion')
      expect(update.$set.os).toBe('Android')
    })

    it('persists the build string a current client reports', async () => {
      // `os` is the plain 'Android' label now, so the build string arrives in
      // its own field. If the normalizer ignores it the field becomes writable
      // only by the backfill script and no app build can ever populate it.
      const fingerprint =
        'samsung/e3qxxx/e3q:16/BP2A.250605.031.A3/S928BXXU4CYI7:user/release-keys'
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, {
        ...mockDeviceInput,
        os: 'Android',
        osVersion: '16',
        osApiLevel: 36,
        osBuildFingerprint: fingerprint,
      } as RegisterDeviceInputDTO)

      const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
      expect(update.$set).toMatchObject({
        os: 'Android',
        osVersion: '16',
        osApiLevel: 36,
        osBuildFingerprint: fingerprint,
      })
    })

    it.each([
      ['osVersion', { osVersion: '' }],
      ['osApiLevel', { osApiLevel: null }],
      ['osBuildFingerprint', { osBuildFingerprint: '' }],
    ])(
      'must not blank a stored %s sent empty by a non-first-party client',
      async (field, payload) => {
        // The gateway API is public and has no ValidationPipe, so these can
        // arrive from any client, not just the Android app.
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          osVersion: '14',
          osApiLevel: 34,
          osBuildFingerprint: 'samsung/a13nnxx/a13:14/UP1A.231005.007/x:user/release-keys',
        })
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

        await service.updateDevice(mockDeviceId, {
          ...mockDeviceInput,
          ...payload,
        } as RegisterDeviceInputDTO)

        const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
        expect(update.$set).not.toHaveProperty(field)
      },
    )

    it('should ignore a client-sent isDefault', async () => {
      // set-default is the only route allowed to move the default flag
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, {
        ...mockDeviceInput,
        isDefault: true,
      } as any)

      const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
      expect(update.$set.isDefault).toBeUndefined()
    })
  })

  describe('deleteDevice', () => {
    const mockDeviceId = '507f1f77bcf86cd799439011'
    const mockDevice = { _id: mockDeviceId, model: 'Pixel 6' }

    it('should tombstone and delete when device exists', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)

      const result = await service.deleteDevice(mockDeviceId)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockDeviceTombstoneModel.updateOne).toHaveBeenCalled()
      expect(mockDeviceModel.findByIdAndDelete).toHaveBeenCalledWith(mockDeviceId)
      expect(result).toEqual({ success: true })
    })

    it('should throw an error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(service.deleteDevice(mockDeviceId)).rejects.toThrow(
        HttpException,
      )
      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
    })
  })

  describe('sendSMS', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
      enabled: true,
      fcmToken: 'fcm-token',
      user: 'user123',
    }
    const mockSmsInput: SendSMSInputDTO = {
      message: 'Hello there',
      recipients: ['+123456789'],
      smsBody: 'Hello there',
      receivers: ['+123456789'],
    }
    const mockSms = {
      _id: 'sms123',
      device: mockDeviceId,
      message: mockSmsInput.message,
      type: SMSType.SENT,
      recipient: mockSmsInput.recipients[0],
      status: 'pending',
    }
    const mockSmsBatch = {
      _id: 'batch123',
      device: mockDeviceId,
      message: mockSmsInput.message,
      recipientCount: 1,
      status: 'pending',
    }
    const mockFcmResponse: BatchResponse = {
      successCount: 1,
      failureCount: 0,
      responses: [],
    }

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockSmsBatchModel.create.mockResolvedValue(mockSmsBatch)
      mockSmsModel.create.mockResolvedValue(mockSms)
      mockDeviceModel.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(true),
      }))
      mockSmsBatchModel.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(true),
      }))
      mockBillingService.canPerformAction.mockResolvedValue(true)
      mockSmsQueueService.isQueueEnabled.mockReturnValue(false)
      
      // Fix the mock
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValue(mockFcmResponse)
    })

    it('should send SMS successfully', async () => {
      const result = await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockBillingService.canPerformAction).toHaveBeenCalledWith(
        mockDevice.user.toString(),
        'send_sms',
        mockSmsInput.recipients.length,
      )
      expect(mockSmsBatchModel.create).toHaveBeenCalled()
      expect(mockSmsModel.create).toHaveBeenCalled()
      expect(firebaseAdmin.messaging().sendEach).toHaveBeenCalled()
      expect(result).toEqual(mockFcmResponse)
    })

    it('should throw error if device is not enabled', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        enabled: false,
      })

      await expect(
        service.sendSMS(mockDeviceId, mockSmsInput),
      ).rejects.toThrow(HttpException)
      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
    })

    it('should throw error if message is blank', async () => {
      await expect(
        service.sendSMS(mockDeviceId, { ...mockSmsInput, message: '', smsBody: '' }),
      ).rejects.toThrow(HttpException)
    })

    it('should throw error if recipients are invalid', async () => {
      await expect(
        service.sendSMS(mockDeviceId, { ...mockSmsInput, recipients: [] }),
      ).rejects.toThrow(HttpException)
    })

    it('should queue SMS if queue is enabled', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const result = await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(mockSmsQueueService.isQueueEnabled).toHaveBeenCalled()
      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalled()
      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('smsBatchId', mockSmsBatch._id)
      // single immediate wave: no dispatchDueAt stamping, no estimate
      expect(mockSmsModel.bulkWrite).not.toHaveBeenCalled()
      expect(result).not.toHaveProperty('estimatedCompletionAt')
    })

    it('passes the device send delay to the queue and stamps dispatchDueAt per wave', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        smsSendDelaySeconds: 7,
      })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsModel.create
        .mockResolvedValueOnce({ ...mockSms, _id: 'sms-a' })
        .mockResolvedValueOnce({ ...mockSms, _id: 'sms-b' })
        .mockResolvedValueOnce({ ...mockSms, _id: 'sms-c' })
      const plan = {
        waves: [
          { start: 0, end: 2, delayMs: 0 },
          { start: 2, end: 3, delayMs: 14_000 },
        ],
        sendDelaySeconds: 7,
        projectedCompletionMs: 21_000,
      }
      mockSmsQueueService.planSendSmsJob.mockReturnValue(plan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const before = Date.now()
      const result = await service.sendSMS(mockDeviceId, {
        ...mockSmsInput,
        recipients: ['+15550100', '+15550101', '+15550102'],
      })

      expect(mockSmsQueueService.planSendSmsJob).toHaveBeenCalledWith(3, undefined, 7)
      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalledWith(
        mockDeviceId,
        expect.any(Array),
        mockSmsBatch._id,
        undefined,
        7,
        plan,
      )
      expect(mockSmsModel.bulkWrite).toHaveBeenCalledTimes(1)
      const ops = mockSmsModel.bulkWrite.mock.calls[0][0]
      expect(ops).toHaveLength(2)
      expect(ops[0].updateMany.filter).toEqual({ _id: { $in: ['sms-a', 'sms-b'] } })
      expect(ops[1].updateMany.filter).toEqual({ _id: { $in: ['sms-c'] } })
      const due0 = ops[0].updateMany.update.$set.dispatchDueAt.getTime()
      const due1 = ops[1].updateMany.update.$set.dispatchDueAt.getTime()
      expect(due1 - due0).toBe(14_000)
      expect(due0).toBeGreaterThanOrEqual(before)

      const eta = Date.parse(result.estimatedCompletionAt)
      expect(eta - due0).toBe(21_000)
    })

    it('persists the plan before any job exists, so a write failure leaves no live jobs', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockReturnValue({
        waves: [
          { start: 0, end: 1, delayMs: 0 },
          { start: 1, end: 2, delayMs: 5000 },
        ],
        sendDelaySeconds: 5,
        projectedCompletionMs: 10_000,
      })
      mockSmsModel.bulkWrite.mockRejectedValueOnce(new Error('write failed'))

      await expect(
        service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          recipients: ['+15550100', '+15550101'],
        }),
      ).rejects.toThrow(HttpException)

      expect(mockSmsQueueService.addSendSmsJob).not.toHaveBeenCalled()
      expect(mockSmsBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockSmsBatch._id,
        { $set: { status: 'failed', error: 'write failed' } },
      )
      expect(mockSmsModel.updateMany).toHaveBeenCalledWith(
        { smsBatch: mockSmsBatch._id },
        { $set: { status: 'failed', error: 'write failed' } },
      )
    })

    it('builds every push with a bounded ttl and no collapse key', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      await service.sendSMS(mockDeviceId, mockSmsInput)

      const [, fcmMessages] = mockSmsQueueService.addSendSmsJob.mock.calls[0]
      expect(fcmMessages[0].android).toEqual({
        priority: 'high',
        ttl: 72 * 3600 * 1000,
      })
    })

    it('extends the ttl so a scheduled push never expires before scheduledAt', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])
      const scheduledAt = new Date(Date.now() + 3_600_000).toISOString()

      await service.sendSMS(mockDeviceId, { ...mockSmsInput, scheduledAt })

      const [, fcmMessages, , delayMs] =
        mockSmsQueueService.addSendSmsJob.mock.calls[0]
      expect(delayMs).toBeGreaterThan(3_500_000)
      expect(fcmMessages[0].android.ttl).toBeGreaterThan(72 * 3600 * 1000)
      // a single scheduled wave is still stamped so the stale cron waits for it
      expect(mockSmsModel.bulkWrite).toHaveBeenCalledTimes(1)
    })

    it('should handle queue error properly', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.addSendSmsJob.mockRejectedValue(new Error('Queue error'))

      await expect(
        service.sendSMS(mockDeviceId, mockSmsInput),
      ).rejects.toThrow(HttpException)
      
      expect(mockSmsBatchModel.findByIdAndUpdate).toHaveBeenCalled()
      expect(mockSmsModel.updateMany).toHaveBeenCalled()
    })
  })

  describe('sendBulkSMS', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
      enabled: true,
      fcmToken: 'fcm-token',
      user: 'user123',
    }
    const mockBulkSmsInput: SendBulkSMSInputDTO = {
      messageTemplate: 'Hello {name}',
      messages: [
        {
          message: 'Hello John',
          recipients: ['+123456789'],
          smsBody: 'Hello John',
          receivers: ['+123456789'],
        },
        {
          message: 'Hello Jane',
          recipients: ['+987654321'],
          smsBody: 'Hello Jane',
          receivers: ['+987654321'],
        },
      ],
    }
    const mockSmsBatch = {
      _id: 'batch123',
      device: mockDeviceId,
      message: mockBulkSmsInput.messageTemplate,
      recipientCount: 2,
      status: 'pending',
    }
    const mockSms = {
      _id: 'sms123',
      device: mockDeviceId,
      message: 'Hello John',
      type: SMSType.SENT,
      recipient: '+123456789',
      status: 'pending',
    }
    const mockFcmResponse: BatchResponse = {
      successCount: 1,
      failureCount: 0,
      responses: [],
    }

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockSmsBatchModel.create.mockResolvedValue(mockSmsBatch)
      mockSmsModel.create.mockResolvedValue(mockSms)
      mockDeviceModel.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(true),
      }))
      mockSmsBatchModel.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(true),
      }))
      mockBillingService.canPerformAction.mockResolvedValue(true)
      mockSmsQueueService.isQueueEnabled.mockReturnValue(false)
      
      // Fix the mock
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValue(mockFcmResponse)
    })

    it('should send bulk SMS successfully', async () => {
      const result = await service.sendBulkSMS(mockDeviceId, mockBulkSmsInput)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockBillingService.canPerformAction).toHaveBeenCalledWith(
        mockDevice.user.toString(),
        'bulk_send_sms',
        2,
      )
      expect(mockSmsBatchModel.create).toHaveBeenCalled()
      expect(mockSmsModel.create).toHaveBeenCalled()
      expect(firebaseAdmin.messaging().sendEach).toHaveBeenCalled()
      expect(result).toHaveProperty('success', true)
    })

    it('should queue bulk SMS if queue is enabled', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const result = await service.sendBulkSMS(mockDeviceId, mockBulkSmsInput)

      expect(mockSmsQueueService.isQueueEnabled).toHaveBeenCalled()
      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalled()
      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('smsBatchId', mockSmsBatch._id)
      expect(result).not.toHaveProperty('estimatedCompletionAt')
      // the batch is marked processing before the waves are queued
      expect(mockSmsBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockSmsBatch._id,
        { $set: { status: 'processing' } },
      )
      expect(mockSmsModel.bulkWrite).not.toHaveBeenCalled()
    })

    it('paces a large bulk send per scheduled group and reports the latest estimate', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        smsSendDelaySeconds: 5,
      })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      let created = 0
      mockSmsModel.create.mockImplementation(async () => ({
        ...mockSms,
        _id: `sms-${created++}`,
      }))
      mockSmsQueueService.planSendSmsJob
        .mockReturnValueOnce({
          waves: [
            { start: 0, end: 2, delayMs: 0 },
            { start: 2, end: 3, delayMs: 10_000 },
          ],
          sendDelaySeconds: 5,
          projectedCompletionMs: 15_000,
        })
        .mockReturnValueOnce({
          waves: [{ start: 0, end: 1, delayMs: 60_000 }],
          sendDelaySeconds: 5,
          projectedCompletionMs: 65_000,
        })
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])
      const scheduledAt = new Date(Date.now() + 60_000).toISOString()

      const result = await service.sendBulkSMS(mockDeviceId, {
        messageTemplate: 'Hi',
        messages: [
          { message: 'Hi', recipients: ['+15550100', '+15550101', '+15550102'] },
          { message: 'Later', recipients: ['+15550103'], scheduledAt },
        ],
      } as any)

      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalledTimes(2)
      expect(mockSmsQueueService.addSendSmsJob.mock.calls[0][4]).toBe(5)
      expect(mockSmsQueueService.addSendSmsJob.mock.calls[1][3]).toBeGreaterThan(50_000)
      expect(mockSmsQueueService.addSendSmsJob.mock.calls[1][3]).toBeLessThanOrEqual(60_000)

      expect(mockSmsModel.bulkWrite).toHaveBeenCalledTimes(2)
      const firstOps = mockSmsModel.bulkWrite.mock.calls[0][0]
      expect(firstOps[0].updateMany.filter).toEqual({ _id: { $in: ['sms-0', 'sms-1'] } })
      expect(firstOps[1].updateMany.filter).toEqual({ _id: { $in: ['sms-2'] } })
      const secondOps = mockSmsModel.bulkWrite.mock.calls[1][0]
      expect(secondOps[0].updateMany.filter).toEqual({ _id: { $in: ['sms-3'] } })

      expect(result.recipientCount).toBe(4)
      const eta = Date.parse(result.estimatedCompletionAt)
      const due0 = firstOps[0].updateMany.update.$set.dispatchDueAt.getTime()
      expect(eta - due0).toBe(65_000)
    })

    it('rolls back jobs already queued when a later group fails to enqueue', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      const firstGroupJobs = [{ id: 'job-1' }, { id: 'job-2' }]
      mockSmsQueueService.addSendSmsJob
        .mockResolvedValueOnce(firstGroupJobs)
        .mockRejectedValueOnce(new Error('redis down'))
      mockSmsQueueService.removeJobs.mockResolvedValue(undefined)
      const scheduledAt = new Date(Date.now() + 120_000).toISOString()

      await expect(
        service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'Hi',
          messages: [
            { message: 'Now', recipients: ['+15550100', '+15550101'] },
            { message: 'Later', recipients: ['+15550102'], scheduledAt },
          ],
        } as any),
      ).rejects.toThrow(HttpException)

      expect(mockSmsQueueService.removeJobs).toHaveBeenCalledWith(firstGroupJobs)
      expect(mockSmsBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockSmsBatch._id,
        expect.objectContaining({ $set: expect.objectContaining({ status: 'failed' }) }),
      )
    })

    it('groups entries that share a scheduledAt into one paced plan', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])
      const scheduledAt = new Date(Date.now() + 120_000).toISOString()

      await service.sendBulkSMS(mockDeviceId, {
        messageTemplate: 'Hi',
        messages: [
          { message: 'Hi A', recipients: ['+15550100', '+15550101'], scheduledAt },
          { message: 'Hi B', recipients: ['+15550102'], scheduledAt },
          { message: 'Now', recipients: ['+15550103'] },
        ],
      } as any)

      // one scheduled group of 3 plus one immediate group of 1
      expect(mockSmsQueueService.planSendSmsJob).toHaveBeenCalledTimes(2)
      const counts = mockSmsQueueService.planSendSmsJob.mock.calls
        .map(([count]) => count)
        .sort((a, b) => a - b)
      expect(counts).toEqual([1, 3])
      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalledTimes(2)
      const scheduledCall = mockSmsQueueService.addSendSmsJob.mock.calls.find(
        ([, msgs]) => msgs.length === 3,
      )
      expect(scheduledCall[3]).toBeGreaterThan(110_000)
      expect(scheduledCall[3]).toBeLessThanOrEqual(120_000)
    })
  })

  describe('receiveSMS', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
      user: 'user123',
    }
    const mockReceivedSmsData = {
      message: 'Hello from test',
      sender: '+123456789',
      receivedAt: new Date(),
    }
    const mockSms = {
      _id: 'sms123',
      ...mockReceivedSmsData,
      device: mockDeviceId,
      type: SMSType.RECEIVED,
    }

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockSmsModel.findOne.mockResolvedValue(null)
      mockSmsModel.create.mockResolvedValue(mockSms)
      mockDeviceModel.findByIdAndUpdate.mockImplementation(() => ({
        exec: jest.fn().mockResolvedValue(true),
      }))
      mockBillingService.canPerformAction.mockResolvedValue(true)
      mockWebhookService.deliverNotification.mockResolvedValue(true)
    })

    it('should receive SMS successfully', async () => {
      const result = await service.receiveSMS(mockDeviceId, mockReceivedSmsData)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockBillingService.canPerformAction).toHaveBeenCalledWith(
        mockDevice.user.toString(),
        'receive_sms',
        1,
      )
      expect(mockSmsModel.create).toHaveBeenCalled()
      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalled()
      expect(mockWebhookService.deliverNotification).toHaveBeenCalledWith({
        sms: mockSms,
        user: mockDevice.user,
        event: WebhookEvent.MESSAGE_RECEIVED,
      })
      expect(result).toEqual(mockSms)
    })

    it('should throw error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(
        service.receiveSMS(mockDeviceId, mockReceivedSmsData),
      ).rejects.toThrow(HttpException)
    })

    it('should throw error if SMS data is invalid', async () => {
      await expect(
        service.receiveSMS(mockDeviceId, { ...mockReceivedSmsData, message: '' }),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('getReceivedSMS', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
    }
    const mockSmsData = [
      {
        _id: 'sms1',
        message: 'Hello 1',
        type: SMSType.RECEIVED,
        sender: '+123456789',
        receivedAt: new Date(),
      },
      {
        _id: 'sms2',
        message: 'Hello 2',
        type: SMSType.RECEIVED,
        sender: '+987654321',
        receivedAt: new Date(),
      },
    ]

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockSmsModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockSmsData),
        }),
      })
      mockSmsModel.countDocuments.mockResolvedValue(2)
    })

    it('should get received SMS with pagination', async () => {
      const result = await service.getReceivedSMS(mockDeviceId, 1, 10)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith({
        device: mockDevice._id,
        type: SMSType.RECEIVED,
      })
      expect(mockSmsModel.find).toHaveBeenCalledWith(
        {
          device: mockDevice._id,
          type: SMSType.RECEIVED,
        },
        null,
        {
          sort: { receivedAt: -1 },
          limit: 10,
          skip: 0,
        },
      )
      expect(result).toHaveProperty('data', mockSmsData)
      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('total', 2)
    })

    it('should throw error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(service.getReceivedSMS(mockDeviceId)).rejects.toThrow(
        HttpException,
      )
    })
  })

  describe('getMessages', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
    }
    const mockSmsData = [
      {
        _id: 'sms1',
        message: 'Hello 1',
        type: SMSType.SENT,
        recipient: '+123456789',
        createdAt: new Date(),
      },
      {
        _id: 'sms2',
        message: 'Hello 2',
        type: SMSType.RECEIVED,
        sender: '+987654321',
        createdAt: new Date(),
      },
    ]

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockSmsModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockSmsData),
        }),
      })
      mockSmsModel.countDocuments.mockResolvedValue(2)
    })

    it('should get all messages with pagination', async () => {
      const result = await service.getMessages(mockDeviceId, '', 1, 10)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith({
        device: mockDevice._id,
      })
      expect(mockSmsModel.find).toHaveBeenCalledWith(
        {
          device: mockDevice._id,
        },
        null,
        {
          sort: { createdAt: -1 },
          limit: 10,
          skip: 0,
        },
      )
      expect(result).toHaveProperty('data', mockSmsData)
      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('total', 2)
    })

    it('should get sent messages with pagination', async () => {
      const result = await service.getMessages(mockDeviceId, 'sent', 1, 10)

      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith({
        device: mockDevice._id,
        type: SMSType.SENT,
      })
      expect(mockSmsModel.find).toHaveBeenCalledWith(
        {
          device: mockDevice._id,
          type: SMSType.SENT,
        },
        null,
        expect.any(Object),
      )
    })

    it('should get received messages with pagination', async () => {
      const result = await service.getMessages(mockDeviceId, 'received', 1, 10)

      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith({
        device: mockDevice._id,
        type: SMSType.RECEIVED,
      })
      expect(mockSmsModel.find).toHaveBeenCalledWith(
        {
          device: mockDevice._id,
          type: SMSType.RECEIVED,
        },
        null,
        expect.any(Object),
      )
    })

    it('should throw error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(service.getMessages(mockDeviceId)).rejects.toThrow(
        HttpException,
      )
    })

    it('should search across message body, recipient and sender', async () => {
      await service.getMessages(mockDeviceId, '', 1, 10, 'alice')

      const expectedQuery = {
        device: mockDevice._id,
        $or: [
          { message: /alice/i },
          { recipient: /alice/i },
          { sender: /alice/i },
        ],
      }

      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith(expectedQuery)
      expect(mockSmsModel.find).toHaveBeenCalledWith(
        expectedQuery,
        null,
        expect.any(Object),
      )
    })

    it('should combine search with the type filter', async () => {
      await service.getMessages(mockDeviceId, 'sent', 1, 10, 'alice')

      expect(mockSmsModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          device: mockDevice._id,
          type: SMSType.SENT,
          $or: expect.any(Array),
        }),
        null,
        expect.any(Object),
      )
    })

    it('should ignore an empty or whitespace-only search', async () => {
      await service.getMessages(mockDeviceId, '', 1, 10, '   ')

      expect(mockSmsModel.find).toHaveBeenCalledWith(
        { device: mockDevice._id },
        null,
        expect.any(Object),
      )
    })

    it('should escape regex metacharacters in the search term', async () => {
      // Unescaped, this throws a SyntaxError and fails the request.
      await expect(
        service.getMessages(mockDeviceId, '', 1, 10, '('),
      ).resolves.toBeDefined()

      // A wildcard must be matched literally, not treated as "any character".
      await service.getMessages(mockDeviceId, '', 1, 10, '.*')

      const call = mockSmsModel.find.mock.calls.at(-1)
      const messagePattern = call[0].$or[0].message as RegExp
      expect(messagePattern.test('anything at all')).toBe(false)
      expect(messagePattern.test('contains .* literally')).toBe(true)
    })
  })

  describe('getStatsForUser', () => {
    const mockUser = { 
      _id: 'user123', 
      name: 'Test User', 
      email: 'test@example.com',
      password: 'password',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    } as unknown as User;
    
    const mockDevices = [
      {
        _id: 'device1',
        sentSMSCount: 10,
        receivedSMSCount: 5,
      },
      {
        _id: 'device2',
        sentSMSCount: 20,
        receivedSMSCount: 15,
      },
    ]
    const mockApiKeys = [
      { _id: 'key1', name: 'API Key 1' },
      { _id: 'key2', name: 'API Key 2' },
    ]

    beforeEach(() => {
      mockDeviceModel.find.mockResolvedValue(mockDevices)
      mockAuthService.getUserApiKeys.mockResolvedValue(mockApiKeys)
    })

    it('should return stats for user', async () => {
      const result = await service.getStatsForUser(mockUser)

      expect(mockDeviceModel.find).toHaveBeenCalledWith({ user: mockUser._id })
      expect(mockAuthService.getUserApiKeys).toHaveBeenCalledWith(mockUser)
      expect(result).toEqual({
        totalSentSMSCount: 30,
        totalReceivedSMSCount: 20,
        totalDeviceCount: 2,
        totalApiKeyCount: 2,
      })
    })
  })

  // The device guard only sees the :id param, so the second identifier on
  // these routes has to be bound to the device by the query itself.
  describe('SMS lookups are scoped to the requesting device', () => {
    const OWN_DEVICE = '507f1f77bcf86cd799439011'
    const OTHER_SMS = '507f1f77bcf86cd799439022'

    describe('getSMSById', () => {
      it('filters on both the sms id and the device', async () => {
        mockSmsModel.findOne.mockResolvedValue({ _id: OTHER_SMS })

        await service.getSMSById(OWN_DEVICE, OTHER_SMS)

        expect(mockSmsModel.findOne).toHaveBeenCalledWith({
          _id: new Types.ObjectId(OTHER_SMS),
          device: new Types.ObjectId(OWN_DEVICE),
        })
      })

      it('reports another device\'s message as not found', async () => {
        mockSmsModel.findOne.mockResolvedValue(null)

        await expect(
          service.getSMSById(OWN_DEVICE, OTHER_SMS),
        ).rejects.toThrow(HttpException)
      })

      it('reports a malformed id as not found rather than throwing a cast error', async () => {
        await expect(
          service.getSMSById(OWN_DEVICE, 'not-an-objectid'),
        ).rejects.toThrow(HttpException)
        expect(mockSmsModel.findOne).not.toHaveBeenCalled()
      })
    })

    describe('getSmsBatchById', () => {
      it('filters the batch on the device', async () => {
        mockSmsBatchModel.findOne.mockResolvedValue(null)

        await expect(
          service.getSmsBatchById(OWN_DEVICE, OTHER_SMS),
        ).rejects.toThrow(HttpException)

        const filter = mockSmsBatchModel.findOne.mock.calls[0][0]
        expect(filter._id).toBe(OTHER_SMS)
        expect(filter.device.toString()).toBe(OWN_DEVICE)
      })

      it('does not read the batch messages when the batch is not this device\'s', async () => {
        mockSmsBatchModel.findOne.mockResolvedValue(null)

        await expect(
          service.getSmsBatchById(OWN_DEVICE, OTHER_SMS),
        ).rejects.toThrow(HttpException)
        expect(mockSmsModel.find).not.toHaveBeenCalled()
      })
    })

    describe('updateSMSStatus', () => {
      const OTHER_BATCH = '507f1f77bcf86cd799439033'

      it('leaves a batch belonging to another device untouched', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          _id: OWN_DEVICE,
          user: 'user_1',
        })
        mockSmsModel.findById.mockResolvedValue({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'pending',
        })
        mockSmsModel.findByIdAndUpdate.mockResolvedValue({
          _id: 'own_sms',
          status: 'sent',
        })
        mockSmsBatchModel.findOne.mockResolvedValue(null)

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: 'own_sms',
          smsBatchId: OTHER_BATCH,
          status: 'sent',
        } as any)

        const filter = mockSmsBatchModel.findOne.mock.calls[0][0]
        expect(filter.device.toString()).toBe(OWN_DEVICE)
        expect(mockSmsBatchModel.findByIdAndUpdate).not.toHaveBeenCalled()
      })
    })
  })

  describe('getMessagesForUser', () => {
    const userId = new Types.ObjectId()
    const user = { _id: userId } as any
    const deviceA = new Types.ObjectId()
    const deviceB = new Types.ObjectId()
    const deletedDevice = new Types.ObjectId()

    // In-memory store evaluated against the exact queries the service builds,
    // so keyset predicate mistakes (missing _id tiebreaker, flipped
    // comparators) surface as real repeats or gaps in the walk.
    let store: any[]

    const matches = (doc: any, q: any): boolean => {
      for (const [key, cond] of Object.entries<any>(q)) {
        if (key === '$and') {
          if (!cond.every((sub: any) => matches(doc, sub))) return false
        } else if (key === '$or') {
          if (!cond.some((sub: any) => matches(doc, sub))) return false
        } else if (cond && typeof cond === 'object' && !(cond instanceof Types.ObjectId) && !(cond instanceof Date) && !(cond instanceof RegExp)) {
          for (const [op, v] of Object.entries<any>(cond)) {
            const val = doc[key]
            const cmp = (a: any, b: any) =>
              String(a) === String(b) ? 0 : (a instanceof Date ? a.getTime() : String(a)) < (b instanceof Date ? b.getTime() : String(b)) ? -1 : 1
            if (op === '$in' && !v.some((x: any) => String(x) === String(val))) return false
            if (op === '$lt' && !(cmp(val, v) < 0)) return false
            if (op === '$gt' && !(cmp(val, v) > 0)) return false
            if (op === '$gte' && !(cmp(val, v) >= 0)) return false
          }
        } else if (cond instanceof RegExp) {
          if (!cond.test(doc[key])) return false
        } else if (String(doc[key]) !== String(cond)) {
          return false
        }
      }
      return true
    }

    const fakeFind = (query: any, _proj: any, opts: any) => {
      let rows = store.filter((d) => matches(d, query))
      const [[k1, d1], [k2, d2]] = Object.entries<any>(opts.sort)
      rows = rows.sort((a, b) => {
        const c1 = a[k1].getTime() - b[k1].getTime()
        if (c1 !== 0) return c1 * d1
        return String(a[k2]) < String(b[k2]) ? d2 * -1 : d2
      })
      if (opts.skip) rows = rows.slice(opts.skip)
      rows = rows.slice(0, opts.limit)
      return {
        populate: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) }),
      }
    }

    beforeEach(() => {
      store = []
      mockDeviceModel.find.mockResolvedValue([{ _id: deviceA }, { _id: deviceB }])
      mockSmsModel.find.mockImplementation(fakeFind)
      mockSmsModel.countDocuments.mockImplementation(async (q: any) => store.filter((d) => matches(d, q)).length)
    })

    const seed = (device: Types.ObjectId, n: number, base: Date, sameMs = false, type = SMSType.SENT) => {
      for (let i = 0; i < n; i++) {
        store.push({
          _id: new Types.ObjectId(),
          user: userId,
          device,
          type,
          status: 'sent',
          message: `msg ${i}`,
          createdAt: sameMs ? base : new Date(base.getTime() + i * 1000),
        })
      }
    }

    it('always constrains device to live devices, so deleted-device rows never surface', async () => {
      seed(deviceA, 2, new Date('2026-08-01T00:00:00Z'))
      seed(deletedDevice, 3, new Date('2026-08-02T00:00:00Z'))

      const result = await service.getMessagesForUser(user, { order: 'desc' } as any, 1, 50)

      expect(result.data).toHaveLength(2)
      // total must exclude them too, not just the page
      expect(result.meta.total).toBe(2)
    })

    it('excludes rows from devices deleted before tombstones existed', async () => {
      // No tombstone consulted at all: the $in on live ids is the whole filter
      seed(deletedDevice, 5, new Date('2026-08-01T00:00:00Z'))
      const result = await service.getMessagesForUser(user, { order: 'desc' } as any, 1, 50)
      expect(result.data).toHaveLength(0)
      expect(result.meta.total).toBe(0)
    })

    it('404s on a deviceIds entry the caller does not own, naming it', async () => {
      const foreign = new Types.ObjectId()
      // jest-circus has no global fail(), so capture and assert instead
      const caught = await service
        .getMessagesForUser(user, { order: 'desc', deviceIds: [foreign] } as any, 1, 50)
        .then(() => undefined)
        .catch((e) => e)
      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(404)
      expect(((caught as HttpException).getResponse() as any).error).toContain(String(foreign))
    })

    it('narrows to the requested deviceIds subset', async () => {
      seed(deviceA, 2, new Date('2026-08-01T00:00:00Z'))
      seed(deviceB, 3, new Date('2026-08-02T00:00:00Z'))
      const result = await service.getMessagesForUser(user, { order: 'desc', deviceIds: [deviceB] } as any, 1, 50)
      expect(result.data).toHaveLength(3)
      expect(result.data.every((m: any) => String(m.device) === String(deviceB))).toBe(true)
    })

    it('returns an empty page without querying sms when the user has no devices', async () => {
      mockDeviceModel.find.mockResolvedValue([])
      const result = await service.getMessagesForUser(user, { order: 'desc' } as any, 1, 50)
      expect(result.data).toEqual([])
      expect(result.meta.total).toBe(0)
      expect(mockSmsModel.find).not.toHaveBeenCalled()
      expect(mockSmsModel.countDocuments).not.toHaveBeenCalled()
    })

    it('walks a 150-message same-millisecond block with no repeats and no gaps', async () => {
      seed(deviceA, 150, new Date('2026-08-01T12:00:00.000Z'), true)

      const seen = new Set<string>()
      let cursor: any = undefined
      let pages = 0
      while (true) {
        const filters: any = { order: 'desc', cursor }
        const result = await service.getMessagesForUser(user, filters, 1, 50)
        for (const m of result.data) {
          expect(seen.has(String(m._id))).toBe(false)
          seen.add(String(m._id))
        }
        pages++
        if (!result.meta.nextCursor) break
        cursor = decodeCursor(result.meta.nextCursor)
      }
      expect(seen.size).toBe(150)
      expect(pages).toBe(3)
    })

    it('keyset and offset modes return the same set', async () => {
      seed(deviceA, 30, new Date('2026-08-01T00:00:00Z'))
      seed(deviceB, 30, new Date('2026-08-01T00:00:10Z'))

      const offsetIds: string[] = []
      for (let page = 1; page <= 3; page++) {
        const r = await service.getMessagesForUser(user, { order: 'desc' } as any, page, 25)
        offsetIds.push(...r.data.map((m: any) => String(m._id)))
      }

      const keysetIds: string[] = []
      let cursor: any = undefined
      while (true) {
        const r = await service.getMessagesForUser(user, { order: 'desc', cursor } as any, 1, 25)
        keysetIds.push(...r.data.map((m: any) => String(m._id)))
        if (!r.meta.nextCursor) break
        cursor = decodeCursor(r.meta.nextCursor)
      }

      expect(keysetIds).toEqual(offsetIds)
    })

    it('asc keyset walk sees rows inserted behind the head mid-walk', async () => {
      seed(deviceA, 10, new Date('2026-08-01T00:00:00Z'))

      const first = await service.getMessagesForUser(user, { order: 'asc' } as any, 1, 5)
      // New rows land after the cursor position while we are mid-walk
      seed(deviceA, 3, new Date('2026-08-02T00:00:00Z'))

      let cursor: any = decodeCursor(first.meta.nextCursor)
      const rest: string[] = []
      while (true) {
        const r = await service.getMessagesForUser(user, { order: 'asc', cursor } as any, 1, 5)
        rest.push(...r.data.map((m: any) => String(m._id)))
        if (!r.meta.nextCursor) break
        cursor = decodeCursor(r.meta.nextCursor)
      }
      expect(first.data.length + rest.length).toBe(13)
    })

    it('filters by an owned smsBatchId and composes with status', async () => {
      const batchId = new Types.ObjectId()
      mockSmsBatchModel.findOne.mockResolvedValue({ _id: batchId, user: userId })
      store.push(
        { _id: new Types.ObjectId(), user: userId, device: deviceA, smsBatch: batchId, type: SMSType.SENT, status: 'failed', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: userId, device: deviceA, smsBatch: batchId, type: SMSType.SENT, status: 'delivered', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.SENT, status: 'failed', createdAt: new Date() },
      )

      const result = await service.getMessagesForUser(
        user,
        { order: 'desc', smsBatchId: batchId, status: 'failed' } as any,
        1,
        50,
      )

      expect(result.data).toHaveLength(1)
      expect(String(result.data[0].smsBatch)).toBe(String(batchId))
      expect(result.data[0].status).toBe('failed')
    })

    it('404s on an smsBatchId owned by another user, naming it', async () => {
      const batchId = new Types.ObjectId()
      mockSmsBatchModel.findOne.mockResolvedValue({ _id: batchId, user: new Types.ObjectId() })

      const caught = await service
        .getMessagesForUser(user, { order: 'desc', smsBatchId: batchId } as any, 1, 50)
        .then(() => undefined)
        .catch((e) => e)
      expect(caught).toBeInstanceOf(HttpException)
      expect((caught as HttpException).getStatus()).toBe(404)
      expect(((caught as HttpException).getResponse() as any).error).toContain(String(batchId))
    })

    it('404s on an smsBatchId that does not exist', async () => {
      mockSmsBatchModel.findOne.mockResolvedValue(null)
      const caught = await service
        .getMessagesForUser(user, { order: 'desc', smsBatchId: new Types.ObjectId() } as any, 1, 50)
        .then(() => undefined)
        .catch((e) => e)
      expect((caught as HttpException).getStatus()).toBe(404)
    })

    it('lets a legacy user-less batch through, still scoped by live devices', async () => {
      const batchId = new Types.ObjectId()
      // Pre-backfill batches lack user; the device $in is what protects them
      mockSmsBatchModel.findOne.mockResolvedValue({ _id: batchId })
      store.push(
        { _id: new Types.ObjectId(), user: userId, device: deviceA, smsBatch: batchId, type: SMSType.SENT, status: 'sent', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: new Types.ObjectId(), device: deletedDevice, smsBatch: batchId, type: SMSType.SENT, status: 'sent', createdAt: new Date() },
      )

      const result = await service.getMessagesForUser(
        user,
        { order: 'desc', smsBatchId: batchId } as any,
        1,
        50,
      )
      expect(result.data).toHaveLength(1)
      expect(String(result.data[0].device)).toBe(String(deviceA))
    })

    it('maps direction to the stored type and decorates responses with lowercase direction', async () => {
      seed(deviceA, 1, new Date('2026-08-01T00:00:00Z'), false, SMSType.SENT)
      seed(deviceA, 1, new Date('2026-08-02T00:00:00Z'), false, SMSType.RECEIVED)

      const sent = await service.getMessagesForUser(user, { order: 'desc', direction: 'sent' } as any, 1, 50)
      expect(sent.data).toHaveLength(1)
      // the compatibility contract: both spellings side by side, exact casing
      expect(sent.data[0].type).toBe('SENT')
      expect(sent.data[0].direction).toBe('sent')
    })

    it('applies from inclusively and to exclusively on createdAt', async () => {
      const t0 = new Date('2026-08-01T00:00:00.000Z')
      const t1 = new Date('2026-08-01T01:00:00.000Z')
      seed(deviceA, 1, t0)
      seed(deviceA, 1, t1)

      const result = await service.getMessagesForUser(
        user,
        { order: 'asc', from: t0, to: t1 } as any,
        1,
        50,
      )
      expect(result.data).toHaveLength(1)
      expect(new Date(result.data[0].createdAt).getTime()).toBe(t0.getTime())
    })

    it('combines direction and status independently', async () => {
      store.push(
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.SENT, status: 'failed', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.SENT, status: 'sent', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.RECEIVED, status: 'received', createdAt: new Date() },
      )
      const result = await service.getMessagesForUser(
        user,
        { order: 'desc', direction: 'sent', status: 'failed' } as any,
        1,
        50,
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0].status).toBe('failed')
    })

    it('search escapes regex metacharacters', async () => {
      store.push(
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.SENT, status: 'sent', message: 'price (usd)', createdAt: new Date() },
        { _id: new Types.ObjectId(), user: userId, device: deviceA, type: SMSType.SENT, status: 'sent', message: 'price usd', createdAt: new Date() },
      )
      const result = await service.getMessagesForUser(
        user,
        { order: 'desc', search: '(usd)' } as any,
        1,
        50,
      )
      expect(result.data).toHaveLength(1)
      expect(result.data[0].message).toBe('price (usd)')
    })
  })
})
