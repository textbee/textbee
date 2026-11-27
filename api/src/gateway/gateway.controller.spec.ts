import { Types } from 'mongoose'
import { GatewayController } from './gateway.controller'
import { GatewayService } from './gateway.service'

describe('GatewayController API key recording', () => {
  const deviceId = '507f1f77bcf86cd799439011'
  const apiKeyId = new Types.ObjectId()
  const user = { _id: new Types.ObjectId() }
  // What AuthGuard leaves on the request for each kind of sign-in
  const apiKeyRequest = { user, apiKey: { _id: apiKeyId, user: user._id } }
  const sessionRequest = { user }

  let gatewayService: {
    heartbeat: jest.Mock
    registerDevice: jest.Mock
    updateDevice: jest.Mock
    completeSignInConnect: jest.Mock
  }
  let controller: GatewayController

  beforeEach(() => {
    gatewayService = {
      heartbeat: jest.fn().mockResolvedValue({ success: true }),
      registerDevice: jest.fn().mockResolvedValue({ _id: deviceId }),
      updateDevice: jest.fn().mockResolvedValue({ _id: deviceId }),
      completeSignInConnect: jest.fn().mockResolvedValue(undefined),
    }
    controller = new GatewayController(
      gatewayService as unknown as GatewayService,
    )
  })

  it('passes the key id of a heartbeat to the service', async () => {
    await controller.heartbeat(deviceId, {} as any, apiKeyRequest)

    expect(gatewayService.heartbeat).toHaveBeenCalledWith(
      deviceId,
      {},
      apiKeyId,
      {},
    )
  })

  it('passes no key id for a heartbeat signed in with a dashboard session', async () => {
    await controller.heartbeat(deviceId, {} as any, sessionRequest)

    expect(gatewayService.heartbeat).toHaveBeenCalledWith(
      deviceId,
      {},
      undefined,
      {},
    )
  })

  it('passes the key id of a registration to the service', async () => {
    await controller.registerDevice({ model: 'Pixel 8' } as any, apiKeyRequest)

    expect(gatewayService.registerDevice).toHaveBeenCalledWith(
      { model: 'Pixel 8' },
      user,
      apiKeyId,
      {},
    )
  })

  it('passes no key id for a registration signed in with a dashboard session', async () => {
    await controller.registerDevice({ model: 'Pixel 8' } as any, sessionRequest)

    expect(gatewayService.registerDevice).toHaveBeenCalledWith(
      { model: 'Pixel 8' },
      user,
      undefined,
      {},
    )
  })

  it('passes a hand-made key as the request key, not as a sign-in key, and ignores a key field in the body', async () => {
    await controller.updateDevice(
      deviceId,
      { name: 'Office', apiKey: String(apiKeyId) } as any,
      apiKeyRequest,
    )

    expect(gatewayService.updateDevice).toHaveBeenCalledWith(
      deviceId,
      { name: 'Office' },
      { apiKeyId: undefined, requestKeyId: apiKeyId, phone: {} },
    )
  })

  it('records a phone sign-in key for a device update and completes its connect', async () => {
    const signInKey = {
      _id: apiKeyId,
      user: user._id,
      source: 'device-link',
      linkedDevice: deviceId,
    }
    const headers = { 'x-install-id': 'install-a', 'x-phone-id': 'p'.repeat(64), 'x-app-signer': 's'.repeat(64) }
    await controller.updateDevice(deviceId, { fcmToken: 'token-a' } as any, {
      user,
      apiKey: signInKey,
      headers,
    })

    const phone = { installId: 'install-a', phoneId: 'p'.repeat(64), phoneSigner: 's'.repeat(64) }
    expect(gatewayService.updateDevice).toHaveBeenCalledWith(
      deviceId,
      { fcmToken: 'token-a' },
      { apiKeyId, requestKeyId: apiKeyId, phone },
    )
    expect(gatewayService.completeSignInConnect).toHaveBeenCalledWith(deviceId, signInKey, phone)
  })

  it('passes the install id of a registration to the service', async () => {
    await controller.registerDevice(
      { fcmToken: 'token-a', installId: 'install-a', pushInstallId: 'x' } as any,
      apiKeyRequest,
    )

    expect(gatewayService.registerDevice).toHaveBeenCalledWith(
      { fcmToken: 'token-a', installId: 'install-a' },
      user,
      apiKeyId,
      {},
    )
  })

  it('passes the install id of a device update to the service', async () => {
    await controller.updateDevice(
      deviceId,
      { fcmToken: 'token-a', installId: 'install-a', pushInstallId: 'x' } as any,
      sessionRequest,
    )

    expect(gatewayService.updateDevice).toHaveBeenCalledWith(
      deviceId,
      { fcmToken: 'token-a', installId: 'install-a' },
      { apiKeyId: undefined, requestKeyId: undefined, phone: {} },
    )
    expect(gatewayService.completeSignInConnect).not.toHaveBeenCalled()
  })
})

describe('GatewayController send request details', () => {
  const deviceId = '507f1f77bcf86cd799439011'
  const apiKeyId = new Types.ObjectId()
  const body = { message: 'Hi', recipients: ['+15555550123'] } as any

  const setup = () => {
    const gatewayService = {
      sendSMS: jest.fn().mockResolvedValue({ smsBatchId: 'b1' }),
      sendBulkSMS: jest.fn().mockResolvedValue({ smsBatchId: 'b2' }),
      resolveSenderDevice: jest.fn().mockResolvedValue({ _id: deviceId }),
    }
    const controller = new GatewayController(gatewayService as unknown as GatewayService)
    return { gatewayService, controller }
  }

  it('passes the client and key of an API request to the service', async () => {
    const { gatewayService, controller } = setup()
    await controller.sendSMSDeviceless(
      { user: {}, apiKey: { _id: apiKeyId }, headers: { 'x-sdk-client': 'textbee-js/0.6.1' } },
      body,
    )

    expect(gatewayService.sendSMS).toHaveBeenCalledWith(deviceId, body, {
      source: 'sdk-js',
      client: 'textbee-js',
      clientVersion: '0.6.1',
      apiKey: apiKeyId,
    })
  })

  it('passes the details on the bulk route', async () => {
    const { gatewayService, controller } = setup()
    await controller.sendBulkSMSDeviceless(
      { user: {}, apiKey: { _id: apiKeyId }, headers: { 'user-agent': 'curl/8.4.0' } },
      body,
    )

    expect(gatewayService.sendBulkSMS).toHaveBeenCalledWith(deviceId, body, {
      source: 'api',
      client: 'curl',
      apiKey: apiKeyId,
    })
  })

  it('passes the details on the device send route', async () => {
    const { gatewayService, controller } = setup()
    await controller.sendSMS(deviceId, body, {
      user: {},
      apiKey: { _id: apiKeyId },
      headers: { 'x-sdk-client': 'textbee-n8n/1.3.0' },
    })

    expect(gatewayService.sendSMS).toHaveBeenCalledWith(deviceId, body, {
      source: 'n8n',
      client: 'textbee-n8n',
      clientVersion: '1.3.0',
      apiKey: apiKeyId,
    })
  })

  it('marks a device-route bulk send from the dashboard', async () => {
    const { gatewayService, controller } = setup()
    await controller.sendBulkSMS(deviceId, body, {
      user: {},
      headers: { authorization: 'Bearer token' },
    })

    expect(gatewayService.sendBulkSMS).toHaveBeenCalledWith(deviceId, body, {
      source: 'dashboard',
    })
  })
})
