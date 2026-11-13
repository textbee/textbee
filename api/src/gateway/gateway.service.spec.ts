import { Test, TestingModule } from '@nestjs/testing'
import { GatewayService } from './gateway.service'
import { AuthModule } from '../auth/auth.module'
import { getModelToken } from '@nestjs/mongoose'
import {
  DEVICE_HIDDEN_FIELDS,
  Device,
  DeviceDocument,
  DeviceSchema,
} from './schemas/device.schema'
import { DeviceTombstone } from './schemas/device-tombstone.schema'
import { SMS } from './schemas/sms.schema'
import { SMSBatch } from './schemas/sms-batch.schema'
import { SMSPartReport } from './schemas/sms-part-report.schema'
import { AuthService } from '../auth/auth.service'
import { WebhookService } from '../webhook/webhook.service'
import { BillingService } from '../billing/billing.service'
import { EnqueueFailedError, SmsQueueService } from './queue/sms-queue.service'
import { UsersService } from '../users/users.service'
import { UserRollupService } from '../users/user-rollup.service'
import { SmsBatchStatusService } from './sms-batch-status.service'
import * as mongoose from 'mongoose'
import { Model, Types } from 'mongoose'
import { ConfigModule } from '@nestjs/config'
import { HttpException, HttpStatus } from '@nestjs/common'
import * as firebaseAdmin from 'firebase-admin'
import { SMSType } from './sms-type.enum'
import { WebhookEvent } from '../webhook/webhook-event.enum'
import { readPipelineUpdate } from '../../test/pipeline-update'
import { RegisterDeviceInputDTO, SendBulkSMSInputDTO, SendSMSInputDTO } from './gateway.dto'
import { decodeCursor } from './cursor'
import { APP_VERSION_HISTORY_PROJECTION } from './app-version-history'
import { User } from '../users/schemas/user.schema'
import { UserRole } from '../users/user-roles.enum'
import { BatchResponse } from 'firebase-admin/messaging'
import { planDispatchWaves } from './queue/dispatch-pacing'
import { findSmsError, smsErrorFields } from './sms-errors'
import { SEND_INTERRUPTED_MESSAGE } from './error-history'

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
    findOneAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    exists: jest.fn(),
    updateOne: jest.fn(),
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
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    updateMany: jest.fn(),
    bulkWrite: jest.fn(),
    countDocuments: jest.fn(),
  }

  const mockSmsBatchModel = {
    create: jest.fn(),
    findOne: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  }

  const mockSmsPartReportModel = {
    create: jest.fn(),
  }

  const mockDeviceTombstoneModel = {
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  }

  const mockAuthService = {
    getUserApiKeys: jest.fn(),
    findActiveApiKeyIds: jest.fn(),
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
    dispatchWaveSize: jest.fn().mockReturnValue(50),
  }

  const mockBatchStatus = {
    refresh: jest.fn().mockResolvedValue(undefined),
  }

  const mockUsersService = {
    markMilestone: jest.fn().mockResolvedValue(false),
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
          provide: getModelToken(SMSPartReport.name),
          useValue: mockSmsPartReportModel,
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
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: UserRollupService,
          useValue: { refreshQuietly: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SmsBatchStatusService,
          useValue: mockBatchStatus,
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

    it('stores the install id of a registration as pushInstallId only', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })

      await service.registerDevice(
        { ...mockDeviceInput, installId: 'install-a' },
        mockUser,
      )

      const created = mockDeviceModel.create.mock.calls[0][0]
      expect(created.pushInstallId).toBe('install-a')
      expect(created).not.toHaveProperty('installId')
    })

    it('carries the install id through the re-registration of an old device', async () => {
      const oldDevice = { ...mockDevice, fcmToken: 'old-token', enabled: true }
      mockDeviceModel.findOne.mockResolvedValue(oldDevice)
      mockDeviceModel.findById.mockResolvedValue(oldDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(oldDevice)

      await service.registerDevice(
        { ...mockDeviceInput, fcmToken: 'new-token', installId: 'install-a' },
        mockUser,
      )

      const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
      expect(update.$set.pushInstallId).toBe('install-a')
      expect(update.$set.fcmToken).toBe('new-token')
      expect(update.$set).not.toHaveProperty('installId')
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

    describe('app version history', () => {
      beforeEach(() => {
        mockDeviceModel.findOne.mockResolvedValue(null)
        mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
        mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })
      })

      it('starts the history of a new device in the create, not seeded', async () => {
        const lastUpdate = Date.now() - 60 * 1000
        await service.registerDevice(
          {
            ...mockDeviceInput,
            appVersionCode: 22,
            appVersionName: '2.10.0',
            installerPackage: 'com.android.vending',
            initiatingPackage: 'com.android.chrome',
            appLastUpdateTime: lastUpdate,
          } as RegisterDeviceInputDTO,
          mockUser,
        )

        const created = mockDeviceModel.create.mock.calls[0][0]
        expect(created).toEqual(
          expect.objectContaining({
            appVersionKey: '22|2.10.0|com.android.vending',
            installSource: 'play_store',
            installerPackage: 'com.android.vending',
            initiatingPackage: 'com.android.chrome',
            appVersionLastSeenAt: expect.any(Date),
            appVersionHistory: [
              {
                versionCode: 22,
                versionName: '2.10.0',
                installSource: 'play_store',
                installerPackage: 'com.android.vending',
                installedAt: new Date(lastUpdate),
                firstSeenAt: expect.any(Date),
                seeded: false,
              },
            ],
          }),
        )
        expect(created).not.toHaveProperty('appLastUpdateTime')
        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
      })

      it('drops bad install values and still registers the device', async () => {
        await service.registerDevice(
          {
            ...mockDeviceInput,
            appVersionCode: 21,
            appVersionName: '2.9.0',
            installerPackage: 'not/a/package',
            initiatingPackage: 12,
            appLastUpdateTime: 'yesterday',
          } as unknown as RegisterDeviceInputDTO,
          mockUser,
        )

        const created = mockDeviceModel.create.mock.calls[0][0]
        expect(created.appVersionKey).toBe('21|2.9.0|~')
        expect(created.installSource).toBe('unknown')
        expect(created).not.toHaveProperty('installerPackage')
        expect(created).not.toHaveProperty('initiatingPackage')
        expect(created).not.toHaveProperty('appLastUpdateTime')
      })

      it('starts no history when the registration reports no version', async () => {
        await service.registerDevice(
          { ...mockDeviceInput, installerPackage: '' } as RegisterDeviceInputDTO,
          mockUser,
        )

        const created = mockDeviceModel.create.mock.calls[0][0]
        expect(created).not.toHaveProperty('appVersionHistory')
        expect(created).not.toHaveProperty('appVersionKey')
        expect(created).not.toHaveProperty('installerPackage')
      })

      it('hands the raw install values to the device update of a re-registration', async () => {
        mockDeviceModel.findOne.mockResolvedValue({
          _id: 'device123',
          appVersionCode: 11,
        })
        const updateDevice = jest
          .spyOn(service, 'updateDevice')
          .mockResolvedValue({ _id: 'device123' })

        await service.registerDevice(
          {
            ...mockDeviceInput,
            appVersionCode: 22,
            installerPackage: 'com.android.vending',
          } as RegisterDeviceInputDTO,
          mockUser,
        )

        expect(updateDevice).toHaveBeenCalledWith(
          'device123',
          expect.objectContaining({ installerPackage: 'com.android.vending' }),
        )
        updateDevice.mockRestore()
      })
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

    it('drops an appVersionCode of 0, which older builds send when unset', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.create.mockResolvedValue({ _id: 'device123' })

      await service.registerDevice(
        { ...mockDeviceInput, appVersionCode: 0 },
        mockUser,
      )

      expect(mockDeviceModel.create).toHaveBeenCalledWith(
        expect.not.objectContaining({ appVersionCode: 0 }),
      )
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

    it('records the API key a new device registered with', async () => {
      const apiKeyId = new Types.ObjectId()
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.countDocuments.mockResolvedValue(1)
      mockDeviceModel.create.mockResolvedValue({ _id: 'device456' })

      await service.registerDevice(mockDeviceInput, mockUser, apiKeyId)

      const created = mockDeviceModel.create.mock.calls[0][0]
      expect(String(created.apiKey)).toBe(String(apiKeyId))
    })

    it('records the API key in the update write when an old build registers again', async () => {
      const apiKeyId = new Types.ObjectId()
      mockDeviceModel.findOne.mockResolvedValue(mockDevice)
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.registerDevice(mockDeviceInput, mockUser, apiKeyId)

      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set
      expect(String(update.apiKey)).toBe(String(apiKeyId))
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

    it('should ignore client-sent closed notice ids', async () => {
      mockDeviceModel.findOne.mockResolvedValue(null)
      mockBillingService.getUserLimits.mockResolvedValue({ deviceLimit: -1 })
      mockDeviceModel.countDocuments.mockResolvedValue(1)
      mockDeviceModel.create.mockResolvedValue({ _id: 'device456' })

      await service.registerDevice(
        { ...mockDeviceInput, closedNoticeIds: ['n-1'] } as any,
        mockUser,
      )

      const created = mockDeviceModel.create.mock.calls[0][0]
      expect(created).not.toHaveProperty('closedNoticeIds')
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
    
    const DeviceModel = mongoose.model(
      'GatewayServiceDeviceListSpec',
      DeviceSchema,
    )
    // A stored device as the database returns it
    const stored = (fields: Record<string, unknown>) =>
      DeviceModel.hydrate(fields)
    const mockDevices = [
      stored({ _id: new Types.ObjectId(), model: 'Pixel 6' }),
      stored({ _id: new Types.ObjectId(), model: 'iPhone 13' }),
    ]

    const findDevices = (devices: any[]) =>
      mockDeviceModel.find.mockResolvedValue(devices)

    it('should return a user\'s devices without the push token or serial', async () => {
      findDevices(mockDevices)

      const result = await service.getDevicesForUser(mockUser)

      const [filter, projection] = mockDeviceModel.find.mock.calls[0]
      expect(filter).toEqual({ user: mockUser._id })
      // fcmToken is a push credential and serial is a hardware id; neither
      // should be shipped to the browser in the device list.
      expect(projection).toContain('-fcmToken')
      expect(projection).toContain('-serial')
      expect(result).toEqual(
        mockDevices.map((device) => ({
          ...device.toJSON(),
          apiKeyRevoked: false,
        })),
      )
      // Devices with no recorded key need no key lookup
      expect(mockAuthService.findActiveApiKeyIds).not.toHaveBeenCalled()
    })

    it('marks a device whose recorded API key is revoked, without returning the key', async () => {
      const activeKeyId = new Types.ObjectId()
      const revokedKeyId = new Types.ObjectId()
      findDevices([
        stored({
          _id: new Types.ObjectId(),
          model: 'Pixel 6',
          apiKey: activeKeyId,
        }),
        stored({
          _id: new Types.ObjectId(),
          model: 'Pixel 7',
          apiKey: revokedKeyId,
        }),
        stored({ _id: new Types.ObjectId(), model: 'Pixel 8' }),
      ])
      mockAuthService.findActiveApiKeyIds.mockResolvedValue(
        new Set([String(activeKeyId)]),
      )

      const result = await service.getDevicesForUser(mockUser)

      expect(mockDeviceModel.find.mock.calls[0][1]).toContain('+apiKey')
      expect(mockAuthService.findActiveApiKeyIds).toHaveBeenCalledTimes(1)
      expect(mockAuthService.findActiveApiKeyIds).toHaveBeenCalledWith(
        mockUser._id,
        [activeKeyId, revokedKeyId],
      )
      expect(result.map((device) => device.apiKeyRevoked)).toEqual([
        false,
        true,
        false,
      ])
      for (const device of result) {
        expect(device).not.toHaveProperty('apiKey')
      }
      expect(JSON.stringify(result)).not.toContain(String(revokedKeyId))
    })

    it('returns an older stored device with its schema defaults, the same as before plus apiKeyRevoked', async () => {
      const _id = new Types.ObjectId()
      const user = new Types.ObjectId()
      const apiKeyId = new Types.ObjectId()
      findDevices([stored({ _id, user, model: 'Pixel 5', apiKey: apiKeyId })])
      mockAuthService.findActiveApiKeyIds.mockResolvedValue(
        new Set([String(apiKeyId)]),
      )

      const [device] = await service.getDevicesForUser(mockUser)

      expect(device).toEqual({
        _id,
        user,
        model: 'Pixel 5',
        enabled: false,
        isDefault: false,
        sentSMSCount: 0,
        receivedSMSCount: 0,
        heartbeatEnabled: true,
        heartbeatIntervalMinutes: 30,
        receiveSMSEnabled: false,
        smsSendDelaySeconds: 5,
        apiKeyRevoked: false,
      })
      expect(device).not.toHaveProperty('apiKey')
    })

    it('keeps the recorded API key out of every default device read and every serialized device', () => {
      expect(DeviceSchema.path('apiKey').options.select).toBe(false)

      const json = new DeviceModel({
        model: 'Pixel 8',
        apiKey: new Types.ObjectId(),
      }).toJSON()
      expect(json).not.toHaveProperty('apiKey')
      expect(json.model).toBe('Pixel 8')
    })

    it('keeps the dispatch backlog fields out of every default device read', () => {
      expect(DeviceSchema.path('dispatchBusyUntil').options.select).toBe(false)
      expect(DeviceSchema.path('dispatchPriorityBusyUntil').options.select).toBe(false)
    })

    it('keeps the closed notice ids out of every default device read', () => {
      expect(DeviceSchema.path('closedNoticeIds').options.select).toBe(false)
    })

    it('never serializes server-side device state, which the document still holds', () => {
      const at = new Date()
      const doc = new DeviceModel({
        name: 'Office',
        enabled: true,
        heartbeatIntervalMinutes: 15,
        fcmToken: 'token-a',
        serial: 'serial-a',
        fcmTokenUpdatedAt: at,
        fcmTokenInvalidatedAt: at,
        fcmTokenInvalidReason: 'unregistered',
        configOverrides: { pullEnabled: true },
        lastPendingPollAt: at,
        installId: 'install-a',
        pushInstallId: 'install-a',
        pullInfo: { pullCapable: true, lastUpdated: at },
        lastClaimAt: at,
        dispatchBusyUntil: at,
        dispatchPriorityBusyUntil: at,
        appStateInfo: { hasSendSmsPermission: true },
        osVersionSource: 'reported',
        closedNoticeIds: ['update-22-2026-46'],
      })

      const json = JSON.parse(JSON.stringify(doc))
      for (const field of DEVICE_HIDDEN_FIELDS) {
        expect(json).not.toHaveProperty(field)
      }
      // What the app reads from the registration and update replies stays
      expect(json).toMatchObject({
        _id: String(doc._id),
        name: 'Office',
        enabled: true,
        heartbeatIntervalMinutes: 15,
        appStateInfo: { hasSendSmsPermission: true },
        osVersionSource: 'reported',
      })
      expect(doc.configOverrides).toEqual({ pullEnabled: true })
      expect(doc.pushInstallId).toBe('install-a')
      expect(doc.fcmToken).toBe('token-a')
    })

    it('keeps the app version history fields out of every default device read and every serialized device', () => {
      const hidden = [
        'installSource',
        'installerPackage',
        'initiatingPackage',
        'appVersionHistory',
        'appVersionKey',
        'appVersionLastSeenAt',
        'appVersionFlapCount',
      ]
      for (const field of hidden) {
        expect(DeviceSchema.path(field).options.select).toBe(false)
      }

      const json = new DeviceModel({
        model: 'Pixel 8',
        installSource: 'play_store',
        installerPackage: 'com.android.vending',
        initiatingPackage: 'com.android.chrome',
        appVersionHistory: [
          {
            versionCode: 22,
            versionName: '2.10.0',
            installSource: 'play_store',
            installerPackage: 'com.android.vending',
            firstSeenAt: new Date(),
            seeded: false,
          },
        ],
        appVersionKey: '22|2.10.0|com.android.vending',
        appVersionLastSeenAt: new Date(),
        appVersionFlapCount: 1,
      }).toJSON()
      for (const field of hidden) {
        expect(json).not.toHaveProperty(field)
      }
      expect(json.model).toBe('Pixel 8')
    })

    it('stores app version history entries without an id of their own', () => {
      const firstSeenAt = new Date('2026-11-12T12:00:00.000Z')
      const device = new DeviceModel({
        appVersionHistory: [
          { versionCode: 22, installSource: 'apk', installerPackage: '', firstSeenAt, seeded: true },
        ],
      })

      expect(device.toObject().appVersionHistory).toEqual([
        { versionCode: 22, installSource: 'apk', installerPackage: '', firstSeenAt, seeded: true },
      ])
      expect(new DeviceModel({}).toObject().appVersionHistory).toBeUndefined()
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
        { returnDocument: 'after' },
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

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(
        mockDeviceId,
        APP_VERSION_HISTORY_PROJECTION,
      )
      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockDeviceId,
        { $set: mockDeviceInput },
        { returnDocument: 'after' },
      )
      expect(result).toBeDefined()
    })

    it('should ignore client-sent closed notice ids', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, {
        ...mockDeviceInput,
        closedNoticeIds: ['n-1'],
      } as any)

      const $set = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set
      expect($set).not.toHaveProperty('closedNoticeIds')
    })

    it('should throw an error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(
        service.updateDevice(mockDeviceId, mockDeviceInput),
      ).rejects.toThrow(HttpException)
      expect(mockDeviceModel.findById).toHaveBeenCalledWith(
        mockDeviceId,
        APP_VERSION_HISTORY_PROJECTION,
      )
      expect(mockDeviceModel.findByIdAndUpdate).not.toHaveBeenCalled()
    })

    describe('app version history', () => {
      const KEY_21 = '21|2.9.0|com.android.vending'
      const trackedDevice = {
        ...mockDevice,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        appVersionCode: 21,
        appVersionName: '2.9.0',
        appVersionKey: KEY_21,
      }

      beforeEach(() => {
        mockDeviceModel.findById.mockResolvedValue(trackedDevice)
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(trackedDevice)
      })

      it('records a new version before the device write and keeps raw install values out of it', async () => {
        mockDeviceModel.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
        await service.updateDevice(mockDeviceId, {
          appVersionCode: 22,
          appVersionName: '2.10.0',
          installerPackage: 'com.android.vending',
          appLastUpdateTime: Date.now(),
        } as any)

        expect(mockDeviceModel.updateOne).toHaveBeenCalledTimes(1)
        const [filter, update, options] = mockDeviceModel.updateOne.mock.calls[0]
        expect(filter).toEqual({ _id: mockDeviceId, appVersionKey: KEY_21 })
        expect(update[0].$set.appVersionKey).toEqual({
          $literal: '22|2.10.0|com.android.vending',
        })
        expect(options).toEqual({ updatePipeline: true, timestamps: false })
        expect(mockDeviceModel.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
          mockDeviceModel.findByIdAndUpdate.mock.invocationCallOrder[0],
        )

        const $set = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set
        expect($set.appVersionLastSeenAt).toBeInstanceOf(Date)
        expect($set).not.toHaveProperty('installerPackage')
        expect($set).not.toHaveProperty('initiatingPackage')
        expect($set).not.toHaveProperty('appLastUpdateTime')
      })

      it('makes no extra write when the version and installer are unchanged', async () => {
        await service.updateDevice(mockDeviceId, {
          appVersionCode: 21,
          appVersionName: '2.9.0',
          installerPackage: 'com.android.vending',
        } as any)

        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        expect(
          mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set.appVersionLastSeenAt,
        ).toBeInstanceOf(Date)
      })

      it('leaves the history alone for an update without a version', async () => {
        await service.updateDevice(mockDeviceId, { name: 'Office phone' } as any)

        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
        expect(mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set).toEqual({
          name: 'Office phone',
        })
      })
    })

    it('records no API key on a device update', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, { name: 'Office' })

      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set
      expect(update).not.toHaveProperty('apiKey')
    })

    it('does not re-enable a disabled device when the update omits enabled', async () => {
      mockDeviceModel.findById.mockResolvedValue({ ...mockDevice, enabled: false })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, { fcmToken: 'rotated' })

      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1]
      expect(update.$set).not.toHaveProperty('enabled')
      expect(mockBillingService.getUserLimits).not.toHaveBeenCalled()
    })

    it('drops an appVersionCode of 0 so a partial update cannot zero the stored one', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, { fcmToken: 'x', appVersionCode: 0 })

      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1]
      expect(update.$set).not.toHaveProperty('appVersionCode')
    })

    it('clears a token invalidation when any token is reported, changed or not', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        fcmToken: 'same',
        fcmTokenInvalidatedAt: new Date(),
      })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

      await service.updateDevice(mockDeviceId, { fcmToken: 'same' })

      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1]
      expect(update.$unset).toEqual({
        fcmTokenInvalidatedAt: 1,
        fcmTokenInvalidReason: 1,
      })
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

    describe('simNumbers', () => {
      it('stores cleaned numbers, keeping slots the request leaves out', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          simNumbers: [
            { slotIndex: 0, phoneNumber: '+15555550123' },
            { slotIndex: 1, phoneNumber: '+15555550177' },
          ],
        })
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

        await service.updateDevice(mockDeviceId, {
          simNumbers: [{ slotIndex: 1, phoneNumber: '+1 (555) 555-0199' }],
        })

        const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
        expect(update.$set.simNumbers).toEqual([
          { slotIndex: 0, phoneNumber: '+15555550123' },
          { slotIndex: 1, phoneNumber: '+15555550199' },
        ])
      })

      it('removes a slot sent with an empty number', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          simNumbers: [{ slotIndex: 0, phoneNumber: '+15555550123' }],
        })
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

        await service.updateDevice(mockDeviceId, {
          simNumbers: [{ slotIndex: 0, phoneNumber: '' }],
        })

        const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
        expect(update.$set.simNumbers).toEqual([])
      })

      it('treats simNumbers null as absent', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          simNumbers: [{ slotIndex: 0, phoneNumber: '+15555550123' }],
        })
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

        await service.updateDevice(mockDeviceId, { name: 'Office', simNumbers: null })

        const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
        expect(update.$set).not.toHaveProperty('simNumbers')
        expect(update.$set.name).toBe('Office')
      })

      it('leaves stored numbers alone when the update has none, as the phone sends it', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          simNumbers: [{ slotIndex: 0, phoneNumber: '+15555550123' }],
        })
        mockDeviceModel.findByIdAndUpdate.mockResolvedValue(mockDevice)

        await service.updateDevice(mockDeviceId, { fcmToken: 'rotated' })

        const [, update] = mockDeviceModel.findByIdAndUpdate.mock.calls[0]
        expect(update.$set).not.toHaveProperty('simNumbers')
      })

      it.each([
        [
          [{ slotIndex: 8, phoneNumber: '+15555550123' }],
          'simNumbers needs one entry per SIM slot, with slotIndex from 0 to 7.',
        ],
        [
          [
            { slotIndex: 0, phoneNumber: '+15555550123' },
            { slotIndex: 0, phoneNumber: '+15555550177' },
          ],
          'simNumbers needs one entry per SIM slot, with slotIndex from 0 to 7.',
        ],
        [
          [{ slotIndex: 0, phoneNumber: 'office' }],
          'Enter the phone number with digits only, for example +15555550123.',
        ],
      ])('refuses %j with a 400 and writes nothing', async (simNumbers, error) => {
        mockDeviceModel.findById.mockResolvedValue(mockDevice)

        await expect(
          service.updateDevice(mockDeviceId, { simNumbers } as any),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: { success: false, error },
        })
        expect(mockDeviceModel.findByIdAndUpdate).not.toHaveBeenCalled()
      })
    })
  })

  describe('deleteDevice', () => {
    const mockDeviceId = '507f1f77bcf86cd799439011'
    const mockUserId = '507f1f77bcf86cd799439012'
    const mockDevice = {
      _id: mockDeviceId,
      user: mockUserId,
      brand: 'google',
      model: 'Pixel 6',
      appVersionName: '2.4.0',
      sentSMSCount: 42,
    }
    const leanFindById = (value: any) =>
      mockDeviceModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue(value),
      })

    it('should tombstone and delete when device exists', async () => {
      leanFindById(mockDevice)

      const result = await service.deleteDevice(mockDeviceId)

      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockDeviceTombstoneModel.updateOne).toHaveBeenCalled()
      expect(mockDeviceModel.findByIdAndDelete).toHaveBeenCalledWith(mockDeviceId)
      expect(result).toEqual({ success: true })
    })

    it('should keep the whole device document on the tombstone', async () => {
      leanFindById(mockDevice)

      await service.deleteDevice(mockDeviceId)

      const [filter, update, options] =
        mockDeviceTombstoneModel.updateOne.mock.calls[0]
      expect(filter.deviceId.toString()).toBe(mockDeviceId)
      expect(update.$setOnInsert.device).toEqual(mockDevice)
      expect(update.$setOnInsert.userId).toBe(mockUserId)
      expect(update.$setOnInsert.deletedAt).toBeInstanceOf(Date)
      expect(options).toEqual({ upsert: true })
    })

    it('should take back the tombstone when the delete fails', async () => {
      leanFindById(mockDevice)
      mockDeviceTombstoneModel.updateOne.mockResolvedValue({ upsertedCount: 1 })
      mockDeviceModel.exists.mockResolvedValueOnce({ _id: mockDeviceId })
      mockDeviceModel.findByIdAndDelete.mockRejectedValueOnce(
        new Error('write failed'),
      )

      await expect(service.deleteDevice(mockDeviceId)).rejects.toThrow(
        'write failed',
      )
      expect(
        String(mockDeviceTombstoneModel.deleteOne.mock.calls[0][0].deviceId),
      ).toBe(mockDeviceId)
    })

    it('should keep the tombstone when the delete landed before the error', async () => {
      leanFindById(mockDevice)
      mockDeviceTombstoneModel.updateOne.mockResolvedValue({ upsertedCount: 1 })
      mockDeviceModel.findByIdAndDelete.mockRejectedValueOnce(
        new Error('write failed'),
      )
      // The device is gone, so the tombstone is the only copy left.
      mockDeviceModel.exists.mockResolvedValueOnce(null)

      await expect(service.deleteDevice(mockDeviceId)).rejects.toThrow(
        'write failed',
      )
      expect(mockDeviceTombstoneModel.deleteOne).not.toHaveBeenCalled()
    })

    it('should keep an earlier tombstone when a retry fails', async () => {
      leanFindById(mockDevice)
      // Matched, not inserted: the tombstone predates this call.
      mockDeviceTombstoneModel.updateOne.mockResolvedValue({ upsertedCount: 0 })
      mockDeviceModel.findByIdAndDelete.mockRejectedValueOnce(
        new Error('write failed'),
      )

      await expect(service.deleteDevice(mockDeviceId)).rejects.toThrow(
        'write failed',
      )
      expect(mockDeviceTombstoneModel.deleteOne).not.toHaveBeenCalled()
    })

    it('should throw an error if device does not exist', async () => {
      leanFindById(null)

      await expect(service.deleteDevice(mockDeviceId)).rejects.toThrow(
        HttpException,
      )
      expect(mockDeviceModel.findById).toHaveBeenCalledWith(mockDeviceId)
      expect(mockDeviceTombstoneModel.updateOne).not.toHaveBeenCalled()
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
      mockBillingService.canPerformAction.mockResolvedValue({ overLimit: false })
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

    it('warns when the phone reports the SMS permission off', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        appStateInfo: { hasSendSmsPermission: false, lastUpdated: new Date() },
      })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const result = await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalled()
      expect(result).toHaveProperty('smsBatchId', mockSmsBatch._id)
      expect(result.warning).toEqual({
        code: 'SMS_PERMISSION_MISSING',
        message:
          'The textbee app on this phone last reported the SMS permission as off. The message fails if it is still off.',
      })
    })

    it('adds no warning for a report older than 7 days', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        appStateInfo: {
          hasSendSmsPermission: false,
          lastUpdated: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
      })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const result = await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(result).not.toHaveProperty('warning')
    })

    it('adds no warning when the permission is on or unknown', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      const result = await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(result).not.toHaveProperty('warning')
    })

    it('stores the app version the device was on when queued', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        appVersionInfo: { versionCode: 18, versionName: '2.8.0' },
      })

      await service.sendSMS(mockDeviceId, mockSmsInput)

      expect(mockSmsModel.create.mock.calls[0][0].metadata).toEqual({
        appVersionCode: 18,
        appVersionName: '2.8.0',
        appVersionAt: expect.any(Date),
      })
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

    it('rejects a sender name before billing or queueing', async () => {
      await expect(
        service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          recipients: ['+15555550100', 'MYBANK'],
        }),
      ).rejects.toMatchObject({
        response: { error: expect.stringContaining('Invalid recipients: "MYBANK"') },
      })
      expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
      expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
    })

    it('accepts a short code and a local number', async () => {
      await service.sendSMS(mockDeviceId, {
        ...mockSmsInput,
        recipients: ['605', '5555550100'],
      })

      expect(mockBillingService.canPerformAction).toHaveBeenCalled()
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

      expect(mockSmsQueueService.planSendSmsJob).toHaveBeenCalledWith(3, undefined, 7, 0)
      expect(mockSmsQueueService.addSendSmsJob).toHaveBeenCalledWith(
        mockDeviceId,
        expect.any(Array),
        mockSmsBatch._id,
        undefined,
        7,
        plan,
        7_000,
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
      mockSmsModel.bulkWrite.mockRejectedValue(new Error('write failed'))

      await expect(
        service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          recipients: ['+15550100', '+15550101'],
        }),
      ).rejects.toThrow(HttpException)

      expect(mockSmsQueueService.addSendSmsJob).not.toHaveBeenCalled()
      mockSmsModel.bulkWrite.mockReset()
      expect(mockSmsBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
        mockSmsBatch._id,
        { $set: { error: 'write failed' } },
      )
      // Only messages that never left the server are marked failed
      const [unsentFilter, unsentUpdate, unsentOptions] = mockSmsModel.updateMany.mock.calls[0]
      expect(unsentFilter).toEqual({ smsBatch: mockSmsBatch._id, status: 'pending' })
      expect(unsentOptions).toEqual({ updatePipeline: true })
      const unsent = readPipelineUpdate(unsentUpdate)
      expect(unsent.set).toEqual({
        status: 'failed',
        failedAt: expect.any(Date),
        errorCode: 'DISPATCH_FAILED',
        errorMessage: 'write failed',
      })
      expect(unsent.history).toEqual([
        expect.objectContaining({ code: 'DISPATCH_FAILED', source: 'server' }),
      ])
      // The status comes from the messages, after they are marked
      expect(mockBatchStatus.refresh).toHaveBeenCalledWith([mockSmsBatch._id])
      expect(mockSmsModel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        mockBatchStatus.refresh.mock.invocationCallOrder[0],
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

    it('names the target device in the push data of a single send', async () => {
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(singleWavePlan)
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])

      await service.sendSMS(mockDeviceId, mockSmsInput)

      const [, fcmMessages] = mockSmsQueueService.addSendSmsJob.mock.calls[0]
      expect(fcmMessages[0].data.deviceId).toBe(mockDeviceId)
      expect(typeof fcmMessages[0].data.smsData).toBe('string')
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

    it('fails the unsent messages and refreshes the batch when no push goes out', async () => {
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValueOnce({
        successCount: 0,
        failureCount: 1,
        responses: [],
      })
      mockSmsModel.updateMany.mockResolvedValue({ modifiedCount: 1 })

      await expect(service.sendSMS(mockDeviceId, mockSmsInput)).rejects.toThrow(
        HttpException,
      )

      const [unsentFilter, unsentUpdate, unsentOptions] = mockSmsModel.updateMany.mock.calls[0]
      expect(unsentFilter).toEqual({ smsBatch: mockSmsBatch._id, status: 'pending' })
      expect(unsentOptions).toEqual({ updatePipeline: true })
      const unsent = readPipelineUpdate(unsentUpdate)
      expect(unsent.set).toEqual({
        status: 'failed',
        failedAt: expect.any(Date),
        errorCode: 'DISPATCH_FAILED',
        errorMessage: expect.any(String),
      })
      expect(unsent.history).toEqual([
        expect.objectContaining({ code: 'DISPATCH_FAILED', source: 'server' }),
      ])
      expect(mockBatchStatus.refresh).toHaveBeenCalledWith([mockSmsBatch._id])
    })

    it('withholds the push for a listed user and marks the batch', async () => {
      process.env.FCM_SEND_SKIP_USER_IDS = String(mockDevice.user)
      try {
        const result = await service.sendSMS(mockDeviceId, mockSmsInput)

        expect(firebaseAdmin.messaging().sendEach).not.toHaveBeenCalled()
        expect(result.successCount).toBe(1)
        expect(mockSmsModel.updateMany).toHaveBeenCalledWith(
          { smsBatch: mockSmsBatch._id },
          { $set: { errorCode: 'FCM_SEND_SKIPPED' } },
        )
        expect(mockBatchStatus.refresh).toHaveBeenCalledWith([mockSmsBatch._id])
        expect(mockSmsBatchModel.findByIdAndUpdate).not.toHaveBeenCalledWith(
          mockSmsBatch._id,
          { $set: { status: 'completed' } },
        )
      } finally {
        delete process.env.FCM_SEND_SKIP_USER_IDS
      }
    })

    it('sends normally for a device that is not listed', async () => {
      process.env.FCM_SEND_SKIP_DEVICE_IDS = 'some-other-device'
      try {
        await service.sendSMS(mockDeviceId, mockSmsInput)

        expect(firebaseAdmin.messaging().sendEach).toHaveBeenCalled()
      } finally {
        delete process.env.FCM_SEND_SKIP_DEVICE_IDS
      }
    })

    describe('SIM selection', () => {
      const dualSim = {
        sims: [
          { subscriptionId: 3, simSlotIndex: 0 },
          { subscriptionId: 7, simSlotIndex: 1 },
        ],
      }
      const pushedPayloads = () =>
        (firebaseAdmin.messaging().sendEach as jest.Mock).mock.calls
          .flatMap(([messages]) => messages)
          .map((m) => m.data.smsData)

      it('keeps a simSubscriptionId-only send exactly as before', async () => {
        await service.sendSMS(mockDeviceId, { ...mockSmsInput, simSubscriptionId: 2 })

        expect(mockSmsModel.create).toHaveBeenCalledWith({
          user: mockDevice.user,
          device: mockDevice._id,
          smsBatch: mockSmsBatch._id,
          message: 'Hello there',
          type: SMSType.SENT,
          recipient: '+123456789',
          requestedAt: expect.any(Date),
          status: 'pending',
          simSubscriptionId: 2,
          metadata: {},
        })
        expect(pushedPayloads()).toEqual([
          '{"smsId":"sms123","smsBatchId":"batch123","message":"Hello there","recipients":["+123456789"],"simSubscriptionId":2,"smsBody":"Hello there","receivers":["+123456789"]}',
        ])
      })

      it('sends the slot and the mapped id to an older app, and stores both apart', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          appVersionCode: 20,
          simInfo: dualSim,
        })

        await service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          simSlotIndex: 1,
          simSubscriptionId: 3,
        })

        const doc = mockSmsModel.create.mock.calls[0][0]
        expect(doc.simSlotIndex).toBe(1)
        expect(doc).not.toHaveProperty('simSubscriptionId')
        expect(doc.metadata).toMatchObject({
          appVersionCode: 20,
          simMappedSubscriptionId: 7,
        })
        expect(JSON.parse(pushedPayloads()[0])).toMatchObject({
          simSlotIndex: 1,
          simSubscriptionId: 7,
        })
      })

      it('sends only the slot when the slot release has no SIM report for it', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...mockDevice,
          appVersionInfo: { versionCode: 22 },
        })

        await service.sendSMS(mockDeviceId, { ...mockSmsInput, simSlotIndex: 0 })

        const doc = mockSmsModel.create.mock.calls[0][0]
        expect(doc.simSlotIndex).toBe(0)
        expect(doc.metadata).not.toHaveProperty('simMappedSubscriptionId')
        const payload = JSON.parse(pushedPayloads()[0])
        expect(payload.simSlotIndex).toBe(0)
        expect(payload).not.toHaveProperty('simSubscriptionId')
      })

      it.each([
        [
          'an invalid slot',
          { ...mockDevice, appVersionCode: 22 },
          { simSlotIndex: 8 },
          'simSlotIndex must be a whole number from 0 to 7. 0 is SIM 1, 1 is SIM 2.',
        ],
        [
          'an app with no SIM report',
          { ...mockDevice, appVersionCode: 20 },
          { simSlotIndex: 0 },
          "This device's textbee app cannot choose a SIM. Update the app, or send without simSlotIndex.",
        ],
        [
          'an older app whose report shows no SIM in the slot',
          { ...mockDevice, appVersionCode: 20, simInfo: dualSim },
          { simSlotIndex: 2 },
          "The phone's last report shows no SIM 3 (simSlotIndex 2). Open the textbee app to refresh, or update the app.",
        ],
      ])('refuses %s before billing or creating anything', async (_name, device, sim, error) => {
        mockDeviceModel.findById.mockResolvedValue(device)

        await expect(
          service.sendSMS(mockDeviceId, { ...mockSmsInput, ...sim } as SendSMSInputDTO),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: { success: false, error },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
        expect(mockSmsModel.create).not.toHaveBeenCalled()
      })

      it.each([1.5, true, 3000000000, 'sim1'])(
        'refuses simSubscriptionId %p before billing or creating anything',
        async (simSubscriptionId) => {
          await expect(
            service.sendSMS(mockDeviceId, {
              ...mockSmsInput,
              simSubscriptionId,
            } as unknown as SendSMSInputDTO),
          ).rejects.toMatchObject({
            status: HttpStatus.BAD_REQUEST,
            response: {
              success: false,
              error: expect.stringContaining('simSubscriptionId must be a whole number from 0 to 2147483646'),
            },
          })
          expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
          expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
        },
      )

      it('stores and pushes a simSubscriptionId sent as a string of digits as a number', async () => {
        await service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          simSubscriptionId: '2',
        } as unknown as SendSMSInputDTO)

        expect(mockSmsModel.create.mock.calls[0][0].simSubscriptionId).toBe(2)
        expect(JSON.parse(pushedPayloads()[0]).simSubscriptionId).toBe(2)
      })

      it.each([null, '', -1, 2147483647])(
        'sends %p as no SIM chosen',
        async (simSubscriptionId) => {
          await service.sendSMS(mockDeviceId, {
            ...mockSmsInput,
            simSubscriptionId,
          } as unknown as SendSMSInputDTO)

          expect(mockSmsModel.create.mock.calls[0][0]).not.toHaveProperty('simSubscriptionId')
          expect(JSON.parse(pushedPayloads()[0])).not.toHaveProperty('simSubscriptionId')
        },
      )
    })

    describe('message size', () => {
      it.each([
        ['an object', { text: 'hi' }],
        ['an array', ['hi']],
      ])('refuses %s as message before billing or creating anything', async (_name, message) => {
        await expect(
          service.sendSMS(mockDeviceId, { ...mockSmsInput, message } as any),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: { success: false, error: 'message must be text.' },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
      })

      it('still sends a number as message, as before', async () => {
        await service.sendSMS(mockDeviceId, { ...mockSmsInput, message: 12345 } as any)

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
        expect(mockSmsModel.create.mock.calls[0][0].message).toBe(12345)
      })
      it('sends a message of exactly 9000 bytes', async () => {
        await service.sendSMS(mockDeviceId, {
          ...mockSmsInput,
          message: 'a'.repeat(9000),
        })

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
      })

      it.each([
        ['9001 Latin letters', 'a'.repeat(9001), 9001],
        ['3001 Chinese characters', '\u4e2d'.repeat(3001), 9003],
        ['1501 emoji', '\u{1F600}'.repeat(1501), 9006],
      ])('refuses %s before billing or creating anything', async (_name, message, bytes) => {
        await expect(
          service.sendSMS(mockDeviceId, { ...mockSmsInput, message }),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: {
            success: false,
            error: expect.stringContaining(`message is ${bytes} bytes long. The limit is 9000 bytes`),
          },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
      })

      it('checks the legacy smsBody when message is absent', async () => {
        await expect(
          service.sendSMS(mockDeviceId, {
            ...mockSmsInput,
            message: undefined,
            smsBody: 'a'.repeat(9001),
          }),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
      })
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
      mockBillingService.canPerformAction.mockResolvedValue({ overLimit: false })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(false)
      
      // Fix the mock
      jest.spyOn(firebaseAdmin.messaging(), 'sendEach').mockResolvedValue(mockFcmResponse)
    })


    it('rejects a message whose recipients is not an array before billing', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)

      await expect(
        service.sendBulkSMS(mockDeviceId, {
          ...mockBulkSmsInput,
          messages: [
            ...mockBulkSmsInput.messages,
            { message: 'Hello Bank', recipients: 'MYBANK' },
          ],
        } as unknown as SendBulkSMSInputDTO),
      ).rejects.toMatchObject({
        response: { error: 'Invalid message list' },
      })
      expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
    })

    it('rejects the whole request when any recipient is a sender name', async () => {
      mockDeviceModel.findById.mockResolvedValue(mockDevice)

      await expect(
        service.sendBulkSMS(mockDeviceId, {
          ...mockBulkSmsInput,
          messages: [
            ...mockBulkSmsInput.messages,
            { message: 'Hello Bank', recipients: ['MYBANK'] },
          ],
        } as SendBulkSMSInputDTO),
      ).rejects.toMatchObject({
        response: { error: expect.stringContaining('Invalid recipients: "MYBANK"') },
      })
      expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
      expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
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
      const [, queued] = mockSmsQueueService.addSendSmsJob.mock.calls[0]
      for (const message of queued) {
        expect(message.data.deviceId).toBe(mockDeviceId)
      }
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
      mockSmsQueueService.removeJobs.mockImplementation(async (jobs) => jobs)
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
      const [filter, update] = mockSmsModel.updateMany.mock.calls[0]
      expect(filter).toEqual({ smsBatch: mockSmsBatch._id, status: 'pending' })
      expect(readPipelineUpdate(update).set.status).toBe('failed')
      expect(mockBatchStatus.refresh).toHaveBeenCalledWith([mockSmsBatch._id])
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

    describe('SIM selection', () => {
      const oldAppDevice = {
        ...mockDevice,
        appVersionCode: 20,
        simInfo: {
          sims: [
            { subscriptionId: 3, simSlotIndex: 0 },
            { subscriptionId: 7, simSlotIndex: 1 },
          ],
        },
      }
      const pushedPayloads = () =>
        (firebaseAdmin.messaging().sendEach as jest.Mock).mock.calls
          .flatMap(([messages]) => messages)
          .map((m) => m.data.smsData)

      it('keeps simSubscriptionId-only entries exactly as before', async () => {
        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [
            { message: 'Hello John', recipients: ['+123456789'], simSubscriptionId: 4 },
          ],
        } as SendBulkSMSInputDTO)

        expect(mockSmsModel.create).toHaveBeenCalledWith({
          user: mockDevice.user,
          device: mockDevice._id,
          smsBatch: mockSmsBatch._id,
          message: 'Hello John',
          type: SMSType.SENT,
          recipient: '+123456789',
          requestedAt: expect.any(Date),
          status: 'pending',
          simSubscriptionId: 4,
          metadata: {},
        })
        expect(pushedPayloads()).toEqual([
          '{"smsId":"sms123","smsBatchId":"batch123","message":"Hello John","recipients":["+123456789"],"simSubscriptionId":4,"smsBody":"Hello John","receivers":["+123456789"]}',
        ])
      })

      it('maps each entry on its own', async () => {
        mockDeviceModel.findById.mockResolvedValue(oldAppDevice)

        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [
            { message: 'a', recipients: ['+15555550100'], simSlotIndex: 1, simSubscriptionId: 3 },
            { message: 'b', recipients: ['+15555550101'], simSubscriptionId: 3 },
            { message: 'c', recipients: ['+15555550102'] },
          ],
        } as SendBulkSMSInputDTO)

        const docs = mockSmsModel.create.mock.calls.map(([doc]) => doc)
        expect(docs[0].simSlotIndex).toBe(1)
        expect(docs[0]).not.toHaveProperty('simSubscriptionId')
        expect(docs[0].metadata.simMappedSubscriptionId).toBe(7)
        expect(docs[1].simSubscriptionId).toBe(3)
        expect(docs[1]).not.toHaveProperty('simSlotIndex')
        expect(docs[1].metadata).not.toHaveProperty('simMappedSubscriptionId')
        expect(docs[2]).not.toHaveProperty('simSlotIndex')
        expect(docs[2]).not.toHaveProperty('simSubscriptionId')

        const payloads = pushedPayloads().map((p) => JSON.parse(p))
        expect(payloads[0]).toMatchObject({ simSlotIndex: 1, simSubscriptionId: 7 })
        expect(payloads[1]).toMatchObject({ simSubscriptionId: 3 })
        expect(payloads[1]).not.toHaveProperty('simSlotIndex')
        expect(payloads[2]).not.toHaveProperty('simSlotIndex')
        expect(payloads[2]).not.toHaveProperty('simSubscriptionId')
      })

      it('checks only the entries it sends', async () => {
        mockDeviceModel.findById.mockResolvedValue(oldAppDevice)

        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [
            { message: 'a', recipients: ['+15555550100'], simSlotIndex: 1 },
            { message: '', recipients: ['+15555550101'], simSlotIndex: 9 },
            { message: 'c', recipients: [], simSlotIndex: 'SIM 2' },
          ],
        } as unknown as SendBulkSMSInputDTO)

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
        expect(mockSmsModel.create.mock.calls[0][0].simSlotIndex).toBe(1)
      })

      it('checks every sent entry before billing, even after a skipped one', async () => {
        mockDeviceModel.findById.mockResolvedValue(oldAppDevice)

        await expect(
          service.sendBulkSMS(mockDeviceId, {
            messageTemplate: 'x',
            messages: [
              { message: '', recipients: ['+15555550100'], simSlotIndex: 9 },
              { message: 'b', recipients: ['+15555550101'], simSlotIndex: 9 },
            ],
          } as unknown as SendBulkSMSInputDTO),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: {
            error: 'messages[1].simSlotIndex must be a whole number from 0 to 7. 0 is SIM 1, 1 is SIM 2.',
          },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
      })

      it.each([
        [
          'an invalid slot',
          { simSlotIndex: 'SIM 2' },
          'messages[1].simSlotIndex must be a whole number from 0 to 7. 0 is SIM 1, 1 is SIM 2.',
        ],
        [
          'a slot the old app cannot send from',
          { simSlotIndex: 5 },
          "messages[1]: The phone's last report shows no SIM 6 (simSlotIndex 5). Open the textbee app to refresh, or update the app.",
        ],
        [
          'an invalid simSubscriptionId',
          { simSubscriptionId: 1.5 },
          'messages[1].simSubscriptionId must be a whole number from 0 to 2147483646, as a number or a string. A whole number from -2147483648 to -1, 2147483647, null or an empty string means no SIM is chosen. To choose a SIM, send simSlotIndex.',
        ],
      ])('refuses the whole batch for one entry with %s', async (_name, sim, error) => {
        mockDeviceModel.findById.mockResolvedValue(oldAppDevice)

        await expect(
          service.sendBulkSMS(mockDeviceId, {
            messageTemplate: 'x',
            messages: [
              { message: 'a', recipients: ['+15555550100'], simSlotIndex: 0 },
              { message: 'b', recipients: ['+15555550101'], ...sim },
            ],
          } as unknown as SendBulkSMSInputDTO),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: { success: false, error },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
        expect(mockSmsModel.create).not.toHaveBeenCalled()
        expect(firebaseAdmin.messaging().sendEach).not.toHaveBeenCalled()
      })

      it('refuses the whole batch for one entry with an invalid simSubscriptionId', async () => {
        await expect(
          service.sendBulkSMS(mockDeviceId, {
            messageTemplate: 'x',
            messages: [
              { message: 'a', recipients: ['+15555550100'], simSubscriptionId: 3 },
              { message: 'b', recipients: ['+15555550101'], simSubscriptionId: 1.5 },
            ],
          } as unknown as SendBulkSMSInputDTO),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: {
            success: false,
            error: expect.stringContaining('simSubscriptionId must be a whole number'),
          },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
      })

      it('does not check simSubscriptionId on an entry it skips', async () => {
        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [
            { message: 'a', recipients: ['+15555550100'] },
            { message: '', recipients: ['+15555550101'], simSubscriptionId: 1.5 },
          ],
        } as unknown as SendBulkSMSInputDTO)

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
      })
    })

    describe('message size', () => {
      it('refuses the whole batch for an entry whose message is not text, naming it', async () => {
        await expect(
          service.sendBulkSMS(mockDeviceId, {
            messageTemplate: 'x',
            messages: [
              { message: 'a', recipients: ['+15555550100'] },
              { message: { text: 'b' }, recipients: ['+15555550101'] },
            ],
          } as any),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: { success: false, error: 'messages[1].message must be text.' },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
      })

      it('still sends an entry whose message is a number', async () => {
        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [{ message: 7, recipients: ['+15555550100'] }],
        } as any)

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
      })
      it('refuses the whole batch and names the entry that is too long', async () => {
        await expect(
          service.sendBulkSMS(mockDeviceId, {
            messageTemplate: 'x',
            messages: [
              { message: 'a', recipients: ['+15555550100'] },
              { message: 'a'.repeat(9001), recipients: ['+15555550101'] },
            ],
          } as SendBulkSMSInputDTO),
        ).rejects.toMatchObject({
          status: HttpStatus.BAD_REQUEST,
          response: {
            success: false,
            error: expect.stringContaining('messages[1].message is 9001 bytes long.'),
          },
        })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsBatchModel.create).not.toHaveBeenCalled()
        expect(mockSmsModel.create).not.toHaveBeenCalled()
      })

      it('does not check an entry it skips', async () => {
        await service.sendBulkSMS(mockDeviceId, {
          messageTemplate: 'x',
          messages: [
            { message: 'a', recipients: ['+15555550100'] },
            { message: 'a'.repeat(9001), recipients: [] },
          ],
        } as SendBulkSMSInputDTO)

        expect(mockSmsModel.create).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('device dispatch pacing', () => {
    const deviceId = 'device123'
    const device = {
      _id: deviceId,
      enabled: true,
      fcmToken: 'fcm-token',
      user: 'user123',
      smsSendDelaySeconds: 5,
    }
    const recipients = (count: number) =>
      Array.from({ length: count }, (_, i) => `+1555555${String(i).padStart(4, '0')}`)
    const busyFor = (ms: number) => ({ dispatchBusyUntil: new Date(Date.now() + ms) })
    const pacingDelays = () =>
      mockSmsQueueService.planSendSmsJob.mock.calls.map((call) => call[3])
    const send = (count: number, extra: Partial<SendSMSInputDTO> = {}) =>
      service.sendSMS(deviceId, {
        message: 'Hi',
        recipients: recipients(count),
        ...extra,
      } as SendSMSInputDTO)

    beforeEach(() => {
      let created = 0
      mockDeviceModel.findById.mockResolvedValue(device)
      mockSmsBatchModel.create.mockResolvedValue({ _id: 'batch123' })
      mockSmsBatchModel.findByIdAndUpdate.mockResolvedValue(true)
      mockSmsModel.create.mockImplementation(async () => ({ _id: `sms-${created++}` }))
      mockSmsModel.bulkWrite.mockResolvedValue({})
      mockBillingService.canPerformAction.mockResolvedValue({ overLimit: false })
      mockSmsQueueService.isQueueEnabled.mockReturnValue(true)
      mockSmsQueueService.planSendSmsJob.mockImplementation(
        (count: number, delayMs?: number, sendDelaySeconds?: number, pacingDelayMs = 0) =>
          planDispatchWaves(count, {
            waveSize: 50,
            sendDelaySeconds,
            baseDelayMs: (delayMs ?? 0) + pacingDelayMs,
          }),
      )
      mockSmsQueueService.addSendSmsJob.mockResolvedValue([])
      mockSmsQueueService.removeJobs.mockImplementation(async (jobs) => jobs)
      mockDeviceModel.updateOne.mockResolvedValue({ modifiedCount: 1 })
    })

    afterEach(() => {
      delete process.env.DEVICE_DISPATCH_PACING_ENABLED
      for (const mock of [
        mockDeviceModel.findOneAndUpdate,
        mockDeviceModel.updateOne,
        mockSmsModel.create,
        mockSmsModel.bulkWrite,
        mockSmsQueueService.planSendSmsJob,
        mockSmsQueueService.addSendSmsJob,
        mockSmsQueueService.removeJobs,
      ]) {
        mock.mockReset()
      }
    })

    it('adds each request to the device backlog in one atomic update', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(null)

      await send(50)

      const [filter, update, options] = mockDeviceModel.findOneAndUpdate.mock.calls[0]
      expect(filter).toEqual({ _id: deviceId })
      expect(update).toEqual([
        {
          $set: {
            dispatchBusyUntil: {
              $add: [{ $max: ['$dispatchBusyUntil', expect.any(Date)] }, 250_000],
            },
          },
        },
      ])
      expect(options).toEqual({
        updatePipeline: true,
        returnDocument: 'before',
        timestamps: false,
        projection: { dispatchBusyUntil: 1, dispatchPriorityBusyUntil: 1 },
      })
    })

    it('holds a request once the device already has more than one wave planned', async () => {
      mockDeviceModel.findOneAndUpdate
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(busyFor(250_000))
        .mockResolvedValueOnce(busyFor(500_000))

      await send(50)
      const second = await send(50)
      const third = await send(50)

      const [first, secondDelay, thirdDelay] = pacingDelays()
      expect(first).toBe(0)
      expect(secondDelay).toBe(0)
      expect(thirdDelay).toBeGreaterThan(249_000)
      expect(thirdDelay).toBeLessThanOrEqual(250_000)
      expect(second).not.toHaveProperty('estimatedCompletionAt')
      // The estimate is the device's projected busy time after this request
      const eta = Date.parse(third.estimatedCompletionAt)
      expect(eta - Date.now()).toBeGreaterThan(749_000)
      expect(eta - Date.now()).toBeLessThanOrEqual(750_000)
      // A paced single wave is stamped so the stale-status task waits for it
      expect(mockSmsModel.bulkWrite).toHaveBeenCalledTimes(1)
    })

    it('releases each wave of a backlogged request after the pacing delay', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(busyFor(1_000_000))

      await send(120)

      const ops = mockSmsModel.bulkWrite.mock.calls[0][0]
      const due = ops.map((op) => op.updateMany.update.$set.dispatchDueAt.getTime())
      expect(due[1] - due[0]).toBe(250_000)
      expect(due[2] - due[0]).toBe(500_000)
      expect(due[0] - Date.now()).toBeGreaterThan(749_000)
      expect(due[0] - Date.now()).toBeLessThanOrEqual(750_000)
    })

    it('lets a single recipient skip the line within the priority budget', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce({
        ...busyFor(5_000_000),
        dispatchPriorityBusyUntil: new Date(Date.now() + 100_000),
      })

      const result = await send(1)

      expect(pacingDelays()).toEqual([0])
      expect(result).not.toHaveProperty('estimatedCompletionAt')
      const [, update] = mockDeviceModel.findOneAndUpdate.mock.calls[0]
      expect(update[0].$set).toHaveProperty('dispatchPriorityBusyUntil')
    })

    it('does not count or delay a scheduled send', async () => {
      await send(2, { scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })

      expect(mockDeviceModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(pacingDelays()).toEqual([0])
    })

    it('sends without pacing when the backlog update fails', async () => {
      mockDeviceModel.findOneAndUpdate.mockRejectedValueOnce(new Error('write failed'))
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)

      const result = await send(2)
      consoleError.mockRestore()

      expect(result).toHaveProperty('success', true)
      expect(pacingDelays()).toEqual([0])
      expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
      // Nothing was reserved, so the jobs must not carry the backlog mark
      expect(mockSmsQueueService.addSendSmsJob.mock.calls[0][6]).toBe(0)
    })

    it('marks the jobs with the time reserved per message', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(null)

      await send(2)

      expect(mockSmsQueueService.addSendSmsJob.mock.calls[0][6]).toBe(5_000)
    })

    it('keeps the time of a wave a worker already picked up', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(null)
      const running = { data: { inDeviceBacklog: true, fcmMessages: [{}] } }
      mockSmsQueueService.addSendSmsJob.mockRejectedValueOnce(
        new EnqueueFailedError(new Error('redis down'), [running as any]),
      )

      await expect(send(3)).rejects.toThrow(HttpException)

      const [, update] = mockDeviceModel.updateOne.mock.calls[0]
      expect(update[0].$set.dispatchBusyUntil.$max[1]).toEqual({
        $subtract: ['$dispatchBusyUntil', 10_000],
      })
    })

    it('leaves the device alone while pacing is switched off', async () => {
      process.env.DEVICE_DISPATCH_PACING_ENABLED = 'false'

      await send(2)

      expect(mockDeviceModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(pacingDelays()).toEqual([0])
    })

    it('gives back the reserved time when a send cannot be queued', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(busyFor(100_000))
      mockSmsQueueService.addSendSmsJob.mockRejectedValueOnce(new Error('redis down'))

      await expect(send(2)).rejects.toThrow(HttpException)

      const [filter, update, options] = mockDeviceModel.updateOne.mock.calls[0]
      expect(filter).toEqual({ _id: deviceId, dispatchBusyUntil: { $gt: expect.any(Date) } })
      expect(update).toEqual([
        {
          $set: {
            dispatchBusyUntil: {
              $max: [expect.any(Date), { $subtract: ['$dispatchBusyUntil', 10_000] }],
            },
          },
        },
      ])
      expect(options).toEqual({ updatePipeline: true, timestamps: false })
    })

    it('counts only the immediate group of a bulk send and paces it', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(busyFor(500_000))
      const scheduledAt = new Date(Date.now() + 600_000).toISOString()

      const result = await service.sendBulkSMS(deviceId, {
        messageTemplate: 'Hi',
        messages: [
          { message: 'Now', recipients: recipients(3) },
          { message: 'Later', recipients: ['+15555550199', '+15555550198'], scheduledAt },
        ],
      } as SendBulkSMSInputDTO)

      const [, update] = mockDeviceModel.findOneAndUpdate.mock.calls[0]
      expect(update[0].$set.dispatchBusyUntil.$add[1]).toBe(15_000)
      const byCount = new Map(
        mockSmsQueueService.planSendSmsJob.mock.calls.map((call) => [call[0], call]),
      )
      expect(byCount.get(2)[3]).toBe(0)
      expect(byCount.get(3)[3]).toBeGreaterThan(249_000)
      expect(byCount.get(3)[3]).toBeLessThanOrEqual(250_000)
      expect(result).toHaveProperty('estimatedCompletionAt')
    })

    it('gives back only the time of bulk messages that left the queue', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(null)
      const backlogJob = (id: string) => ({
        id,
        data: { inDeviceBacklog: true, fcmMessages: [{}, {}] },
      })
      const picked = backlogJob('picked')
      const removable = backlogJob('removable')
      mockSmsQueueService.addSendSmsJob
        .mockResolvedValueOnce([picked, removable])
        .mockRejectedValueOnce(new Error('redis down'))
      mockSmsQueueService.removeJobs.mockResolvedValueOnce([removable])
      const scheduledAt = new Date(Date.now() + 600_000).toISOString()

      await expect(
        service.sendBulkSMS(deviceId, {
          messageTemplate: 'Hi',
          messages: [
            { message: 'Now', recipients: recipients(4) },
            { message: 'Later', recipients: ['+15555550199'], scheduledAt },
          ],
        } as SendBulkSMSInputDTO),
      ).rejects.toThrow(HttpException)

      // 4 reserved, 2 still queued in the job a worker holds
      const [, update] = mockDeviceModel.updateOne.mock.calls[0]
      expect(update[0].$set.dispatchBusyUntil.$max[1]).toEqual({
        $subtract: ['$dispatchBusyUntil', 10_000],
      })
    })

    it('gives back the reserved time when a bulk send cannot be queued', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValueOnce(null)
      mockSmsQueueService.addSendSmsJob.mockRejectedValueOnce(new Error('redis down'))

      await expect(
        service.sendBulkSMS(deviceId, {
          messageTemplate: 'Hi',
          messages: [{ message: 'Now', recipients: recipients(4) }],
        } as SendBulkSMSInputDTO),
      ).rejects.toThrow(HttpException)

      const [, update] = mockDeviceModel.updateOne.mock.calls[0]
      expect(update[0].$set.dispatchBusyUntil.$max[1]).toEqual({
        $subtract: ['$dispatchBusyUntil', 20_000],
      })
    })
  })

  describe('receiveSMS', () => {
    const mockDeviceId = 'device123'
    const mockDevice = {
      _id: mockDeviceId,
      user: 'user123',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }
    const mockReceivedSmsData = {
      message: 'Hello from test',
      sender: '+123456789',
      receivedAt: new Date(),
    }
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000)
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
      mockBillingService.canPerformAction.mockResolvedValue({ overLimit: false })
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

    it('stores the app version that reported the message', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        ...mockDevice,
        appVersionInfo: { versionCode: 18, versionName: '2.8.0' },
      })

      await service.receiveSMS(
        mockDeviceId,
        mockReceivedSmsData,
        'textbee-android/2.8.0',
      )

      expect(mockSmsModel.create.mock.calls[0][0].metadata).toEqual({
        appVersionCode: 18,
        appVersionName: '2.8.0',
        client: 'textbee-android/2.8.0',
        appVersionAt: expect.any(Date),
      })
    })

    it('stores the SIM that received the message', async () => {
      await service.receiveSMS(mockDeviceId, {
        ...mockReceivedSmsData,
        simSubscriptionId: 19,
        simSlotIndex: 1,
      })

      expect(mockSmsModel.create.mock.calls[0][0].simUsed).toEqual({
        subscriptionId: 19,
        slotIndex: 1,
      })
    })

    it('stores every SIM detail the app reports', async () => {
      await service.receiveSMS(mockDeviceId, {
        ...mockReceivedSmsData,
        simUsed: {
          subscriptionId: 19,
          slotIndex: 1,
          carrierName: 'Smart',
          displayName: 'Work',
          countryIso: 'ph',
          mcc: '515',
          mnc: '03',
        },
      })

      expect(mockSmsModel.create.mock.calls[0][0].simUsed).toEqual({
        subscriptionId: 19,
        slotIndex: 1,
        carrierName: 'Smart',
        displayName: 'Work',
        countryIso: 'ph',
        mcc: '515',
        mnc: '03',
      })
    })

    it('stores no SIM when the app does not report one', async () => {
      await service.receiveSMS(mockDeviceId, mockReceivedSmsData)

      expect(mockSmsModel.create.mock.calls[0][0]).not.toHaveProperty('simUsed')
    })

    it('should throw error if device does not exist', async () => {
      mockDeviceModel.findById.mockResolvedValue(null)

      await expect(
        service.receiveSMS(mockDeviceId, mockReceivedSmsData),
      ).rejects.toThrow(HttpException)
    })

    it('should throw error if SMS data is malformed', async () => {
      await expect(
        service.receiveSMS(mockDeviceId, {
          ...mockReceivedSmsData,
          message: undefined,
        }),
      ).rejects.toThrow(HttpException)
      expect(mockSmsModel.create).not.toHaveBeenCalled()
    })

    it.each([
      ['an empty message', { message: '' }, 'empty_message'],
      ['no sender', { sender: undefined }, 'missing_sender'],
    ])(
      'acknowledges %s without storing it',
      async (_label, overrides, reason) => {
        const result = await service.receiveSMS(mockDeviceId, {
          ...mockReceivedSmsData,
          ...overrides,
        })

        expect(result).toEqual({ ignored: true, reason })
        expect(mockBillingService.canPerformAction).not.toHaveBeenCalled()
        expect(mockSmsModel.create).not.toHaveBeenCalled()
        expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
      },
    )

    it('stores receivedAt sent as a JSON string', async () => {
      await service.receiveSMS(mockDeviceId, {
        message: 'Hello from test',
        sender: '+15555550123',
        receivedAt: '2026-09-13T10:30:00.000Z' as unknown as Date,
      })

      expect(mockSmsModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          receivedAt: new Date('2026-09-13T10:30:00.000Z'),
        }),
      )
    })

    it('stores a message whose timestamp is 0 with the server time', async () => {
      const before = Date.now()

      await service.receiveSMS(mockDeviceId, {
        message: 'Hello from test',
        sender: '+15555550123',
        receivedAtInMillis: 0,
      })

      const [{ receivedAt }] = mockSmsModel.create.mock.calls[0]
      expect(receivedAt).toBeInstanceOf(Date)
      expect(receivedAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('keeps the received time as createdAt for a late upload', async () => {
      const receivedAt = daysAgo(3)

      await service.receiveSMS(mockDeviceId, { ...mockReceivedSmsData, receivedAt })

      const [created] = mockSmsModel.create.mock.calls[0]
      expect(created.createdAt).toEqual(receivedAt)
      expect(created.originalCreatedAt).toBeInstanceOf(Date)
      expect(created.originalCreatedAt.getTime()).toBeGreaterThan(receivedAt.getTime())
    })

    it('leaves createdAt to the database for a recent message', async () => {
      await service.receiveSMS(mockDeviceId, mockReceivedSmsData)

      const [created] = mockSmsModel.create.mock.calls[0]
      expect(created).not.toHaveProperty('createdAt')
      expect(created).not.toHaveProperty('originalCreatedAt')
      expect(created).not.toHaveProperty('overLimit')
    })

    it('marks a message stored over the plan limit', async () => {
      mockBillingService.canPerformAction.mockResolvedValue({ overLimit: true })

      await service.receiveSMS(mockDeviceId, mockReceivedSmsData)

      expect(mockSmsModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ overLimit: true }),
      )
      expect(mockWebhookService.deliverNotification).toHaveBeenCalled()
    })

    describe('RECEIVED_WEBHOOK_MAX_AGE_HOURS', () => {
      const original = process.env.RECEIVED_WEBHOOK_MAX_AGE_HOURS

      afterEach(() => {
        if (original === undefined) delete process.env.RECEIVED_WEBHOOK_MAX_AGE_HOURS
        else process.env.RECEIVED_WEBHOOK_MAX_AGE_HOURS = original
      })

      it('stores but does not send webhooks for a message received 3 days ago', async () => {
        delete process.env.RECEIVED_WEBHOOK_MAX_AGE_HOURS

        await service.receiveSMS(mockDeviceId, {
          ...mockReceivedSmsData,
          receivedAt: daysAgo(3),
        })

        expect(mockSmsModel.create).toHaveBeenCalled()
        expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
      })

      it('sends webhooks for any age when set to 0', async () => {
        process.env.RECEIVED_WEBHOOK_MAX_AGE_HOURS = '0'

        await service.receiveSMS(mockDeviceId, {
          ...mockReceivedSmsData,
          receivedAt: daysAgo(3),
        })

        expect(mockWebhookService.deliverNotification).toHaveBeenCalled()
      })
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

    it('returns catalog error text on the device history', async () => {
      mockSmsModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: 'sms3',
              type: SMSType.SENT,
              status: 'failed',
              errorCode: '1',
              errorMessage:
                'SMS failed on device. Check SIM balance and signal, then try again. (code 21)',
              failedAt: new Date('2026-11-01T10:00:00Z'),
            },
          ]),
        }),
      })

      const result = await service.getMessages(mockDeviceId, '', 1, 10)

      expect(result.data[0].errorName).toBe('GENERIC_FAILURE')
      expect(result.data[0].errorMessage).toMatch(
        /^The phone could not send the SMS.*\(code 21\)$/,
      )
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

      it('returns catalog error text for a stored document', async () => {
        const stored = {
          _id: OTHER_SMS,
          status: 'failed',
          errorCode: '8',
          errorMessage:
            'Short codes are not supported on this carrier. Use a full phone number.',
          failedAt: new Date('2026-11-01T10:00:00Z'),
        }
        mockSmsModel.findOne.mockResolvedValue({
          ...stored,
          toObject: () => ({ ...stored }),
        })

        const sms = await service.getSMSById(OWN_DEVICE, OTHER_SMS)

        expect(sms).not.toHaveProperty('toObject')
        expect(sms.errorName).toBe('SHORT_CODE_NEVER_ALLOWED')
        expect(sms.errorMessage).toContain('Never allow')
        expect(sms.deviceMessage).toBe(stored.errorMessage)
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

      it('returns catalog error text for every batch message', async () => {
        mockSmsBatchModel.findOne.mockResolvedValue({
          _id: OTHER_SMS,
          device: OWN_DEVICE,
        })
        mockSmsModel.find.mockResolvedValue([
          { _id: 'a', status: 'sent' },
          {
            _id: 'b',
            status: 'failed',
            errorCode: 'PERMISSION_DENIED',
            errorMessage: 'SMS permission not granted',
            failedAt: new Date('2026-11-01T10:00:00Z'),
          },
        ])

        const { messages } = await service.getSmsBatchById(
          OWN_DEVICE,
          OTHER_SMS,
        )

        expect(messages[0]).toEqual({ _id: 'a', status: 'sent' })
        expect(messages[1].errorName).toBe('PERMISSION_DENIED')
        expect(messages[1].errorMessage).toContain('allow the missing permission')
        expect(messages[1].deviceMessage).toBe('SMS permission not granted')
      })

      it('returns only defined fields on the batch', async () => {
        mockSmsBatchModel.findOne.mockResolvedValue({
          _id: OTHER_SMS,
          device: OWN_DEVICE,
          status: 'completed',
          internalNote: { value: 1 },
        })
        mockSmsModel.find.mockResolvedValue([])

        const { batch } = await service.getSmsBatchById(OWN_DEVICE, OTHER_SMS)

        expect(batch).toEqual({
          _id: OTHER_SMS,
          device: OWN_DEVICE,
          status: 'completed',
        })
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
      const OWN_SMS = '507f1f77bcf86cd799439044'

      // The service reads with +metadata and lean, so the mock is a chain
      const mockStoredSms = (...docs: any[]) => {
        for (const doc of docs) {
          mockSmsModel.findById.mockReturnValueOnce({
            select: () => ({ lean: () => Promise.resolve(doc) }),
          })
        }
      }

      it('refreshes the message\'s own batch, not the one in the body', async () => {
        const OWN_BATCH = new Types.ObjectId()
        mockDeviceModel.findById.mockResolvedValue({
          _id: OWN_DEVICE,
          user: 'user_1',
        })
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          smsBatch: OWN_BATCH,
          status: 'pending',
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({
          _id: 'own_sms',
          status: 'sent',
        })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          smsBatchId: OTHER_BATCH,
          status: 'sent',
        } as any)

        expect(mockBatchStatus.refresh).toHaveBeenCalledWith([OWN_BATCH])
        expect(mockSmsModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
          mockBatchStatus.refresh.mock.invocationCallOrder[0],
        )
        expect(mockSmsBatchModel.findByIdAndUpdate).not.toHaveBeenCalled()
      })

      it('records the app version behind the status report', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          _id: OWN_DEVICE,
          user: 'user_1',
          appVersionCode: 17,
          appVersionName: '2.7.0',
        })
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'pending',
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({
          _id: 'own_sms',
          status: 'sent',
        })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$set['metadata.appVersionCode']).toBe(17)
        expect(update.$set['metadata.appVersionName']).toBe('2.7.0')
        expect(update.$set['metadata.appVersionAt']).toBeInstanceOf(Date)
        expect(update.$set['metadata.client']).toBeUndefined()
      })

      const reportingDevice = () => {
        mockDeviceModel.findById.mockResolvedValue({
          _id: OWN_DEVICE,
          user: 'user_1',
        })
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'dispatched',
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({
          _id: 'own_sms',
          status: 'sent',
        })
      }

      it('stores the phone-side timestamps and the report attempt', async () => {
        reportingDevice()
        const pushReceived = Date.now() - 4000
        const sendAttempted = Date.now() - 1500

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          sentAtInMillis: Date.now(),
          pushReceivedAtInMillis: pushReceived,
          sendAttemptedAtInMillis: sendAttempted,
          reportAttempt: 3,
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$set.pushReceivedAt).toEqual(new Date(pushReceived))
        expect(update.$set.sendAttemptedAt).toEqual(new Date(sendAttempted))
        expect(update.$set['metadata.statusReportAttempt']).toBe(3)
      })

      it('ignores a phone timestamp that cannot be real', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          pushReceivedAtInMillis: 0,
          sendAttemptedAtInMillis: Date.now() + 90 * 60 * 60 * 1000,
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$set.pushReceivedAt).toBeUndefined()
        expect(update.$set.sendAttemptedAt).toBeUndefined()
      })

      it('appends a device failure to the error history', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'failed',
          errorCode: 'NO_SERVICE',
          errorMessage: 'no carrier',
        } as any)

        const [, update, options] = mockSmsModel.findOneAndUpdate.mock.calls[0]
        const { set, history } = readPipelineUpdate(update)
        expect(options.updatePipeline).toBe(true)
        expect(set.errorCode).toBe('NO_SERVICE')
        expect(history[0]).toEqual(
          expect.objectContaining({ code: 'NO_SERVICE', source: 'device' }),
        )
      })

      it('stores the SIM the phone used apart from the requested one', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          simSubscriptionId: 17,
          simSlotIndex: 0,
          simSelection: 'requested_invalid_fallback',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$set['simUsed.subscriptionId']).toBe(17)
        expect(update.$set['simUsed.slotIndex']).toBe(0)
        expect(update.$set['metadata.simSelection']).toBe(
          'requested_invalid_fallback',
        )
        expect(update.$set.simSubscriptionId).toBeUndefined()
      })

      it('stores every SIM detail of a nested report', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          simUsed: {
            subscriptionId: 17,
            slotIndex: 0,
            carrierName: 'Globe',
            countryIso: 'ph',
            mcc: '515',
            mnc: '02',
          },
          simSelection: 'system_default',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        // Replaced whole, so no field of an earlier SIM survives
        expect(update.$set.simUsed).toEqual({
          subscriptionId: 17,
          slotIndex: 0,
          carrierName: 'Globe',
          countryIso: 'ph',
          mcc: '515',
          mnc: '02',
        })
        expect(Object.keys(update.$set).filter((k) => k.startsWith('simUsed.'))).toEqual([])
        expect(update.$unset).toBeUndefined()
        expect(update.$set['metadata.simSelection']).toBe('system_default')
      })

      it('clears the stored SIM when a nested report says it is unknown', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          simUsed: {},
          simSelection: 'system_default',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$unset).toEqual({ simUsed: '' })
        expect(update.$set).not.toHaveProperty('simUsed')
        expect(update.$set['metadata.simSelection']).toBe('system_default')
      })

      it('keeps the stored SIM when a report has none', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'failed',
          errorCode: 'PERMISSION_DENIED',
          simSelection: 'requested',
        } as any)

        const { set, unset } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
        expect(unset).toEqual([])
        expect(Object.keys(set).filter((k) => k.startsWith('simUsed'))).toEqual([])
      })

      it('updates only the SIM part the report carries', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'delivered',
          simSlotIndex: 1,
          simSelection: 'app_preferred',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        expect(update.$set['simUsed.slotIndex']).toBe(1)
        expect(update.$set).not.toHaveProperty('simUsed.subscriptionId')
        expect(update.$set['metadata.simSelection']).toBe('app_preferred')
      })

      const ownDevice = () =>
        mockDeviceModel.findById.mockResolvedValue({ _id: OWN_DEVICE, user: 'user_1' })

      it('reports a malformed or non-string sms id as not found without a query', async () => {
        ownDevice()

        for (const smsId of ['not-an-id', { $ne: null }]) {
          await expect(
            service.updateSMSStatus(OWN_DEVICE, { smsId, status: 'sent' } as any),
          ).rejects.toThrow(HttpException)
        }
        expect(mockSmsModel.findById).not.toHaveBeenCalled()
      })

      it('rejects a status the phone never sends', async () => {
        ownDevice()

        await expect(
          service.updateSMSStatus(OWN_DEVICE, { smsId: OWN_SMS, status: 'pending' } as any),
        ).rejects.toThrow(HttpException)
        expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
      })

      it('clears the timeout note on a late delivery and sends one webhook', async () => {
        ownDevice()
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'unknown',
          errorMessage: 'Status update timeout - no response from device after dispatch',
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({ _id: 'own_sms', status: 'delivered' })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'delivered',
          deliveredAtInMillis: Date.now(),
        } as any)

        const [filter, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
        expect(filter).toEqual({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'unknown',
          sentAt: null,
          deliveredAt: null,
          failedAt: null,
        })
        expect(update.$set.status).toBe('delivered')
        expect(update.$unset).toEqual({ errorMessage: '' })
        expect(update.$push).toBeUndefined()
        expect(mockWebhookService.deliverNotification).toHaveBeenCalledTimes(1)
        expect(mockWebhookService.deliverNotification.mock.calls[0][0].event).toBe(
          WebhookEvent.MESSAGE_DELIVERED,
        )
      })

      it('keeps delivered when a late sent report arrives, without a webhook', async () => {
        ownDevice()
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'delivered',
          sentAt: new Date(Date.now() - 60000),
          deliveredAt: new Date(),
        })

        const result = await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          sentAtInMillis: Date.now() - 60000,
        } as any)

        expect(result.success).toBe(true)
        expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
        expect(mockBatchStatus.refresh).not.toHaveBeenCalled()
        expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
      })

      it('only records a failure older than the delivery', async () => {
        ownDevice()
        const deliveredAt = Date.now() - 1000
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'delivered',
          deliveredAt: new Date(deliveredAt),
        })
        mockSmsModel.updateOne.mockResolvedValue({ matchedCount: 1 })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'failed',
          errorCode: '1',
          failedAtInMillis: deliveredAt - 5000,
        } as any)

        expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
        const [filter, update, options] = mockSmsModel.updateOne.mock.calls[0]
        // A retry racing the first copy finds it already stored
        expect(filter.issueHistory).toEqual({
          $not: { $elemMatch: { source: 'device', code: '1', at: new Date(deliveredAt - 5000) } },
        })
        expect(readPipelineUpdate(update).history[0]).toEqual(
          expect.objectContaining({ code: '1', source: 'device' }),
        )
        expect(options).toEqual({ timestamps: false, updatePipeline: true })
        expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
      })

      it('bumps updatedAt when a newer failure replaces the current one', async () => {
        ownDevice()
        const firstFailure = Date.now() - 60000
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'failed',
          failedAt: new Date(firstFailure),
          errorCode: '1',
          issueHistory: [{ code: '1', at: new Date(firstFailure), source: 'device' }],
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({ _id: 'own_sms', status: 'failed' })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'failed',
          errorCode: 'PERMISSION_DENIED',
          failedAtInMillis: Date.now(),
        } as any)

        const [, update, options] = mockSmsModel.findOneAndUpdate.mock.calls[0]
        expect(readPipelineUpdate(update).set.errorCode).toBe('PERMISSION_DENIED')
        expect(options.timestamps).toBe(true)
        expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
      })

      it('leaves updatedAt alone when it only fills a time', async () => {
        ownDevice()
        mockStoredSms({
          _id: 'own_sms',
          device: OWN_DEVICE,
          status: 'delivered',
          deliveredAt: new Date(),
        })
        mockSmsModel.findOneAndUpdate.mockResolvedValue({ _id: 'own_sms', status: 'delivered' })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          sentAtInMillis: Date.now() - 1000,
        } as any)

        expect(mockSmsModel.findOneAndUpdate.mock.calls[0][2].timestamps).toBe(false)
      })

      it('judges the report again when another writer got there first', async () => {
        ownDevice()
        mockStoredSms(
          { _id: 'own_sms', device: OWN_DEVICE, status: 'dispatched' },
          { _id: 'own_sms', device: OWN_DEVICE, status: 'delivered', deliveredAt: new Date() },
        )
        mockSmsModel.findOneAndUpdate
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ _id: 'own_sms', status: 'delivered' })

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'sent',
          sentAtInMillis: Date.now() - 1000,
        } as any)

        // The second look sees delivered, so the late sent only fills its time
        expect(mockSmsModel.findById).toHaveBeenCalledTimes(2)
        expect(mockSmsModel.findOneAndUpdate).toHaveBeenCalledTimes(2)
        const [filter, update] = mockSmsModel.findOneAndUpdate.mock.calls[1]
        expect(filter.status).toBe('delivered')
        expect(update.$set.status).toBeUndefined()
        expect(update.$set.sentAt).toBeInstanceOf(Date)
      })

      it('leaves the used SIM alone when the report carries none', async () => {
        reportingDevice()

        await service.updateSMSStatus(OWN_DEVICE, {
          smsId: OWN_SMS,
          status: 'delivered',
          simSelection: 'made_up',
        } as any)

        const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
        const keys = Object.keys(update.$set)
        expect(keys.filter((k) => k.startsWith('simUsed'))).toEqual([])
        expect(update.$set['metadata.simSelection']).toBeUndefined()
      })

      describe('part reports', () => {
        const env = { ...process.env }
        // TP-Status 0x00, with five bytes of user data after it
        const HEAD =
          '07911326040000F0060D0B915155550501F0621121010300006211210103518000'
        const PDU = HEAD + '0405C8329BFD06'
        // SMSC, first octet, TP-MR and TP-RA are not stored
        const SMSC_AND_ADDRESSES = 36
        const SMS_OID = new Types.ObjectId()
        const DEVICE_OID = new Types.ObjectId(OWN_DEVICE)
        const USER_OID = new Types.ObjectId()

        beforeEach(() => {
          delete process.env.PART_REPORTS_STORE_ENABLED
          delete process.env.CARRIER_VERDICT_ENABLED
          delete process.env.MULTIPART_FAILURE_FINAL_ENABLED
          delete process.env.PART_REPORTS_ENABLED
          mockSmsPartReportModel.create.mockResolvedValue({})
        })

        afterEach(() => {
          process.env = { ...env }
        })

        const device = (configOverrides?: Record<string, unknown>) =>
          mockDeviceModel.findById.mockResolvedValue({
            _id: OWN_DEVICE,
            user: USER_OID,
            ...(configOverrides && { configOverrides }),
          })
        const stored = (fields: Record<string, unknown> = {}) =>
          mockStoredSms({
            _id: SMS_OID,
            device: DEVICE_OID,
            status: 'dispatched',
            ...fields,
          })
        const updatedTo = (status: string) =>
          mockSmsModel.findOneAndUpdate.mockResolvedValue({ _id: SMS_OID, status })
        const delivered = (deliveryReport: Record<string, unknown>, extra = {}) =>
          service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'delivered',
            deliveredAtInMillis: Date.now() - 1000,
            partIndex: 0,
            partCount: 1,
            resultCode: -1,
            perPartUpload: true,
            deliveryReport,
            ...extra,
          } as any)
        const webhookEvent = () =>
          mockWebhookService.deliverNotification.mock.calls[0][0].event

        it('stores a report with partCount once, apart from the message', async () => {
          device()
          stored()
          updatedTo('delivered')
          const at = Date.now() - 1000

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'delivered',
            deliveredAtInMillis: at,
            partIndex: 1,
            partCount: 3,
            resultCode: -1,
            deliveryReport: { format: '3gpp', status: 0, pdu: PDU },
          } as any)

          expect(mockSmsPartReportModel.create).toHaveBeenCalledTimes(1)
          expect(mockSmsPartReportModel.create).toHaveBeenCalledWith({
            sms: SMS_OID,
            device: DEVICE_OID,
            user: USER_OID,
            key: '1_delivered_0',
            partIndex: 1,
            partCount: 3,
            status: 'delivered',
            at: new Date(at),
            resultCode: -1,
            radioErrorCode: undefined,
            deliveryReport: {
              format: '3gpp',
              status: 0,
              pdu: Buffer.from(HEAD.slice(SMSC_AND_ADDRESSES), 'hex'),
              dischargeAt: new Date(Date.UTC(2026, 10, 12, 8, 30, 15)),
            },
            receivedAt: expect.any(Date),
          })
        })

        it('ignores a repeat the store already holds and still applies the report', async () => {
          device()
          stored()
          updatedTo('sent')
          mockSmsPartReportModel.create.mockRejectedValue(
            Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
          )
          const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

          const result = await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 0,
            partCount: 2,
          } as any)

          expect(result.success).toBe(true)
          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('sent')
          expect(error).not.toHaveBeenCalled()
          error.mockRestore()
        })

        it('never fails the status request when the store fails', async () => {
          device()
          stored()
          updatedTo('sent')
          mockSmsPartReportModel.create.mockRejectedValue(new Error('connection lost'))
          const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)

          const result = await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 0,
            partCount: 2,
          } as any)

          expect(result.success).toBe(true)
          expect(mockSmsModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
          expect(error).toHaveBeenCalled()
          error.mockRestore()
        })

        it('stores a repeat that changes nothing on the message, without touching it', async () => {
          device()
          stored({ status: 'delivered', deliveredAt: new Date() })

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 1,
            partCount: 2,
          } as any)

          expect(mockSmsPartReportModel.create).toHaveBeenCalledTimes(1)
          expect(mockSmsPartReportModel.create.mock.calls[0][0].key).toBe('1_sent_none')
          expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
          expect(mockSmsModel.updateOne).not.toHaveBeenCalled()
        })

        it('stores nothing for a report without partCount and applies it as before', async () => {
          device()
          stored()
          updatedTo('sent')

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 0,
            resultCode: -1,
          } as any)

          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('sent')
        })

        it('stores nothing without a valid partIndex but still applies the part rule', async () => {
          device()
          updatedTo('failed')

          for (const partIndex of [undefined, 3, 'one']) {
            mockSmsModel.findOneAndUpdate.mockClear()
            stored({
              status: 'delivered',
              sentAt: new Date(Date.now() - 6000),
              deliveredAt: new Date(Date.now() - 2000),
            })

            await service.updateSMSStatus(OWN_DEVICE, {
              smsId: OWN_SMS,
              status: 'failed',
              errorCode: '1',
              failedAtInMillis: Date.now() - 5000,
              partIndex,
              partCount: 3,
            } as any)

            const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
            expect(readPipelineUpdate(update).set.status).toBe('failed')
          }

          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
        })

        it('stores nothing for a received message', async () => {
          device()
          stored({ type: SMSType.RECEIVED, status: 'received' })

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 0,
            partCount: 1,
          } as any)

          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
          expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
        })

        it('stores nothing when the request ends 404 or 403', async () => {
          const body = { smsId: OWN_SMS, status: 'sent', partIndex: 0, partCount: 1 } as any

          device()
          mockStoredSms(null)
          await expect(service.updateSMSStatus(OWN_DEVICE, body)).rejects.toMatchObject({
            status: HttpStatus.NOT_FOUND,
          })

          device()
          mockStoredSms({ _id: SMS_OID, device: new Types.ObjectId(), status: 'dispatched' })
          await expect(service.updateSMSStatus(OWN_DEVICE, body)).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN,
          })

          mockDeviceModel.findById.mockResolvedValue(null)
          await expect(service.updateSMSStatus(OWN_DEVICE, body)).rejects.toMatchObject({
            status: HttpStatus.NOT_FOUND,
          })

          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
        })

        it('keeps a carrier failure in the trail when every write loses its race', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored()
          stored()
          stored()
          mockSmsModel.findOneAndUpdate.mockResolvedValue(null)
          mockSmsModel.updateOne.mockResolvedValue({ matchedCount: 1 })
          const at = Date.now() - 1000

          await delivered({ format: '3gpp', status: 0x41 }, { deliveredAtInMillis: at })

          expect(mockSmsModel.findOneAndUpdate).toHaveBeenCalledTimes(3)
          const [filter, update, options] = mockSmsModel.updateOne.mock.calls[0]
          expect(filter._id).toBe(SMS_OID)
          expect(filter.issueHistory).toEqual({
            $not: {
              $elemMatch: { source: 'device', code: 'CARRIER_0x41', at: new Date(at) },
            },
          })
          const entry = readPipelineUpdate(update).history[0]
          expect(entry).toEqual(
            expect.objectContaining({
              code: 'CARRIER_0x41',
              message: findSmsError('device', 'CARRIER_0x41').message,
              source: 'device',
            }),
          )
          expect(entry.deliveryReport).toBeUndefined()
          expect(options).toEqual({ timestamps: false, updatePipeline: true })
          expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
        })

        it('stores nothing when the store switch is off', async () => {
          process.env.PART_REPORTS_STORE_ENABLED = 'false'
          device()
          stored()
          updatedTo('sent')

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'sent',
            partIndex: 0,
            partCount: 2,
          } as any)

          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
          expect(mockSmsModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
        })

        it('drops new fields of the wrong type and still applies the report', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored()
          updatedTo('delivered')

          const result = await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'delivered',
            partIndex: 'one',
            partCount: '3',
            perPartUpload: 'yes',
            resultCode: 'ok',
            radioErrorCode: {},
            deliveryReport: { format: 3, status: '0x41', pdu: 'not hex' },
          } as any)

          expect(result.success).toBe(true)
          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_DELIVERED)
        })

        it('writes no part field to the message, so no message reply shows one', async () => {
          device()
          stored()
          updatedTo('delivered')

          await delivered({ format: '3gpp', status: 0, pdu: PDU }, { radioErrorCode: 7 })

          const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
          const written = JSON.stringify(update)
          for (const field of [
            'partIndex',
            'partCount',
            'resultCode',
            'radioErrorCode',
            'deliveryReport',
            'pdu',
            'dischargeAt',
          ]) {
            expect(written).not.toContain(field)
          }
        })

        it('keeps today\'s delivered rule while the carrier verdict is off', async () => {
          device()
          stored()
          updatedTo('delivered')

          await delivered({ format: '3gpp', status: 0x41 })

          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_DELIVERED)
        })

        it('fails the message with the catalog text when the carrier gave up', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored({ status: 'sent', sentAt: new Date(Date.now() - 5000) })
          updatedTo('failed')
          const at = Date.now() - 1000

          await delivered({ format: '3gpp', status: 0x41 }, { deliveredAtInMillis: at })

          const [, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
          const { set, history } = readPipelineUpdate(update)
          expect(set.status).toBe('failed')
          expect(set.errorCode).toBe('CARRIER_0x41')
          expect(set.errorMessage).toBe(findSmsError('device', 'CARRIER_0x41').message)
          expect(set.failedAt).toEqual(new Date(at))
          expect(set.deliveredAt).toBeUndefined()
          expect(history[0]).toEqual(
            expect.objectContaining({ code: 'CARRIER_0x41', source: 'device' }),
          )
          expect(history[0].deliveryReport).toBeUndefined()
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_FAILED)
        })

        it('reads a 3GPP2 failure from the error class', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored()
          updatedTo('failed')

          await delivered({ format: '3gpp2', status: (3 << 24) | (0x05 << 16) })

          const { set } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
          expect(set.errorCode).toBe('CARRIER_3GPP2_0x05')
          expect(set.errorMessage).toBe(findSmsError('device', 'CARRIER_3GPP2_0x05').message)
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_FAILED)
        })

        it('lets a device override turn the verdict on', async () => {
          device({ carrierVerdictEnabled: true })
          stored()
          updatedTo('failed')

          await delivered({ format: '3gpp', status: 0x62 })

          const { set } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
          expect(set.errorCode).toBe('CARRIER_0x62')
        })

        it('keeps today\'s delivered rule unless the report says it was uploaded per part', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          for (const perPartUpload of [undefined, false, 'true', 1]) {
            mockSmsModel.findOneAndUpdate.mockClear()
            mockWebhookService.deliverNotification.mockClear()
            device()
            stored()
            updatedTo('delivered')

            await delivered({ format: '3gpp', status: 0x41 }, { perPartUpload })

            expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
            expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_DELIVERED)
          }
        })

        it('reads the verdict of a per-part upload that has no partCount', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored()
          updatedTo('failed')

          await delivered(
            { format: '3gpp', status: 0x41 },
            { partIndex: undefined, partCount: undefined },
          )

          const { set } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
          expect(set.errorCode).toBe('CARRIER_0x41')
          expect(mockSmsPartReportModel.create).not.toHaveBeenCalled()
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_FAILED)
        })

        it('follows the report flag, not the part reports config of the device', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          process.env.PART_REPORTS_ENABLED = 'false'
          device({ partReportsEnabled: false })
          stored()
          updatedTo('failed')

          await delivered({ format: '3gpp', status: 0x41 })

          const { set } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
          expect(set.errorCode).toBe('CARRIER_0x41')

          mockSmsModel.findOneAndUpdate.mockClear()
          delete process.env.PART_REPORTS_ENABLED
          device({ partReportsEnabled: true })
          stored()
          updatedTo('delivered')

          await delivered({ format: '3gpp', status: 0x41 }, { perPartUpload: undefined })

          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
        })

        it('clears a send timeout while the carrier still tries', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored({
            status: 'failed',
            failedAt: new Date(Date.now() - 60000),
            errorCode: 'SEND_TIMEOUT',
            errorMessage: 'no report from the phone',
            issueHistory: [
              {
                code: 'SEND_TIMEOUT',
                message: 'no report from the phone',
                at: new Date(Date.now() - 60000),
                source: 'server',
              },
            ],
          })
          updatedTo('sent')

          await delivered({ format: '3gpp', status: 0x20 })

          const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
          expect(update.$set.status).toBe('sent')
          expect(update.$unset).toEqual(
            expect.objectContaining({ errorCode: '', errorMessage: '', failedAt: '' }),
          )
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_SENT)
        })

        it('stores two unreadable delivery reports of one part as two rows', async () => {
          device()
          for (const pdu of ['0011223344', '0011223355']) {
            stored({ status: 'delivered', deliveredAt: new Date() })
            await delivered({ format: '3gpp', pdu }, { partIndex: 1, partCount: 2 })
          }

          const keys = mockSmsPartReportModel.create.mock.calls.map(([doc]) => doc.key)
          expect(keys).toHaveLength(2)
          expect(keys[0]).toMatch(/^1_delivered_none-[0-9a-f]{8}$/)
          expect(keys[1]).toMatch(/^1_delivered_none-[0-9a-f]{8}$/)
          expect(keys[0]).not.toBe(keys[1])
        })

        it('lets a device override turn the verdict off', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device({ carrierVerdictEnabled: false })
          stored()
          updatedTo('delivered')

          await delivered({ format: '3gpp', status: 0x62 })

          expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
        })

        it('moves a waiting message to sent, never delivered, while the carrier still tries', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored()
          updatedTo('sent')

          await delivered({ format: '3gpp', status: 0x20 })

          const update = mockSmsModel.findOneAndUpdate.mock.calls[0][1]
          expect(update.$set.status).toBe('sent')
          expect(update.$set.deliveredAt).toBeUndefined()
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_SENT)
        })

        it('leaves a sent message alone while the carrier still tries', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          device()
          stored({ status: 'sent', sentAt: new Date() })

          await delivered({ format: '3gpp', status: 0x20 })

          expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
          expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
        })

        it('marks delivered on a carrier delivered status or without a delivery report', async () => {
          process.env.CARRIER_VERDICT_ENABLED = 'true'
          for (const deliveryReport of [{ format: '3gpp', status: 0 }, undefined]) {
            mockSmsModel.findOneAndUpdate.mockClear()
            device()
            stored()
            updatedTo('delivered')

            await delivered(deliveryReport)

            expect(mockSmsModel.findOneAndUpdate.mock.calls[0][1].$set.status).toBe('delivered')
          }
        })

        it('fails a long message whose failed part came before a delivered part', async () => {
          device()
          stored({
            status: 'delivered',
            sentAt: new Date(Date.now() - 6000),
            deliveredAt: new Date(Date.now() - 2000),
          })
          updatedTo('failed')

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'failed',
            errorCode: '1',
            failedAtInMillis: Date.now() - 5000,
            partIndex: 1,
            partCount: 3,
          } as any)

          const { set } = readPipelineUpdate(mockSmsModel.findOneAndUpdate.mock.calls[0][1])
          expect(set.status).toBe('failed')
          expect(webhookEvent()).toBe(WebhookEvent.MESSAGE_FAILED)
        })

        it('keeps the old rule for a long message when the switch is off', async () => {
          process.env.MULTIPART_FAILURE_FINAL_ENABLED = 'false'
          device()
          stored({
            status: 'delivered',
            sentAt: new Date(Date.now() - 6000),
            deliveredAt: new Date(Date.now() - 2000),
          })
          mockSmsModel.updateOne.mockResolvedValue({ matchedCount: 1 })

          await service.updateSMSStatus(OWN_DEVICE, {
            smsId: OWN_SMS,
            status: 'failed',
            errorCode: '1',
            failedAtInMillis: Date.now() - 5000,
            partIndex: 1,
            partCount: 3,
          } as any)

          expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
          expect(mockSmsModel.updateOne).toHaveBeenCalledTimes(1)
          expect(mockWebhookService.deliverNotification).not.toHaveBeenCalled()
        })
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

    it('returns catalog error text and keeps the phone text', async () => {
      const failedAt = new Date('2026-11-01T10:00:00Z')
      store.push({
        _id: new Types.ObjectId(),
        user: userId,
        device: deviceA,
        type: SMSType.SENT,
        status: 'failed',
        errorCode: '7',
        errorMessage:
          'Short code not allowed on this carrier. Use a full phone number.',
        failedAt,
        issueHistory: [
          {
            code: '7',
            message:
              'Short code not allowed on this carrier. Use a full phone number.',
            at: failedAt,
            source: 'device',
          },
        ],
        createdAt: new Date(),
      })

      const result = await service.getMessagesForUser(
        user,
        { order: 'desc' } as any,
        1,
        50,
      )

      const [sms] = result.data
      expect(sms.direction).toBe('sent')
      expect(sms.errorCode).toBe('7')
      expect(sms.errorName).toBe('SHORT_CODE_CANCELLED')
      expect(sms.errorMessage).toContain('Premium SMS access')
      expect(sms.docsUrl).toBe(
        'https://textbee.dev/docs/sending-sms/sending-sms#short-codes',
      )
      expect(sms.deviceMessage).toBe(
        'Short code not allowed on this carrier. Use a full phone number.',
      )
      expect(sms.issueHistory[0]).toMatchObject({
        code: '7',
        name: 'SHORT_CODE_CANCELLED',
        deviceMessage:
          'Short code not allowed on this carrier. Use a full phone number.',
      })
    })
  })

  describe('claimPendingMessages', () => {
    const deviceId = new Types.ObjectId().toHexString()
    const currentDevice = {
      _id: deviceId,
      appVersionInfo: { versionCode: 20 },
    }

    const originalSwitch = process.env.RECOVERY_POLL_ENABLED

    beforeEach(() => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      mockDeviceModel.findById.mockResolvedValue(currentDevice)
      mockDeviceModel.findOneAndUpdate.mockReset()
      mockDeviceModel.findOneAndUpdate.mockResolvedValue(currentDevice)
      mockSmsModel.findOneAndUpdate.mockReset()
    })

    afterEach(() => {
      if (originalSwitch === undefined) delete process.env.RECOVERY_POLL_ENABLED
      else process.env.RECOVERY_POLL_ENABLED = originalSwitch
    })

    it('refuses while recovery is switched off, before taking the cooldown', async () => {
      process.env.RECOVERY_POLL_ENABLED = 'false'

      await expect(service.claimPendingMessages(deviceId)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      })
      expect(mockDeviceModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('lets a device override switch recovery on for one device', async () => {
      process.env.RECOVERY_POLL_ENABLED = 'false'
      mockDeviceModel.findById.mockResolvedValue({
        ...currentDevice,
        configOverrides: { recoveryPollEnabled: true },
      })
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)

      expect(await service.claimPendingMessages(deviceId)).toEqual([])
      expect(mockDeviceModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
    })

    it('falls back to the registered version before the first heartbeat', async () => {
      mockDeviceModel.findById.mockResolvedValue({ _id: deviceId, appVersionCode: 20 })
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)

      expect(await service.claimPendingMessages(deviceId)).toEqual([])
    })

    it('refuses an app version without the dedupe store', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        appVersionInfo: { versionCode: 18 },
      })

      await expect(service.claimPendingMessages(deviceId)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses a device that never reported a version', async () => {
      mockDeviceModel.findById.mockResolvedValue({ _id: deviceId })

      await expect(service.claimPendingMessages(deviceId)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      })
    })

    it('refuses a second poll inside the cooldown, decided by one conditional update', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValue(null)

      await expect(service.claimPendingMessages(deviceId)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      })
      const [filter, update] = mockDeviceModel.findOneAndUpdate.mock.calls[0]
      expect(filter._id).toBe(deviceId)
      expect(filter.$or[0]).toEqual({ lastPendingPollAt: { $exists: false } })
      expect(filter.$or[1].lastPendingPollAt.$lt).toBeInstanceOf(Date)
      expect(update).toEqual({ $set: { lastPendingPollAt: expect.any(Date) } })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('claims one message at a time until none is left, in request order', async () => {
      const batchId = new Types.ObjectId()
      const first = { _id: new Types.ObjectId(), message: 'a', recipient: '+15550100', smsBatch: batchId }
      const second = { _id: new Types.ObjectId(), message: 'b', recipient: '+15550101', smsBatch: batchId }
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second)
        .mockResolvedValueOnce(null)

      const claimed = await service.claimPendingMessages(deviceId)

      expect(claimed.map((m) => m.smsId)).toEqual([
        first._id.toHexString(),
        second._id.toHexString(),
      ])
      const [filter, update, options] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      expect(filter.status).toEqual({ $in: ['pending', 'dispatched', 'unknown'] })
      expect(update.$set.status).toBe('dispatched')
      expect(update.$inc).toEqual({ dispatchAttempts: 1 })
      expect(options.sort).toEqual({ requestedAt: 1 })
      expect(options.projection).toBe('+metadata')
      expect(mockDeviceModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
      // Claiming an unknown message puts its batch back in progress
      expect(mockBatchStatus.refresh).toHaveBeenCalledWith([
        batchId.toHexString(),
        batchId.toHexString(),
      ])
    })

    it('returns an empty list when nothing is waiting', async () => {
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)

      expect(await service.claimPendingMessages(deviceId)).toEqual([])
    })

    it.each([1.5, 3000000000, -1, '3'])(
      'leaves out a stored simSubscriptionId of %p that the phone cannot read',
      async (simSubscriptionId) => {
        mockSmsModel.findOneAndUpdate
          .mockResolvedValueOnce({
            _id: new Types.ObjectId(),
            message: 'a',
            recipient: '+15555550100',
            simSubscriptionId,
          })
          .mockResolvedValueOnce(null)

        const [claimed] = await service.claimPendingMessages(deviceId)

        expect(claimed.message).toBe('a')
        expect(claimed).not.toHaveProperty('simSubscriptionId')
      },
    )

    it('hands back a slot request with the id mapped when it was queued', async () => {
      mockSmsModel.bulkWrite.mockReset()
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(),
          message: 'a',
          recipient: '+15555550100',
          simSlotIndex: 1,
          metadata: { appVersionCode: 20, simMappedSubscriptionId: 7 },
        })
        .mockResolvedValueOnce(null)

      const [claimed] = await service.claimPendingMessages(deviceId)

      expect(claimed).toMatchObject({ simSlotIndex: 1, simSubscriptionId: 7 })
    })

    it('keeps the first push time that the claim overwrites, once', async () => {
      const pushedAt = new Date('2026-10-05T19:02:45Z')
      const pushed = { _id: new Types.ObjectId(), message: 'a', recipient: '+15550100', dispatchedAt: pushedAt }
      const neverPushed = { _id: new Types.ObjectId(), message: 'b', recipient: '+15550101' }
      const recoveredBefore = {
        _id: new Types.ObjectId(),
        message: 'c',
        recipient: '+15550102',
        dispatchedAt: new Date('2026-10-05T19:40:00Z'),
        metadata: { firstDispatchedAt: pushedAt, recoveredAt: new Date('2026-10-05T19:40:00Z') },
      }
      mockSmsModel.bulkWrite.mockReset()
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce(pushed)
        .mockResolvedValueOnce(neverPushed)
        .mockResolvedValueOnce(recoveredBefore)
        .mockResolvedValueOnce(null)

      await service.claimPendingMessages(deviceId)

      expect(mockSmsModel.findOneAndUpdate.mock.calls[0][2].returnDocument).toBe('before')
      expect(mockSmsModel.bulkWrite).toHaveBeenCalledTimes(1)
      expect(mockSmsModel.bulkWrite.mock.calls[0][0]).toEqual([
        {
          updateOne: {
            filter: { _id: pushed._id, 'metadata.firstDispatchedAt': { $exists: false } },
            update: { $set: { 'metadata.firstDispatchedAt': pushedAt } },
          },
        },
      ])
    })

    it('does not take an earlier recovery time for the first push time', async () => {
      mockSmsModel.bulkWrite.mockReset()
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(),
          message: 'a',
          recipient: '+15550100',
          dispatchedAt: new Date('2026-10-05T19:37:42Z'),
          metadata: { recoveredAt: new Date('2026-10-05T19:37:42Z') },
        })
        .mockResolvedValueOnce(null)

      await service.claimPendingMessages(deviceId)

      expect(mockSmsModel.bulkWrite).not.toHaveBeenCalled()
    })

    it('loads metadata, so a second recovery never rewrites the first push time', async () => {
      const recoveredAt = new Date('2026-10-05T19:37:42Z')
      const stored = {
        _id: new Types.ObjectId(),
        message: 'a',
        recipient: '+15550100',
        dispatchedAt: recoveredAt,
        metadata: { recoveredAt, firstDispatchedAt: new Date('2026-10-05T19:02:45Z') },
      }
      mockSmsModel.bulkWrite.mockReset()
      // Like Mongoose: metadata is select: false, so it comes back only when asked for
      mockSmsModel.findOneAndUpdate
        .mockImplementationOnce(async (_filter, _update, options) => {
          if (options?.projection === '+metadata') return stored
          const { metadata, ...rest } = stored
          return rest
        })
        .mockResolvedValueOnce(null)

      await service.claimPendingMessages(deviceId)

      expect(mockSmsModel.bulkWrite).not.toHaveBeenCalled()
    })

    it('still hands out claimed messages when the first push time cannot be saved', async () => {
      const pushed = {
        _id: new Types.ObjectId(),
        message: 'a',
        recipient: '+15550100',
        dispatchedAt: new Date('2026-10-05T19:02:45Z'),
      }
      mockSmsModel.bulkWrite.mockReset()
      mockSmsModel.bulkWrite.mockRejectedValueOnce(new Error('write failed'))
      mockSmsModel.findOneAndUpdate.mockResolvedValueOnce(pushed).mockResolvedValueOnce(null)
      const logged = jest.spyOn(console, 'error').mockImplementation(() => {})

      const claimed = await service.claimPendingMessages(deviceId)

      expect(claimed.map((m) => m.smsId)).toEqual([pushed._id.toHexString()])
      logged.mockRestore()
    })

    it('writes no first push time when no claimed message was pushed', async () => {
      mockSmsModel.bulkWrite.mockReset()
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce({ _id: new Types.ObjectId(), message: 'a', recipient: '+15550100' })
        .mockResolvedValueOnce(null)

      await service.claimPendingMessages(deviceId)

      expect(mockSmsModel.bulkWrite).not.toHaveBeenCalled()
    })
  })

  describe('interrupted send report', () => {
    const deviceId = new Types.ObjectId().toHexString()
    const smsId = new Types.ObjectId().toHexString()

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue({ _id: deviceId })
      mockSmsModel.findOneAndUpdate.mockReset()
      mockSmsModel.findOneAndUpdate.mockResolvedValue({ smsBatch: 'batch-1' })
    })

    it('marks a waiting message unknown and stops offering it', async () => {
      const reply = await service.updateSMSStatus(deviceId, {
        smsId,
        smsBatchId: 'batch-1',
        status: 'UNKNOWN',
        errorCode: 'SEND_INTERRUPTED',
      } as any)

      expect(reply).toEqual({ success: true })
      const [filter, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      // A message with a real result is never touched
      expect(filter.status).toEqual({ $in: ['pending', 'dispatched', 'unknown'] })
      expect(String(filter._id)).toBe(smsId)
      expect(String(filter.device)).toBe(deviceId)
      expect(update[0].$set.status).toEqual({ $literal: 'unknown' })
      expect(update[0].$set.errorCode).toEqual({ $literal: 'SEND_INTERRUPTED' })
      expect(update[0].$set.errorMessage).toEqual({
        $literal: SEND_INTERRUPTED_MESSAGE,
      })
      expect(update[1].$set.dispatchAttempts.$max[1]).toBe(3)
      expect(update[2]).toEqual({ $unset: ['metadata.claimableAt'] })
      expect(mockBatchStatus.refresh).toHaveBeenCalledWith(['batch-1'])
    })

    it('records exactly one trail entry for the interrupt', async () => {
      await service.updateSMSStatus(deviceId, {
        smsId,
        status: 'UNKNOWN',
        errorCode: 'SEND_INTERRUPTED',
      } as any)

      const [, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      expect(readPipelineUpdate(update).history).toEqual([
        expect.objectContaining({ code: 'SEND_INTERRUPTED', source: 'device' }),
      ])
    })

    it('stores the text the phone sent, the same in the trail and the error fields', async () => {
      await service.updateSMSStatus(deviceId, {
        smsId,
        status: 'UNKNOWN',
        errorCode: 'SEND_INTERRUPTED',
        errorMessage: 'App restarted during send',
      } as any)

      const [, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      const { set, history } = readPipelineUpdate(update)
      expect(set.errorMessage).toBe('App restarted during send')
      expect(history).toEqual([
        expect.objectContaining({ code: 'SEND_INTERRUPTED', message: 'App restarted during send' }),
      ])

      // The reply shows the catalog text, with the phone's text as deviceMessage
      const shown = smsErrorFields({
        status: 'unknown',
        errorCode: 'SEND_INTERRUPTED',
        errorMessage: set.errorMessage,
        issueHistory: history,
      })
      expect(shown.errorMessage).toBe(findSmsError('device', 'SEND_INTERRUPTED').message)
      expect(shown.deviceMessage).toBe('App restarted during send')
      expect(shown.issueHistory[0].deviceMessage).toBe('App restarted during send')
    })

    it('shows no deviceMessage when the phone sent no text', async () => {
      await service.updateSMSStatus(deviceId, {
        smsId,
        status: 'UNKNOWN',
        errorCode: 'SEND_INTERRUPTED',
        errorMessage: '  ',
      } as any)

      const [, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      const { set, history } = readPipelineUpdate(update)
      const shown = smsErrorFields({
        status: 'unknown',
        errorCode: 'SEND_INTERRUPTED',
        errorMessage: set.errorMessage,
        issueHistory: history,
      })
      const catalog = findSmsError('device', 'SEND_INTERRUPTED').message
      expect(shown.errorMessage).toBe(catalog)
      expect(shown).not.toHaveProperty('deviceMessage')
      expect(shown.issueHistory[0].message).toBe(catalog)
      expect(shown.issueHistory[0]).not.toHaveProperty('deviceMessage')
    })

    it('adds nothing for a repeat of an interrupt report it already recorded', async () => {
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)

      const reply = await service.updateSMSStatus(deviceId, {
        smsId,
        status: 'UNKNOWN',
        errorCode: 'SEND_INTERRUPTED',
      } as any)

      expect(reply).toEqual({ success: true })
      const [filter] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      expect(filter.errorCode).toEqual({ $ne: 'SEND_INTERRUPTED' })
      expect(mockBatchStatus.refresh).not.toHaveBeenCalled()
    })

    it('still refuses an unknown status with any other code', async () => {
      await expect(
        service.updateSMSStatus(deviceId, { smsId, status: 'UNKNOWN' } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })
  })

  describe('claimMessages', () => {
    const deviceId = new Types.ObjectId().toHexString()
    const pullDevice = {
      _id: deviceId,
      user: 'user_1',
      appVersionInfo: { versionCode: 22 },
      pullInfo: { pullCapable: true },
      smsSendDelaySeconds: 5,
      configOverrides: { pullEnabled: true },
    }
    const input = { limit: 10, source: 'timer', installId: 'install-a' }
    const env = { ...process.env }

    beforeEach(() => {
      delete process.env.PULL_ENABLED
      delete process.env.FCM_SEND_SKIP_USER_IDS
      delete process.env.CLAIM_RETRY_AFTER_SECONDS
      mockDeviceModel.findById.mockResolvedValue(pullDevice)
      mockDeviceModel.findOneAndUpdate.mockReset()
      mockDeviceModel.findOneAndUpdate.mockResolvedValue(pullDevice)
      mockSmsModel.findOneAndUpdate.mockReset()
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)
      ;(mockSmsModel as any).exists = jest.fn().mockResolvedValue(null)
    })

    afterEach(() => {
      process.env = { ...env }
    })

    it('refuses an app that did not report that it can claim', async () => {
      mockDeviceModel.findById.mockResolvedValue({ ...pullDevice, pullInfo: undefined })
      await expect(service.claimMessages(deviceId, input)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses while claiming is switched off', async () => {
      mockDeviceModel.findById.mockResolvedValue({ ...pullDevice, configOverrides: {} })
      await expect(service.claimMessages(deviceId, input)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      })
      expect(mockDeviceModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses a call with no install id', async () => {
      await expect(
        service.claimMessages(deviceId, { limit: 5 } as any),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('hands a withheld account nothing', async () => {
      process.env.FCM_SEND_SKIP_USER_IDS = 'user_1'
      const reply = await service.claimMessages(deviceId, input)
      expect(reply.data).toEqual([])
      expect(reply.more).toBe(false)
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('refuses a second call inside the cooldown and says when to come back', async () => {
      mockDeviceModel.findOneAndUpdate.mockResolvedValue(null)
      await expect(service.claimMessages(deviceId, input)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
        response: { retryAfterSeconds: 3 },
      })
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('marks each row as handed to this install and holds it for the lease', async () => {
      const row = { _id: new Types.ObjectId(), message: 'a', recipient: '+15550100' }
      mockSmsModel.findOneAndUpdate.mockResolvedValueOnce(row).mockResolvedValueOnce(null)
      const before = Date.now()

      const reply = await service.claimMessages(deviceId, input)

      expect(reply.data.map((m) => m.smsId)).toEqual([row._id.toHexString()])
      expect(reply.more).toBe(false)
      expect(reply.retryAfterSeconds).toBe(0)
      expect(reply.config.pullEnabled).toBe(true)
      const [filter, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      expect(filter['metadata.appVersionCode']).toEqual({ $gte: 20 })
      expect(filter.$and[2].$or).toEqual([
        { 'metadata.handedTo': { $exists: false } },
        { 'metadata.handedTo': 'install-a' },
      ])
      expect(update.$set.status).toBe('dispatched')
      expect(update.$set['metadata.handedTo']).toBe('install-a')
      expect(update.$set['metadata.claimSource']).toBe('timer')
      expect(update.$set['metadata.transport']).toBe('pull')
      expect(update.$set['metadata.claimableAt'].getTime() - before).toBeGreaterThanOrEqual(
        30 * 60 * 1000,
      )
      expect(update.$unset).toEqual({ errorMessage: '' })
      expect(update.$inc).toEqual({ dispatchAttempts: 1 })
      const [, deviceUpdate] = mockDeviceModel.findOneAndUpdate.mock.calls[0]
      expect(deviceUpdate.$set.installId).toBe('install-a')
    })

    it('leaves out a stored simSubscriptionId the phone cannot read, and keeps a valid one', async () => {
      const unreadable = {
        _id: new Types.ObjectId(),
        message: 'a',
        recipient: '+15555550100',
        simSubscriptionId: 3000000000,
      }
      const valid = { ...unreadable, _id: new Types.ObjectId(), simSubscriptionId: 4 }
      mockSmsModel.findOneAndUpdate
        .mockResolvedValueOnce(unreadable)
        .mockResolvedValueOnce(valid)
        .mockResolvedValueOnce(null)

      const reply = await service.claimMessages(deviceId, input)

      expect(reply.data[0]).not.toHaveProperty('simSubscriptionId')
      expect(reply.data[1].simSubscriptionId).toBe(4)
    })

    it('stops at the asked limit and reports that more is waiting', async () => {
      mockSmsModel.findOneAndUpdate.mockImplementation(async () => ({
        _id: new Types.ObjectId(),
        message: 'a',
        recipient: '+15550100',
      }))
      ;(mockSmsModel as any).exists.mockResolvedValue({ _id: 'x' })

      const reply = await service.claimMessages(deviceId, { ...input, limit: 2 })

      expect(reply.data).toHaveLength(2)
      expect(reply.more).toBe(true)
      expect(mockSmsModel.findOneAndUpdate).toHaveBeenCalledTimes(2)
    })

    it('never returns more than 25 messages', async () => {
      mockSmsModel.findOneAndUpdate.mockImplementation(async () => ({
        _id: new Types.ObjectId(),
        message: 'a',
        recipient: '+15550100',
      }))
      const reply = await service.claimMessages(deviceId, { ...input, limit: 500 })
      expect(reply.data).toHaveLength(25)
    })
  })

  describe('claimPendingMessages with ownership fields', () => {
    const deviceId = new Types.ObjectId().toHexString()
    const env = { ...process.env }

    beforeEach(() => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      delete process.env.FCM_SEND_SKIP_USER_IDS
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        user: 'user_1',
        appVersionInfo: { versionCode: 20 },
      })
      mockDeviceModel.findOneAndUpdate.mockReset()
      mockDeviceModel.findOneAndUpdate.mockResolvedValue({ _id: deviceId })
      mockSmsModel.findOneAndUpdate.mockReset()
      mockSmsModel.findOneAndUpdate.mockResolvedValue(null)
    })

    afterEach(() => {
      process.env = { ...env }
    })

    it('hands a withheld account nothing and takes no cooldown', async () => {
      process.env.FCM_SEND_SKIP_USER_IDS = 'user_1'
      expect(await service.claimPendingMessages(deviceId)).toEqual([])
      expect(mockDeviceModel.findOneAndUpdate).not.toHaveBeenCalled()
      expect(mockSmsModel.findOneAndUpdate).not.toHaveBeenCalled()
    })

    it('clears the claim time so the row waits 30 minutes before the next offer', async () => {
      await service.claimPendingMessages(deviceId)
      const [filter, update] = mockSmsModel.findOneAndUpdate.mock.calls[0]
      expect(update.$unset).toEqual({ errorMessage: '', 'metadata.claimableAt': '' })
      expect(update.$set['metadata.handedTo']).toBe('fcm')
      expect(update.$set['metadata.claimableAt']).toBeUndefined()
      expect(filter.$and[2].$or).toEqual([
        { 'metadata.handedTo': { $exists: false } },
        { 'metadata.handedTo': 'fcm' },
      ])
    })
  })

  describe('heartbeat', () => {
    const deviceId = 'device_hb'

    beforeEach(() => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        user: 'user_1',
        name: 'Pixel',
      })
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({
        _id: deviceId,
        name: 'Pixel',
      })
    })

    const heartbeatUpdate = () =>
      mockDeviceModel.findByIdAndUpdate.mock.calls[0][1].$set

    it('stores the android power state', async () => {
      await service.heartbeat(deviceId, {
        isIgnoringBatteryOptimizations: false,
        isDeviceIdleMode: true,
        isPowerSaveMode: false,
      } as any)

      const update = heartbeatUpdate()
      expect(update['powerInfo.isIgnoringBatteryOptimizations']).toBe(false)
      expect(update['powerInfo.isDeviceIdleMode']).toBe(true)
      expect(update['powerInfo.isPowerSaveMode']).toBe(false)
      expect(update['powerInfo.lastUpdated']).toBeInstanceOf(Date)
    })

    it('stores the app state', async () => {
      await service.heartbeat(deviceId, {
        hasSendSmsPermission: true,
        hasReceiveSmsPermission: false,
        hasReadPhoneStatePermission: true,
        hasPostNotificationsPermission: false,
        stickyNotificationEnabled: true,
        usingLegacyUi: false,
      } as any)

      const update = heartbeatUpdate()
      expect(update['appStateInfo.hasSendSmsPermission']).toBe(true)
      expect(update['appStateInfo.hasReceiveSmsPermission']).toBe(false)
      expect(update['appStateInfo.hasPostNotificationsPermission']).toBe(false)
      expect(update['appStateInfo.stickyNotificationEnabled']).toBe(true)
      expect(update['appStateInfo.usingLegacyUi']).toBe(false)
      expect(update['appStateInfo.lastUpdated']).toBeInstanceOf(Date)
    })

    it('updates the device app version when the reported one differs', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        appVersionName: '2.8.0',
        appVersionCode: 0,
      })

      await service.heartbeat(deviceId, {
        appVersionName: '2.9.0',
        appVersionCode: 20,
      } as any)

      const update = heartbeatUpdate()
      expect(update.appVersionName).toBe('2.9.0')
      expect(update.appVersionCode).toBe(20)
      expect(update['appVersionInfo.versionName']).toBe('2.9.0')
      expect(update['appVersionInfo.versionCode']).toBe(20)
    })

    it('leaves the device app version alone when unchanged or unset', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        appVersionName: '2.9.0',
        appVersionCode: 20,
      })

      await service.heartbeat(deviceId, { appVersionName: '2.9.0', appVersionCode: 20 } as any)
      expect(heartbeatUpdate()).not.toHaveProperty('appVersionName')
      expect(heartbeatUpdate()).not.toHaveProperty('appVersionCode')

      mockDeviceModel.findByIdAndUpdate.mockClear()
      await service.heartbeat(deviceId, { appVersionName: '', appVersionCode: 0 } as any)
      expect(heartbeatUpdate()).not.toHaveProperty('appVersionName')
      expect(heartbeatUpdate()).not.toHaveProperty('appVersionCode')
    })

    it('clears a token invalidation when the same token is reported again', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        fcmToken: 'same',
        fcmTokenInvalidatedAt: new Date(),
      })

      await service.heartbeat(deviceId, { fcmToken: 'same' } as any)

      const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1]
      expect(update.$unset).toEqual({
        fcmTokenInvalidatedAt: 1,
        fcmTokenInvalidReason: 1,
      })
      expect(update.$set).not.toHaveProperty('fcmToken')
    })

    it('returns the fleet config and the pending count', async () => {
      mockSmsModel.countDocuments.mockResolvedValue(3)

      const result = await service.heartbeat(deviceId, {} as any)

      expect(result.pendingCount).toBe(3)
      expect(mockSmsModel.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({ status: { $in: ['pending', 'dispatched', 'unknown'] } }),
      )
      expect(result.config).toEqual(
        expect.objectContaining({
          sendSchedulerV2Enabled: expect.any(Boolean),
          recoveryPollEnabled: expect.any(Boolean),
          latestVersionCode: expect.any(Number),
        }),
      )
    })

    it('replies with the admin notice, then the update notice', async () => {
      const notice = { id: 'maintenance-1', level: 'info', text: 'Hello', dismissible: true }
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        appVersionInfo: { versionCode: 21, versionName: '2.9.0' },
        configOverrides: { notice, latestVersionCode: 22, latestVersionName: '2.10.0' },
      })

      const result = await service.heartbeat(deviceId, {} as any)

      expect(result.config.notices).toEqual([
        notice,
        expect.objectContaining({
          id: expect.stringMatching(/^update-22-\d{4}-\d{2}$/),
          text: 'textbee 2.10.0 is available.',
          dismissible: true,
        }),
      ])
      expect(result.config).not.toHaveProperty('notice')
    })

    it('applies the device config overrides to the reply', async () => {
      mockDeviceModel.findById.mockResolvedValue({
        _id: deviceId,
        configOverrides: { recoveryPollEnabled: true },
      })

      const result = await service.heartbeat(deviceId, {} as any)

      expect(result.config.recoveryPollEnabled).toBe(true)
    })

    it('stores memory and storage, which were accepted but dropped before', async () => {
      await service.heartbeat(deviceId, {
        memoryFreeBytes: 120,
        memoryTotalBytes: 240,
        memoryMaxBytes: 480,
        storageAvailableBytes: 900,
        storageTotalBytes: 1800,
      } as any)

      const update = heartbeatUpdate()
      expect(update['memoryInfo.freeBytes']).toBe(120)
      expect(update['memoryInfo.totalBytes']).toBe(240)
      expect(update['memoryInfo.maxBytes']).toBe(480)
      expect(update['storageInfo.availableBytes']).toBe(900)
      expect(update['storageInfo.totalBytes']).toBe(1800)
    })

    it('keeps the reported SIM service state', async () => {
      await service.heartbeat(deviceId, {
        simInfo: {
          sims: [
            {
              subscriptionId: 1,
              serviceState: 'OUT_OF_SERVICE',
              simState: 'READY',
              isRoaming: false,
              signalLevel: 0,
            },
          ],
        },
      } as any)

      const update = heartbeatUpdate()
      expect(update.simInfo.sims[0]).toEqual(
        expect.objectContaining({
          serviceState: 'OUT_OF_SERVICE',
          signalLevel: 0,
        }),
      )
      expect(update.simInfo.lastUpdated).toBeInstanceOf(Date)
    })

    describe('closed notice ids', () => {
      it('stores a valid list', async () => {
        await service.heartbeat(deviceId, {
          closedNoticeIds: ['update-22-2026-46', 'n-1'],
        } as any)

        expect(heartbeatUpdate().closedNoticeIds).toEqual(['update-22-2026-46', 'n-1'])
      })

      it('stores an empty list', async () => {
        await service.heartbeat(deviceId, { closedNoticeIds: [] } as any)

        expect(heartbeatUpdate().closedNoticeIds).toEqual([])
      })

      it('leaves the stored list alone when the field is absent', async () => {
        await service.heartbeat(deviceId, { batteryPercentage: 80 } as any)

        expect(heartbeatUpdate()).not.toHaveProperty('closedNoticeIds')
      })

      it('keeps the good ids and the last 50', async () => {
        const ids = Array.from({ length: 51 }, (_, i) => `n-${i}`)
        await service.heartbeat(deviceId, {
          closedNoticeIds: ['a b', ...ids, { $ne: null }],
        } as any)

        expect(heartbeatUpdate().closedNoticeIds).toEqual(ids.slice(1))
      })

      it('stores an empty list when no id is valid', async () => {
        await service.heartbeat(deviceId, { closedNoticeIds: ['a b', 7] } as any)

        expect(heartbeatUpdate().closedNoticeIds).toEqual([])
      })

      it.each([
        ['not a list', 'n-1'],
        ['an object', { $ne: null }],
        ['a list of 201', Array.from({ length: 201 }, (_, i) => `n-${i}`)],
      ])('ignores a value that is %s and still succeeds', async (_, closedNoticeIds) => {
        const result = await service.heartbeat(deviceId, {
          batteryPercentage: 80,
          closedNoticeIds,
        } as any)

        expect(result.success).toBe(true)
        const update = heartbeatUpdate()
        expect(update).not.toHaveProperty('closedNoticeIds')
        expect(update['batteryInfo.percentage']).toBe(80)
      })
    })

    describe('API key used', () => {
      const apiKeyId = new Types.ObjectId()

      it('loads the recorded key with the device', async () => {
        await service.heartbeat(deviceId, {} as any, apiKeyId)

        expect(mockDeviceModel.findById.mock.calls[0]).toEqual([
          deviceId,
          { '+apiKey': 1, ...APP_VERSION_HISTORY_PROJECTION },
        ])
      })

      it('records a new key in the same write as the heartbeat', async () => {
        await service.heartbeat(deviceId, {} as any, apiKeyId)

        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        expect(String(heartbeatUpdate().apiKey)).toBe(String(apiKeyId))
      })

      it('does not write the key again while it is unchanged', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          _id: deviceId,
          apiKey: apiKeyId,
        })

        await service.heartbeat(deviceId, {} as any, apiKeyId)

        expect(heartbeatUpdate()).not.toHaveProperty('apiKey')
      })

      it('records a changed key at once', async () => {
        const newKeyId = new Types.ObjectId()
        mockDeviceModel.findById.mockResolvedValue({
          _id: deviceId,
          apiKey: apiKeyId,
        })

        await service.heartbeat(deviceId, {} as any, newKeyId)

        expect(String(heartbeatUpdate().apiKey)).toBe(String(newKeyId))
      })

      it('records nothing when the request used no key', async () => {
        await service.heartbeat(deviceId, {} as any)

        expect(heartbeatUpdate()).not.toHaveProperty('apiKey')
      })
    })

    it('writes no power keys when the device reports none', async () => {
      await service.heartbeat(deviceId, { batteryPercentage: 80 } as any)

      const update = heartbeatUpdate()
      expect(
        Object.keys(update).some((key) => key.startsWith('powerInfo.')),
      ).toBe(false)
    })

    describe('app version history', () => {
      const PLAY = 'com.android.vending'
      const KEY_22 = `22|2.10.0|${PLAY}`
      const trackedDevice = {
        _id: deviceId,
        user: 'user_1',
        name: 'Pixel',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        appVersionCode: 22,
        appVersionName: '2.10.0',
        appVersionInfo: { versionCode: 22, versionName: '2.10.0' },
        appVersionKey: KEY_22,
      }
      const sameBuild = {
        appVersionCode: 22,
        appVersionName: '2.10.0',
        installerPackage: PLAY,
      }

      beforeEach(() => {
        mockDeviceModel.findById.mockResolvedValue(trackedDevice)
      })

      it('makes no extra query or write when nothing changed', async () => {
        const result = await service.heartbeat(deviceId, sameBuild as any)

        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        // The load and the reload for the reply, as before
        expect(mockDeviceModel.findById).toHaveBeenCalledTimes(2)
        expect(heartbeatUpdate().appVersionLastSeenAt).toEqual(result.lastHeartbeat)
      })

      it('records a new version in one update before the heartbeat write', async () => {
        mockDeviceModel.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
        await service.heartbeat(deviceId, {
          appVersionCode: 23,
          appVersionName: '2.11.0',
          installerPackage: PLAY,
        } as any)

        expect(mockDeviceModel.updateOne).toHaveBeenCalledTimes(1)
        const [filter, update, options] = mockDeviceModel.updateOne.mock.calls[0]
        expect(filter).toEqual({ _id: deviceId, appVersionKey: KEY_22 })
        expect(Array.isArray(update)).toBe(true)
        expect(update[0].$set.appVersionKey).toEqual({
          $literal: `23|2.11.0|${PLAY}`,
        })
        expect(options).toEqual({ updatePipeline: true, timestamps: false })
        expect(mockDeviceModel.updateOne.mock.invocationCallOrder[0]).toBeLessThan(
          mockDeviceModel.findByIdAndUpdate.mock.invocationCallOrder[0],
        )
        expect(heartbeatUpdate().appVersionLastSeenAt).toBeInstanceOf(Date)
      })

      it('does not retry when the filter matched nothing', async () => {
        mockDeviceModel.updateOne.mockResolvedValueOnce({
          matchedCount: 0,
          modifiedCount: 0,
        })

        const result = await service.heartbeat(deviceId, {
          appVersionCode: 23,
          appVersionName: '2.11.0',
          installerPackage: PLAY,
        } as any)

        expect(result.success).toBe(true)
        expect(mockDeviceModel.updateOne).toHaveBeenCalledTimes(1)
        expect(mockDeviceModel.findById).toHaveBeenCalledTimes(2)
        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        // A lost race leaves the last-seen time to the request that won
        expect(heartbeatUpdate()).not.toHaveProperty('appVersionLastSeenAt')
      })

      it('counts a flap in the heartbeat write with no write of its own', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          ...trackedDevice,
          appVersionHistory: [
            {
              versionCode: 21,
              versionName: '2.9.0',
              installSource: 'play_store',
              installerPackage: PLAY,
              firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
              seeded: false,
            },
            {
              versionCode: 22,
              versionName: '2.10.0',
              installSource: 'play_store',
              installerPackage: PLAY,
              firstSeenAt: new Date(),
              seeded: false,
            },
          ],
        })

        await service.heartbeat(deviceId, {
          appVersionCode: 21,
          appVersionName: '2.9.0',
          installerPackage: PLAY,
        } as any)

        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        const update = mockDeviceModel.findByIdAndUpdate.mock.calls[0][1]
        expect(update.$inc).toEqual({ appVersionFlapCount: 1 })
        expect(update.$set).not.toHaveProperty('appVersionLastSeenAt')
      })

      it('still answers the heartbeat when the history write fails', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
        mockDeviceModel.updateOne.mockRejectedValueOnce(new Error('write failed'))

        const result = await service.heartbeat(deviceId, {
          appVersionCode: 23,
          appVersionName: '2.11.0',
        } as any)

        expect(result.success).toBe(true)
        expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledTimes(1)
        expect(heartbeatUpdate()).not.toHaveProperty('appVersionLastSeenAt')
        error.mockRestore()
      })

      it('starts the history from the stored version for a build that reports none', async () => {
        mockDeviceModel.findById.mockResolvedValue({
          _id: deviceId,
          user: 'user_1',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          appVersionCode: 16,
          appVersionName: '2.6.0',
        })

        await service.heartbeat(deviceId, { batteryPercentage: 80 } as any)

        const [filter, update] = mockDeviceModel.updateOne.mock.calls[0]
        expect(filter).toEqual({ _id: deviceId, appVersionKey: { $exists: false } })
        const appended = update[0].$set.appVersionHistory.$slice[0].$concatArrays[1][0].$literal
        expect(appended).toEqual(
          expect.objectContaining({ versionCode: 16, versionName: '2.6.0', installSource: 'unknown', seeded: true }),
        )
      })

      it('drops bad install values and still succeeds', async () => {
        const result = await service.heartbeat(deviceId, {
          ...sameBuild,
          installerPackage: { $ne: null },
          initiatingPackage: 'a b',
          appLastUpdateTime: -5,
        } as any)

        expect(result.success).toBe(true)
        // No usable installer field keeps the installer of the current key
        expect(mockDeviceModel.updateOne).not.toHaveBeenCalled()
        const update = heartbeatUpdate()
        expect(update).not.toHaveProperty('installerPackage')
        expect(update).not.toHaveProperty('initiatingPackage')
        expect(update).not.toHaveProperty('appLastUpdateTime')
      })

      it('adds no field to the heartbeat reply', async () => {
        const result = await service.heartbeat(deviceId, {
          appVersionCode: 23,
          appVersionName: '2.11.0',
          installerPackage: PLAY,
        } as any)

        expect(Object.keys(result).sort()).toEqual(
          ['config', 'fcmTokenUpdated', 'lastHeartbeat', 'name', 'pendingCount', 'success'],
        )
      })
    })
  })
})
