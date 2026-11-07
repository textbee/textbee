import { MonitoredJob, monitoringPingBase, pingJob } from './job-monitor'

describe('job-monitor', () => {
  const originalEnv = process.env.MONITORING_PING_URL
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MONITORING_PING_URL
    else process.env.MONITORING_PING_URL = originalEnv
  })

  it('is off when the base URL is unset or blank', () => {
    delete process.env.MONITORING_PING_URL
    expect(monitoringPingBase()).toBeNull()
    pingJob(MonitoredJob.heartbeatCheck)

    process.env.MONITORING_PING_URL = '   '
    expect(monitoringPingBase()).toBeNull()
    pingJob(MonitoredJob.heartbeatCheck)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requests <base>/<slug> and tolerates a trailing slash', () => {
    process.env.MONITORING_PING_URL = 'https://hc-ping.com/key/'
    pingJob(MonitoredJob.smsStatusSweep)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://hc-ping.com/key/api-sms-status-sweep',
    )
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('never throws when the request fails', async () => {
    process.env.MONITORING_PING_URL = 'https://hc-ping.com/key'
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    expect(() => pingJob(MonitoredJob.userRollup)).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('uses one distinct slug per job', () => {
    const slugs = Object.values(MonitoredJob)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^api-[a-z-]+$/)
  })
})
