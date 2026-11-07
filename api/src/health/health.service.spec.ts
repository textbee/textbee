import { HealthService } from './health.service'

function makeService({
  mongoPing = jest.fn().mockResolvedValue({ ok: 1 }),
  redisPing = jest.fn().mockResolvedValue('PONG'),
  connected = true,
} = {}) {
  const connection = connected
    ? { db: { admin: () => ({ ping: mongoPing }) } }
    : { db: undefined }
  const moduleRef = { get: jest.fn().mockReturnValue({ client: { ping: redisPing } }) }
  return new HealthService(connection as any, moduleRef as any)
}

describe('HealthService', () => {
  it('is ok when mongo and redis both answer', async () => {
    await expect(makeService().check()).resolves.toEqual({
      status: 'ok',
      mongo: 'ok',
      redis: 'ok',
    })
  })

  it('reports the failing dependency and an error status', async () => {
    const service = makeService({
      redisPing: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    })
    await expect(service.check()).resolves.toEqual({
      status: 'error',
      mongo: 'ok',
      redis: 'error',
    })
  })

  it('treats a mongo failure as an error without throwing', async () => {
    const service = makeService({
      mongoPing: jest.fn().mockRejectedValue(new Error('not connected')),
    })
    const result = await service.check()
    expect(result.status).toBe('error')
    expect(result.mongo).toBe('error')
  })

  it('reports mongo as error when the connection has no database yet', async () => {
    const result = await makeService({ connected: false }).check()
    expect(result.mongo).toBe('error')
    expect(result.redis).toBe('ok')
  })
})
