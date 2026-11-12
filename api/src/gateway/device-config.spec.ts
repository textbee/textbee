import { deviceConfigFor, fleetDeviceConfig } from './device-config'

describe('device config', () => {
  const env = { ...process.env }

  afterEach(() => {
    process.env = { ...env }
  })

  it('defaults to the new scheduler and direct upload on, the risky features off', () => {
    delete process.env.SEND_SCHEDULER_V2_ENABLED
    delete process.env.RECOVERY_POLL_ENABLED
    delete process.env.UPDATE_NOTIFICATIONS_ENABLED
    delete process.env.DIRECT_UPLOAD_ENABLED

    expect(fleetDeviceConfig()).toEqual(
      expect.objectContaining({
        sendSchedulerV2Enabled: true,
        recoveryPollEnabled: false,
        updateNotificationsEnabled: false,
        directUploadEnabled: true,
      }),
    )
  })

  it('reads the fleet switches from the environment', () => {
    process.env.SEND_SCHEDULER_V2_ENABLED = 'false'
    process.env.RECOVERY_POLL_ENABLED = '1'
    process.env.DIRECT_UPLOAD_ENABLED = 'true'
    process.env.LATEST_APP_VERSION_CODE = '20'
    process.env.LATEST_APP_VERSION_NAME = '2.9.0'

    expect(fleetDeviceConfig()).toEqual({
      sendSchedulerV2Enabled: false,
      recoveryPollEnabled: true,
      updateNotificationsEnabled: false,
      directUploadEnabled: true,
      pullEnabled: false,
      partReportsEnabled: true,
      latestVersionCode: 20,
      latestVersionName: '2.9.0',
    })
  })

  it('keeps claiming off until the environment or a device turns it on', () => {
    expect(fleetDeviceConfig().pullEnabled).toBe(false)
    process.env.PULL_ENABLED = 'true'
    expect(fleetDeviceConfig().pullEnabled).toBe(true)
    delete process.env.PULL_ENABLED
    expect(deviceConfigFor({ configOverrides: { pullEnabled: true } }).pullEnabled).toBe(true)
  })

  it('lets a device override win over the fleet default', () => {
    process.env.RECOVERY_POLL_ENABLED = 'false'

    const config = deviceConfigFor({
      configOverrides: { recoveryPollEnabled: true },
    })

    expect(config.recoveryPollEnabled).toBe(true)
    expect(config.sendSchedulerV2Enabled).toBe(true)
  })

  it('lets the environment or one device turn direct upload off', () => {
    delete process.env.DIRECT_UPLOAD_ENABLED

    expect(deviceConfigFor({}).directUploadEnabled).toBe(true)
    expect(
      deviceConfigFor({ configOverrides: { directUploadEnabled: false } })
        .directUploadEnabled,
    ).toBe(false)

    process.env.DIRECT_UPLOAD_ENABLED = 'false'
    expect(deviceConfigFor({}).directUploadEnabled).toBe(false)
    expect(
      deviceConfigFor({ configOverrides: { directUploadEnabled: true } })
        .directUploadEnabled,
    ).toBe(true)
  })

  it('turns part reports on unless the environment or a device turns them off', () => {
    delete process.env.PART_REPORTS_ENABLED
    expect(deviceConfigFor({}).partReportsEnabled).toBe(true)
    expect(
      deviceConfigFor({ configOverrides: { partReportsEnabled: false } }).partReportsEnabled,
    ).toBe(false)

    process.env.PART_REPORTS_ENABLED = 'false'
    expect(deviceConfigFor({}).partReportsEnabled).toBe(false)
    expect(
      deviceConfigFor({ configOverrides: { partReportsEnabled: true } }).partReportsEnabled,
    ).toBe(true)
  })

  it('never sends the server-only carrier verdict override to the phone', () => {
    const config = deviceConfigFor({
      configOverrides: { carrierVerdictEnabled: true } as any,
    })

    expect(config).not.toHaveProperty('carrierVerdictEnabled')
    expect(config).toEqual(fleetDeviceConfig())
  })

  it('ignores overrides of the wrong type', () => {
    const config = deviceConfigFor({
      configOverrides: { latestVersionCode: 'twenty' as any },
    })

    expect(config.latestVersionCode).toBe(fleetDeviceConfig().latestVersionCode)
  })
})
