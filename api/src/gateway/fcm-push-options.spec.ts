import {
  DEFAULT_FCM_HEARTBEAT_TTL_SECONDS,
  DEFAULT_FCM_SMS_TTL_SECONDS,
  FCM_MAX_TTL_SECONDS,
  heartbeatAndroidConfig,
  pushData,
  smsAndroidConfig,
} from './fcm-push-options'

describe('fcm-push-options', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('smsAndroidConfig', () => {
    it('sets a 72 hour ttl in milliseconds by default', () => {
      expect(smsAndroidConfig()).toEqual({
        priority: 'high',
        ttl: DEFAULT_FCM_SMS_TTL_SECONDS * 1000,
      })
      expect(DEFAULT_FCM_SMS_TTL_SECONDS).toBe(259200)
    })

    it('reads FCM_SMS_TTL_SECONDS from the environment', () => {
      process.env.FCM_SMS_TTL_SECONDS = '3600'

      expect(smsAndroidConfig().ttl).toBe(3_600_000)
    })

    it('ignores a non-positive or malformed env value', () => {
      process.env.FCM_SMS_TTL_SECONDS = 'soon'
      expect(smsAndroidConfig().ttl).toBe(DEFAULT_FCM_SMS_TTL_SECONDS * 1000)

      process.env.FCM_SMS_TTL_SECONDS = '0'
      expect(smsAndroidConfig().ttl).toBe(DEFAULT_FCM_SMS_TTL_SECONDS * 1000)
    })

    it('never expires before scheduledAt plus the base ttl', () => {
      const now = Date.parse('2026-08-22T10:00:00Z')
      const scheduledAt = '2026-08-23T10:00:00Z'

      const config = smsAndroidConfig(scheduledAt, now)

      const expiresAt = now + (config.ttl as number)
      expect(expiresAt).toBe(
        Date.parse(scheduledAt) + DEFAULT_FCM_SMS_TTL_SECONDS * 1000,
      )
    })

    it('uses the base ttl when scheduledAt is in the past or invalid', () => {
      const now = Date.parse('2026-08-22T10:00:00Z')

      expect(smsAndroidConfig('2026-08-21T10:00:00Z', now).ttl).toBe(
        DEFAULT_FCM_SMS_TTL_SECONDS * 1000,
      )
      expect(smsAndroidConfig('not a date', now).ttl).toBe(
        DEFAULT_FCM_SMS_TTL_SECONDS * 1000,
      )
    })

    it('does not set a collapse key on sms pushes', () => {
      expect(smsAndroidConfig()).not.toHaveProperty('collapseKey')
    })

    it('clamps a configured ttl to the FCM maximum of 28 days', () => {
      process.env.FCM_SMS_TTL_SECONDS = String(FCM_MAX_TTL_SECONDS * 2)

      expect(smsAndroidConfig().ttl).toBe(FCM_MAX_TTL_SECONDS * 1000)
      expect(FCM_MAX_TTL_SECONDS).toBe(2_419_200)
    })

    it('clamps a far-future scheduled ttl to the FCM maximum', () => {
      const now = Date.parse('2026-08-22T10:00:00Z')
      const scheduledAt = new Date(now + 30 * 24 * 3600 * 1000)

      expect(smsAndroidConfig(scheduledAt, now).ttl).toBe(
        FCM_MAX_TTL_SECONDS * 1000,
      )
    })
  })

  describe('heartbeatAndroidConfig', () => {
    it('collapses probes and bounds them to 30 minutes by default', () => {
      expect(heartbeatAndroidConfig()).toEqual({
        priority: 'high',
        ttl: DEFAULT_FCM_HEARTBEAT_TTL_SECONDS * 1000,
        collapseKey: 'heartbeat_check',
      })
      expect(DEFAULT_FCM_HEARTBEAT_TTL_SECONDS).toBe(1800)
    })

    it('names the target device in the push data', () => {
      expect(pushData({ _id: 'device123' }, { type: 'heartbeat_check' })).toEqual({
        type: 'heartbeat_check',
        deviceId: 'device123',
      })
    })

    it('reads FCM_HEARTBEAT_TTL_SECONDS from the environment', () => {
      process.env.FCM_HEARTBEAT_TTL_SECONDS = '600'

      expect(heartbeatAndroidConfig().ttl).toBe(600_000)
    })

    it('clamps the heartbeat ttl to the FCM maximum', () => {
      process.env.FCM_HEARTBEAT_TTL_SECONDS = String(FCM_MAX_TTL_SECONDS + 1)

      expect(heartbeatAndroidConfig().ttl).toBe(FCM_MAX_TTL_SECONDS * 1000)
    })
  })
})
