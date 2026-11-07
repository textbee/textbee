import { HealthService } from './health.service'

function makeService({
  mongoPing = jest.fn().mockResolvedValue({ ok: 1 }),
  redisPing = jest.fn().mockResolvedValue('PONG'),
} = {}) {
  const connection = { db: { admin: () => ({ ping: mongoPing }) } }
  const smsQueue = { client: { ping: redisPing } }
  return new HealthService(connection as any, smsQueue as any)
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
})
