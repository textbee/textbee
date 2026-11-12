import { APP_SETTINGS, SETTING_KEYS, setPlatformValues } from './app-settings'
import { deviceConfigFor, fleetDeviceConfig } from './device-config'

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
    setPlatformValues({
      multipartFailureFinalEnabled: false,
      partReportsStoreEnabled: false,
    })
    const config = deviceConfigFor({
      configOverrides: {
        carrierVerdictEnabled: true,
        multipartFailureFinalEnabled: false,
        partReportsStoreEnabled: false,
      },
    })

    const serverKeys = SETTING_KEYS.filter(
      (key) => APP_SETTINGS[key].target === 'server',
    )
    expect(serverKeys).toEqual([
      'carrierVerdictEnabled',
      'multipartFailureFinalEnabled',
      'partReportsStoreEnabled',
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
})
