import { Types } from 'mongoose'
import {
  APP_SETTINGS,
  AppNotice,
  SETTING_KEYS,
  setPlatformValues,
} from './app-settings'
import {
  DeviceFacts,
  NoticeSettings,
  UNSUPPORTED_NOTICE_TEXT,
  chooseNotice,
  deviceConfigFor,
  deviceFacts,
  downloadUrl,
  fleetDeviceConfig,
  inUpdateGroup,
  rolloutBucket,
} from './device-config'

// Device ids and their buckets, worked out once with sha1
const BUCKET_1 = '6573a1b2c3d4e5f6a7b8c90f'
const BUCKET_9 = '6573a1b2c3d4e5f6a7b8c932'
const BUCKET_50 = '6573a1b2c3d4e5f6a7b8c914'
const BUCKET_99 = '6573a1b2c3d4e5f6a7b8c923'

const NOW = new Date('2026-11-12T12:00:00Z')

function phone(
  id: string,
  versionCode?: number,
  versionName?: string,
  configOverrides?: Record<string, unknown>,
) {
  return {
    _id: new Types.ObjectId(id),
    appVersionInfo:
      versionCode === undefined ? undefined : { versionCode, versionName },
    configOverrides,
  }
}

describe('device config', () => {
  const env = { ...process.env }

  beforeEach(() => {
    for (const key of SETTING_KEYS) delete process.env[APP_SETTINGS[key].env]
    setPlatformValues({})
  })

  afterEach(() => {
    process.env = { ...env }
    setPlatformValues({})
  })

  it("sends today's keys, the new keys and the tuning object when nothing is set", () => {
    expect(deviceConfigFor({})).toEqual({
      sendSchedulerV2Enabled: true,
      recoveryPollEnabled: false,
      updateNotificationsEnabled: false,
      directUploadEnabled: false,
      pullEnabled: false,
      partReportsEnabled: true,
      latestVersionCode: 18,
      latestVersionName: '2.8.0',
      periodicJobMinutes: 30,
      deviceLogMaxEntries: 10000,
      analyticsEnabled: true,
      tuning: {
        claimMinGapSeconds: 30,
        directUploadRetryDelaySeconds: 30,
        sendingMarkerYoungMinutes: 5,
      },
    })
    expect(deviceConfigFor(null)).toEqual(deviceConfigFor({}))
  })

  it('reads the fleet switches from the environment', () => {
    process.env.SEND_SCHEDULER_V2_ENABLED = 'false'
    process.env.RECOVERY_POLL_ENABLED = '1'
    process.env.DIRECT_UPLOAD_ENABLED = 'true'
    process.env.LATEST_APP_VERSION_CODE = '20'
    process.env.LATEST_APP_VERSION_NAME = '2.9.0'
    process.env.PERIODIC_JOB_MINUTES = '60'
    process.env.CLAIM_MIN_GAP_SECONDS = '120'

    expect(fleetDeviceConfig()).toEqual({
      sendSchedulerV2Enabled: false,
      recoveryPollEnabled: true,
      updateNotificationsEnabled: false,
      directUploadEnabled: true,
      pullEnabled: false,
      partReportsEnabled: true,
      latestVersionCode: 20,
      latestVersionName: '2.9.0',
      periodicJobMinutes: 60,
      deviceLogMaxEntries: 10000,
      analyticsEnabled: true,
      tuning: {
        claimMinGapSeconds: 120,
        directUploadRetryDelaySeconds: 30,
        sendingMarkerYoungMinutes: 5,
      },
    })
  })

  it('keeps claiming off until the environment or a device turns it on', () => {
    expect(fleetDeviceConfig().pullEnabled).toBe(false)
    process.env.PULL_ENABLED = 'true'
    expect(fleetDeviceConfig().pullEnabled).toBe(true)
    delete process.env.PULL_ENABLED
    expect(
      deviceConfigFor({ configOverrides: { pullEnabled: true } }).pullEnabled,
    ).toBe(true)
  })

  it('keeps direct upload off unless the environment or one device turns it on', () => {
    expect(deviceConfigFor({}).directUploadEnabled).toBe(false)
    expect(
      deviceConfigFor({ configOverrides: { directUploadEnabled: true } })
        .directUploadEnabled,
    ).toBe(true)

    process.env.DIRECT_UPLOAD_ENABLED = 'true'
    expect(deviceConfigFor({}).directUploadEnabled).toBe(true)
    expect(
      deviceConfigFor({ configOverrides: { directUploadEnabled: false } })
        .directUploadEnabled,
    ).toBe(false)
  })

  it('turns part reports on unless the environment or a device turns them off', () => {
    expect(deviceConfigFor({}).partReportsEnabled).toBe(true)
    expect(
      deviceConfigFor({ configOverrides: { partReportsEnabled: false } })
        .partReportsEnabled,
    ).toBe(false)

    process.env.PART_REPORTS_ENABLED = 'false'
    expect(deviceConfigFor({}).partReportsEnabled).toBe(false)
    expect(
      deviceConfigFor({ configOverrides: { partReportsEnabled: true } })
        .partReportsEnabled,
    ).toBe(true)
  })

  it('never sends a server-only setting to the phone', () => {
    process.env.CARRIER_VERDICT_ENABLED = 'true'
    process.env.UPDATE_ROLLOUT_PERCENT = '10'
    setPlatformValues({
      multipartFailureFinalEnabled: false,
      partReportsStoreEnabled: false,
      minSupportedVersionCode: 5,
    })
    const config = deviceConfigFor({
      configOverrides: {
        carrierVerdictEnabled: true,
        multipartFailureFinalEnabled: false,
        partReportsStoreEnabled: false,
        updateRolloutPercent: 50,
        minSupportedVersionCode: 6,
      },
    })

    const serverKeys = SETTING_KEYS.filter(
      (key) => APP_SETTINGS[key].target === 'server',
    )
    expect(serverKeys).toEqual([
      'carrierVerdictEnabled',
      'multipartFailureFinalEnabled',
      'partReportsStoreEnabled',
      'updateRolloutPercent',
      'minSupportedVersionCode',
      'deviceRouteThrottleEnabled',
    ])
    for (const key of serverKeys) {
      expect(config).not.toHaveProperty(key)
      expect(config.tuning).not.toHaveProperty(key)
    }
    expect(config).toEqual(fleetDeviceConfig())
  })

  it('nests the three timings under tuning only', () => {
    const config = deviceConfigFor({
      configOverrides: {
        claimMinGapSeconds: 60,
        sendingMarkerYoungMinutes: 10,
      },
    })

    expect(config.tuning).toEqual({
      claimMinGapSeconds: 60,
      directUploadRetryDelaySeconds: 30,
      sendingMarkerYoungMinutes: 10,
    })
    expect(config).not.toHaveProperty('claimMinGapSeconds')
    expect(config).not.toHaveProperty('directUploadRetryDelaySeconds')
    expect(config).not.toHaveProperty('sendingMarkerYoungMinutes')
  })

  it('takes platform document values over the environment', () => {
    process.env.PERIODIC_JOB_MINUTES = '60'
    setPlatformValues({
      periodicJobMinutes: 90,
      directUploadRetryDelaySeconds: 120,
    })

    const config = deviceConfigFor({})
    expect(config.periodicJobMinutes).toBe(90)
    expect(config.tuning.directUploadRetryDelaySeconds).toBe(120)
  })

  it('ignores overrides of the wrong type', () => {
    const config = deviceConfigFor({
      configOverrides: { latestVersionCode: 'twenty' },
    })

    expect(config.latestVersionCode).toBe(fleetDeviceConfig().latestVersionCode)
  })

  it('never sends a fraction where the app reads a whole number', () => {
    const config = deviceConfigFor({
      configOverrides: { latestVersionCode: 22.5, periodicJobMinutes: 30.5 },
    })

    expect(config.latestVersionCode).toBe(18)
    expect(config.periodicJobMinutes).toBe(30)
  })

  describe('update group', () => {
    it('gives each device id a fixed bucket', () => {
      expect(rolloutBucket(BUCKET_1)).toBe(1)
      expect(rolloutBucket(BUCKET_9)).toBe(9)
      expect(rolloutBucket(BUCKET_50)).toBe(50)
      expect(rolloutBucket(BUCKET_99)).toBe(99)
      expect(deviceFacts(phone(BUCKET_50)).deviceId).toBe(BUCKET_50)
    })

    it.each([
      [0, [false, false, false, false]],
      [10, [true, true, false, false]],
      [50, [true, true, false, false]],
      [51, [true, true, true, false]],
      [100, [true, true, true, true]],
    ])('at %p percent', (percent, expected) => {
      expect(
        [BUCKET_1, BUCKET_9, BUCKET_50, BUCKET_99].map((id) =>
          inUpdateGroup(id, percent),
        ),
      ).toEqual(expected)
    })

    it('only adds devices as the percent goes up', () => {
      for (let i = 0; i < 300; i++) {
        const id = (0x6573a1b2 + i * 7919).toString(16).padStart(8, '0') + 'c3d4e5f6a7b8c9d0'
        let inside = false
        for (let percent = 0; percent <= 100; percent++) {
          const now = inUpdateGroup(id, percent)
          if (inside) expect(now).toBe(true)
          inside = now
        }
        expect(inside).toBe(true)
      }
    })

    it('holds a device without an id out unless the percent is 100', () => {
      expect(inUpdateGroup(undefined, 99)).toBe(false)
      expect(inUpdateGroup(undefined, 100)).toBe(true)
    })
  })

  describe('staged update prompt', () => {
    beforeEach(() => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      process.env.LATEST_APP_VERSION_NAME = '2.10.0'
    })

    // What the reply carried before the update group existed
    const releasedToday = {
      sendSchedulerV2Enabled: true,
      recoveryPollEnabled: false,
      updateNotificationsEnabled: false,
      latestVersionCode: 22,
      latestVersionName: '2.10.0',
    }

    const updateNotice = {
      id: 'update-22-2026-46',
      level: 'info',
      text: 'textbee 2.10.0 is available.',
      actionLabel: 'Update',
      actionUrl: 'https://textbee.dev/download?currentVersion=2.9.0(21)',
      dismissible: true,
    }

    it.each([
      ['below the latest build', 21, updateNotice],
      ['at the latest build', 22, undefined],
      ['with an unknown build', undefined, undefined],
      ['with build 0', 0, undefined],
    ])('changes no key at the default 100 percent for a device %s', (_, build, expected) => {
      for (const id of [BUCKET_1, BUCKET_50, BUCKET_99]) {
        const config = deviceConfigFor(phone(id, build, '2.9.0'), NOW)
        const { notice, ...rest } = config
        expect(rest).toEqual(fleetDeviceConfig())
        expect(rest).toMatchObject(releasedToday)
        expect(notice).toEqual(expected)
      }
    })

    it('takes a platform percent of 0 over an env percent of 100', () => {
      process.env.UPDATE_ROLLOUT_PERCENT = '100'
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).latestVersionCode).toBe(22)
      setPlatformValues({ updateRolloutPercent: 0 })
      const config = deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW)
      expect(config.latestVersionCode).toBe(21)
      expect(config).not.toHaveProperty('notice')
    })

    it('uses the newer of the two stored builds', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      process.env.LATEST_APP_VERSION_CODE = '23'
      process.env.LATEST_APP_VERSION_NAME = '2.11.0'
      const registeredNewer = {
        _id: new Types.ObjectId(BUCKET_50),
        appVersionCode: 22,
        appVersionName: '2.10.0',
        appVersionInfo: { versionCode: 21, versionName: '2.9.0' },
      }
      const config = deviceConfigFor(registeredNewer, NOW)
      expect(config.latestVersionCode).toBe(22)
      expect(config.latestVersionName).toBe('2.10.0')

      const heartbeatNewer = {
        ...registeredNewer,
        appVersionCode: 20,
        appVersionName: '2.8.1',
      }
      const other = deviceConfigFor(heartbeatNewer, NOW)
      expect(other.latestVersionCode).toBe(21)
      expect(other.latestVersionName).toBe('2.9.0')
    })

    it('keeps the resolved name when the own name is unsafe or too long', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      for (const name of ['2.9.0\u202e', '2.9.0\u200b', 'x'.repeat(33), '2.9.0\ud800']) {
        const config = deviceConfigFor(phone(BUCKET_50, 21, name), NOW)
        expect(config.latestVersionCode).toBe(21)
        expect(config.latestVersionName).toBe('2.10.0')
      }
      const longest = 'x'.repeat(32)
      expect(deviceConfigFor(phone(BUCKET_50, 21, longest), NOW).latestVersionName).toBe(longest)
    })

    it('tells a device outside the group its own build', () => {
      setPlatformValues({ updateRolloutPercent: 10 })
      const outside = deviceConfigFor(phone(BUCKET_50, 21, '2.9.0'), NOW)
      expect(outside.latestVersionCode).toBe(21)
      expect(outside.latestVersionName).toBe('2.9.0')
      expect(outside).not.toHaveProperty('notice')

      const inside = deviceConfigFor(phone(BUCKET_9, 21, '2.9.0'), NOW)
      expect(inside.latestVersionCode).toBe(22)
      expect(inside.latestVersionName).toBe('2.10.0')
      expect(inside.notice?.id).toBe('update-22-2026-46')
    })

    it('tells nobody at 0 percent', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      for (const id of [BUCKET_1, BUCKET_9, BUCKET_50, BUCKET_99]) {
        const config = deviceConfigFor(phone(id, 20, '2.8.1'), NOW)
        expect(config.latestVersionCode).toBe(20)
        expect(config.latestVersionName).toBe('2.8.1')
        expect(config).not.toHaveProperty('notice')
      }
    })

    it('leaves both keys as resolved when the build is unknown', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      for (const device of [phone(BUCKET_50), phone(BUCKET_50, 0, '2.9.0'), {}, null]) {
        const config = deviceConfigFor(device, NOW)
        expect(config.latestVersionCode).toBe(22)
        expect(config.latestVersionName).toBe('2.10.0')
        expect(config).not.toHaveProperty('notice')
      }
    })

    it('leaves a device at or above the latest build alone', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      for (const build of [22, 23]) {
        const config = deviceConfigFor(phone(BUCKET_50, build, 'x'), NOW)
        expect(config.latestVersionCode).toBe(22)
        expect(config.latestVersionName).toBe('2.10.0')
      }
    })

    it('keeps the resolved name when the device sent no name', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      const config = deviceConfigFor(phone(BUCKET_50, 21), NOW)
      expect(config.latestVersionCode).toBe(21)
      expect(config.latestVersionName).toBe('2.10.0')
    })

    it('never replaces a device override of the latest version', () => {
      setPlatformValues({ updateRolloutPercent: 0 })
      const code = deviceConfigFor(
        phone(BUCKET_50, 21, '2.9.0', { latestVersionCode: 23 }),
        NOW,
      )
      expect(code.latestVersionCode).toBe(23)
      expect(code.latestVersionName).toBe('2.10.0')
      expect(code.notice?.id).toBe('update-23-2026-46')

      // A name override alone does not lift the device into the group
      const name = deviceConfigFor(
        phone(BUCKET_50, 21, '2.9.0', { latestVersionName: '2.10.0-beta' }),
        NOW,
      )
      expect(name.latestVersionCode).toBe(21)
      expect(name.latestVersionName).toBe('2.10.0-beta')
      expect(name).not.toHaveProperty('notice')

      setPlatformValues({ updateRolloutPercent: 10 })
      const inside = deviceConfigFor(
        phone(BUCKET_1, 21, '2.9.0', { latestVersionName: '2.10.0-beta' }),
        NOW,
      )
      expect(inside.latestVersionCode).toBe(22)
      expect(inside.latestVersionName).toBe('2.10.0-beta')
      expect(inside.notice?.text).toBe('textbee 2.10.0-beta is available.')

      const invalid = deviceConfigFor(
        phone(BUCKET_50, 21, '2.9.0', { latestVersionCode: 'twenty' }),
        NOW,
      )
      expect(invalid.latestVersionCode).toBe(21)
    })

    it('reads the build the heartbeat stored before the one from registration', () => {
      const device = {
        _id: new Types.ObjectId(BUCKET_50),
        appVersionCode: 18,
        appVersionName: '2.8.0',
        appVersionInfo: { versionCode: 21, versionName: '2.9.0' },
      }
      expect(deviceFacts(device)).toEqual({
        deviceId: BUCKET_50,
        versionCode: 21,
        versionName: '2.9.0',
      })
      expect(
        deviceFacts({ ...device, appVersionInfo: { versionCode: 21 } }).versionName,
      ).toBeUndefined()
      expect(
        deviceFacts({ ...device, appVersionCode: 21, appVersionInfo: { versionCode: 21 } })
          .versionName,
      ).toBe('2.8.0')
      expect(deviceFacts({ ...device, appVersionInfo: undefined })).toEqual({
        deviceId: BUCKET_50,
        versionCode: 18,
        versionName: '2.8.0',
      })
      expect(deviceFacts(null)).toEqual({
        deviceId: undefined,
        versionCode: 0,
        versionName: undefined,
      })
      expect(
        deviceFacts({ ...device, appVersionCode: 22, appVersionName: '2.10.0' }),
      ).toEqual({ deviceId: BUCKET_50, versionCode: 22, versionName: '2.10.0' })
    })
  })

  describe('released update notification', () => {
    // UpdateNotifier.shouldNotify in builds 20 and 21
    function notifications(build: number, id: string): boolean[] {
      let lastNotified = 0
      return [0, 10, 100, 10].map((percent) => {
        setPlatformValues({ updateRolloutPercent: percent })
        const reply = JSON.parse(JSON.stringify(deviceConfigFor(phone(id, build, '2.9.0'), NOW)))
        const notify =
          reply.updateNotificationsEnabled &&
          reply.latestVersionCode > build &&
          reply.latestVersionCode !== lastNotified
        if (notify) lastNotified = reply.latestVersionCode
        expect(notify && !inUpdateGroup(id, percent)).toBe(false)
        return notify
      })
    }

    beforeEach(() => {
      process.env.UPDATE_NOTIFICATIONS_ENABLED = 'true'
      process.env.LATEST_APP_VERSION_CODE = '22'
      process.env.LATEST_APP_VERSION_NAME = '2.10.0'
    })

    it.each([20, 21])('notifies build %p at most once, and never outside the group', (build) => {
      expect(notifications(build, BUCKET_1)).toEqual([false, true, false, false])
      expect(notifications(build, BUCKET_50)).toEqual([false, false, true, false])
    })
  })

  describe('notice', () => {
    const facts: DeviceFacts = { deviceId: BUCKET_1, versionCode: 21, versionName: '2.9.0' }
    const link = 'https://textbee.dev/download?currentVersion=2.9.0(21)'
    const settings: NoticeSettings = {
      latestVersionCode: 22,
      latestVersionName: '2.10.0',
      minSupportedVersionCode: 0,
      notice: null,
    }
    const set: AppNotice = {
      id: 'set-notice',
      level: 'info',
      text: 'A notice that someone set.',
      dismissible: true,
    }
    const unsupported: AppNotice = {
      id: 'unsupported-22',
      level: 'warning',
      text: UNSUPPORTED_NOTICE_TEXT,
      actionLabel: 'Update',
      actionUrl: link,
      dismissible: false,
    }
    const update: AppNotice = {
      id: 'update-22-2026-46',
      level: 'info',
      text: 'textbee 2.10.0 is available.',
      actionLabel: 'Update',
      actionUrl: link,
      dismissible: true,
    }

    it('picks the unsupported notice first', () => {
      expect(
        chooseNotice(facts, { ...settings, minSupportedVersionCode: 22, notice: set }, NOW),
      ).toEqual(unsupported)
    })

    it('then a set notice, before the update notice', () => {
      expect(chooseNotice(facts, { ...settings, notice: set }, NOW)).toEqual(set)
    })

    it('then the update notice', () => {
      expect(chooseNotice(facts, settings, NOW)).toEqual(update)
    })

    it('else none', () => {
      expect(chooseNotice({ ...facts, versionCode: 22 }, settings, NOW)).toBeUndefined()
      expect(chooseNotice({ versionCode: 0 }, settings, NOW)).toBeUndefined()
    })

    it('needs a known build below the minimum for the unsupported notice', () => {
      const min = { ...settings, minSupportedVersionCode: 21 }
      expect(chooseNotice(facts, min, NOW)?.id).toBe('update-22-2026-46')
      expect(chooseNotice({ versionCode: 0 }, { ...min, notice: set }, NOW)).toEqual(set)
    })

    it('takes a device notice over the platform one and the env one', () => {
      process.env.APP_NOTICE_JSON = JSON.stringify({ ...set, id: 'env' })
      setPlatformValues({ notice: { ...set, id: 'platform' } })
      const device = phone(BUCKET_1, 21, '2.9.0', { notice: { ...set, id: 'device' } })
      expect(deviceConfigFor(device, NOW).notice?.id).toBe('device')
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice?.id).toBe('platform')
      setPlatformValues({})
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice?.id).toBe('env')
    })

    it('takes the unsupported notice over a device notice, with the minimum from the device', () => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      setPlatformValues({ minSupportedVersionCode: 18 })
      const device = phone(BUCKET_1, 21, '2.9.0', {
        notice: set,
        minSupportedVersionCode: 22,
      })
      expect(deviceConfigFor(device, NOW).notice).toEqual(unsupported)
      expect(deviceConfigFor(phone(BUCKET_1, 17, '2.7.0'), NOW).notice).toMatchObject({
        id: 'unsupported-18',
        actionUrl: 'https://textbee.dev/download?currentVersion=2.7.0(17)',
        dismissible: false,
      })
    })

    it('ignores a minimum above the latest version', () => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      process.env.LATEST_APP_VERSION_NAME = '2.10.0'
      setPlatformValues({ minSupportedVersionCode: 23 })
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice).toEqual(update)
      expect(deviceConfigFor(phone(BUCKET_1, 22, '2.10.0'), NOW)).not.toHaveProperty('notice')

      setPlatformValues({ minSupportedVersionCode: 22 })
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice).toEqual(unsupported)

      // Compared with the latest version before the update group rule
      setPlatformValues({ minSupportedVersionCode: 22, updateRolloutPercent: 0 })
      const outside = deviceConfigFor(phone(BUCKET_50, 21, '2.9.0'), NOW)
      expect(outside.latestVersionCode).toBe(21)
      expect(outside.notice).toEqual(unsupported)

      const overridden = phone(BUCKET_1, 21, '2.9.0', { latestVersionCode: 21 })
      expect(deviceConfigFor(overridden, NOW)).not.toHaveProperty('notice')
    })

    it('leaves an unsafe version name out of the update notice', () => {
      for (const latestVersionName of ['2.10.0\u202e', '2.10.0\u200b']) {
        expect(chooseNotice(facts, { ...settings, latestVersionName }, NOW)?.text).toBe(
          'A new version of textbee is available.',
        )
      }
      process.env.LATEST_APP_VERSION_CODE = '22'
      setPlatformValues({ latestVersionName: '2.10.0\u2066' })
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice?.text).toBe(
        'A new version of textbee is available.',
      )
    })

    it('takes a platform notice over the update notice', () => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      setPlatformValues({ notice: set })
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice).toEqual(set)
    })

    it('sends the update notice with the version the device is told', () => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      process.env.LATEST_APP_VERSION_NAME = '2.10.0'
      expect(deviceConfigFor(phone(BUCKET_1, 21, '2.9.0'), NOW).notice).toEqual(update)
    })

    it('changes the update notice id with the ISO week, not within it', () => {
      const id = (iso: string) => chooseNotice(facts, settings, new Date(iso))?.id
      expect(id('2026-11-09T00:00:00Z')).toBe('update-22-2026-46')
      expect(id('2026-11-15T23:59:59Z')).toBe('update-22-2026-46')
      expect(id('2026-11-16T00:00:00Z')).toBe('update-22-2026-47')
      expect(id('2026-01-05T00:00:00Z')).toBe('update-22-2026-02')
      expect(id('2027-01-01T00:00:00Z')).toBe('update-22-2026-53')
      expect(id('2027-01-04T00:00:00Z')).toBe('update-22-2027-01')
      expect(id('2024-12-30T00:00:00Z')).toBe('update-22-2025-01')
    })

    it('builds the download link the way the app does', () => {
      expect(downloadUrl(facts)).toBe(link)
      expect(downloadUrl({ versionCode: 22, versionName: '2.10.0 beta' })).toBe(
        'https://textbee.dev/download?currentVersion=2.10.0%20beta(22)',
      )
      expect(downloadUrl({ versionCode: 22, versionName: 'a&b=c' })).toBe(
        'https://textbee.dev/download?currentVersion=a%26b%3Dc(22)',
      )
      expect(downloadUrl({ versionCode: 0, versionName: '2.9.0' })).toBe(
        'https://textbee.dev/download',
      )
      expect(downloadUrl({ versionCode: 21 })).toBe('https://textbee.dev/download')
      expect(downloadUrl({ versionCode: 21, versionName: '\ud800' })).toBe(
        'https://textbee.dev/download',
      )
    })

    it('sends no notice key when no rule matches', () => {
      expect(deviceConfigFor(phone(BUCKET_1, 18, '2.8.0'), NOW)).not.toHaveProperty('notice')
    })
  })

  describe('reply read by builds 20 and 21', () => {
    it('keeps the five released keys and their types, and adds only unknown keys', () => {
      process.env.LATEST_APP_VERSION_CODE = '22'
      process.env.LATEST_APP_VERSION_NAME = '2.10.0'
      process.env.UPDATE_ROLLOUT_PERCENT = '10'
      process.env.MIN_SUPPORTED_APP_VERSION_CODE = '18'
      setPlatformValues({ notice: { id: 'p', level: 'info', text: 'Hello', dismissible: true } })

      for (const id of [BUCKET_1, BUCKET_50]) {
        const reply = JSON.parse(JSON.stringify(deviceConfigFor(phone(id, 21, '2.9.0'), NOW)))
        expect(typeof reply.sendSchedulerV2Enabled).toBe('boolean')
        expect(typeof reply.recoveryPollEnabled).toBe('boolean')
        expect(typeof reply.updateNotificationsEnabled).toBe('boolean')
        expect(Number.isInteger(reply.latestVersionCode)).toBe(true)
        expect(typeof reply.latestVersionName).toBe('string')
        expect(Object.keys(reply).sort()).toEqual(
          [
            'analyticsEnabled',
            'deviceLogMaxEntries',
            'directUploadEnabled',
            'latestVersionCode',
            'latestVersionName',
            'notice',
            'partReportsEnabled',
            'periodicJobMinutes',
            'pullEnabled',
            'recoveryPollEnabled',
            'sendSchedulerV2Enabled',
            'tuning',
            'updateNotificationsEnabled',
          ],
        )
        expect(reply).not.toHaveProperty('updateRolloutPercent')
        expect(reply).not.toHaveProperty('minSupportedVersionCode')
        expect(reply.notice).toEqual({ id: 'p', level: 'info', text: 'Hello', dismissible: true })
      }
    })
  })
})
