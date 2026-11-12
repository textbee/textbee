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
  }
  let controller: GatewayController

  beforeEach(() => {
    gatewayService = {
      heartbeat: jest.fn().mockResolvedValue({ success: true }),
      registerDevice: jest.fn().mockResolvedValue({ _id: deviceId }),
      updateDevice: jest.fn().mockResolvedValue({ _id: deviceId }),
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
    )
  })

  it('passes no key id for a heartbeat signed in with a dashboard session', async () => {
    await controller.heartbeat(deviceId, {} as any, sessionRequest)

    expect(gatewayService.heartbeat).toHaveBeenCalledWith(
      deviceId,
      {},
      undefined,
    )
  })

  it('passes the key id of a registration to the service', async () => {
    await controller.registerDevice({ model: 'Pixel 8' } as any, apiKeyRequest)

    expect(gatewayService.registerDevice).toHaveBeenCalledWith(
      { model: 'Pixel 8' },
      user,
      apiKeyId,
    )
  })

  it('passes no key id for a registration signed in with a dashboard session', async () => {
    await controller.registerDevice({ model: 'Pixel 8' } as any, sessionRequest)

    expect(gatewayService.registerDevice).toHaveBeenCalledWith(
      { model: 'Pixel 8' },
      user,
      undefined,
    )
  })

  it('records nothing for a device update, even with a key or a key field in the body', async () => {
    await controller.updateDevice(deviceId, {
      name: 'Office',
      apiKey: String(apiKeyId),
    } as any)

    expect(gatewayService.updateDevice).toHaveBeenCalledWith(deviceId, {
      name: 'Office',
    })
  })
})
