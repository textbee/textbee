import {
  claimLeaseMs,
  deviceCanClaim,
  deviceUsesPull,
  pushOwnershipEnabled,
  pushWasRejected,
} from './push-ownership'

describe('push ownership', () => {
  const env = { ...process.env }
  const now = new Date('2026-11-11T12:00:00Z')
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

  afterEach(() => {
    process.env = { ...env }
  })

  it('is off when the environment does not turn it on', () => {
    delete process.env.RECOVERABLE_PUSH_FAILURES_ENABLED
    expect(pushOwnershipEnabled()).toBe(false)
    process.env.RECOVERABLE_PUSH_FAILURES_ENABLED = 'false'
    expect(pushOwnershipEnabled()).toBe(false)
    process.env.RECOVERABLE_PUSH_FAILURES_ENABLED = 'true'
    expect(pushOwnershipEnabled()).toBe(true)
  })

  describe('rejected pushes', () => {
    it.each([
      'messaging/invalid-argument',
      'messaging/registration-token-not-registered',
      'messaging/mismatched-credential',
      'messaging/message-rate-exceeded',
      'messaging/third-party-auth-error',
      'app/invalid-credential',
    ])('treats %s as never accepted', (code) => {
      expect(pushWasRejected({ code })).toBe(true)
    })

    it.each([
      'messaging/internal-error',
      'messaging/server-unavailable',
      'messaging/unknown-error',
      'app/network-error',
      'app/network-timeout',
      'FCM_SEND_TIMEOUT',
      'ETIMEDOUT',
      undefined,
    ])('treats %s as possibly accepted', (code) => {
      expect(pushWasRejected({ code })).toBe(false)
    })

    it('treats a missing error as possibly accepted', () => {
      expect(pushWasRejected(null)).toBe(false)
      expect(pushWasRejected(undefined)).toBe(false)
    })
  })

  describe('devices that can claim', () => {
    it('needs a build with send memory, a fresh heartbeat and a switch', () => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      const device = { appVersionInfo: { versionCode: 20 }, lastHeartbeat: minutesAgo(30) }
      expect(deviceCanClaim(device, now)).toBe(true)
      expect(deviceCanClaim({ ...device, appVersionInfo: { versionCode: 18 } }, now)).toBe(false)
      expect(deviceCanClaim({ ...device, lastHeartbeat: minutesAgo(25 * 60) }, now)).toBe(false)
      expect(deviceCanClaim({ ...device, lastHeartbeat: undefined }, now)).toBe(false)
      expect(deviceCanClaim(null, now)).toBe(false)

      process.env.RECOVERY_POLL_ENABLED = 'false'
      expect(deviceCanClaim(device, now)).toBe(false)
      expect(
        deviceCanClaim({ ...device, configOverrides: { pullEnabled: true } }, now),
      ).toBe(true)
    })

    it('uses the device version when no heartbeat version is stored', () => {
      process.env.RECOVERY_POLL_ENABLED = 'true'
      expect(deviceCanClaim({ appVersionCode: 21, lastHeartbeat: minutesAgo(5) }, now)).toBe(true)
      expect(deviceCanClaim({ lastHeartbeat: minutesAgo(5) }, now)).toBe(false)
    })
  })

  describe('devices that pull', () => {
    const device = {
      appVersionInfo: { versionCode: 22 },
      lastHeartbeat: minutesAgo(10),
      installId: 'install-a',
      configOverrides: { pullEnabled: true },
    }

    it('needs the new build, an install id, a fresh heartbeat and the switch', () => {
      expect(deviceUsesPull(device, now)).toBe(true)
      expect(deviceUsesPull({ ...device, appVersionInfo: { versionCode: 21 } }, now)).toBe(false)
      expect(deviceUsesPull({ ...device, installId: undefined }, now)).toBe(false)
      expect(deviceUsesPull({ ...device, lastHeartbeat: minutesAgo(25 * 60) }, now)).toBe(false)
      expect(deviceUsesPull({ ...device, configOverrides: {} }, now)).toBe(false)
    })
  })

  it('holds a claimed row for at least 30 minutes, longer for a slow phone', () => {
    expect(claimLeaseMs(25, 0)).toBe(30 * 60_000)
    expect(claimLeaseMs(25, 120)).toBe(25 * 120_000 + 10 * 60_000)
  })
})
