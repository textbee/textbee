import { HEADERS_METADATA, GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { AuthGuard } from '../auth/guards/auth.guard'
import { LoginSessionGuard } from '../auth/guards/login-session.guard'
import { DeviceLinksController } from './device-links.controller'

describe('DeviceLinksController', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ displayCode: 'K7QX-2M9P' }),
    poll: jest.fn().mockResolvedValue({ status: 'pending', pollIntervalSeconds: 3 }),
    lookup: jest.fn().mockResolvedValue({ status: 'pending' }),
    approve: jest.fn().mockResolvedValue({ status: 'approved' }),
    deny: jest.fn().mockResolvedValue({ status: 'denied' }),
    settings: jest.fn().mockResolvedValue({ enabled: false, defaultTab: 'key' }),
  }
  const controller = new DeviceLinksController(service as any)
  const proto = DeviceLinksController.prototype
  const user = { _id: 'u1' }

  it('wraps every answer in the data envelope', async () => {
    const req = { user, headers: {} }
    await expect(controller.create({}, req)).resolves.toEqual({ data: { displayCode: 'K7QX-2M9P' } })
    await expect(controller.poll({})).resolves.toEqual({
      data: { status: 'pending', pollIntervalSeconds: 3 },
    })
    await expect(controller.lookup('K7QX-2M9P', req)).resolves.toEqual({ data: { status: 'pending' } })
    await expect(controller.approve('K7QX-2M9P', { action: 'new' }, req)).resolves.toEqual({
      data: { status: 'approved' },
    })
    await expect(controller.deny('K7QX-2M9P', req)).resolves.toEqual({ data: { status: 'denied' } })
    await expect(controller.settings(req)).resolves.toEqual({
      data: { enabled: false, defaultTab: 'key' },
    })
    expect(service.lookup).toHaveBeenCalledWith(user, 'K7QX-2M9P', req)
  })

  it('marks the poll answer as not cacheable and answers 200', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, proto.poll)).toEqual([
      { name: 'Cache-Control', value: 'no-store' },
    ])
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.poll)).toBe(200)
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.approve)).toBe(200)
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.deny)).toBe(200)
  })

  it('leaves create and poll open and puts the login-session guard first on the rest', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.create)).toBeUndefined()
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.poll)).toBeUndefined()
    for (const handler of [proto.lookup, proto.approve, proto.deny, proto.settings]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([LoginSessionGuard, AuthGuard])
    }
  })
})
