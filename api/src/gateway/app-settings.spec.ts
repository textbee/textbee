import {
  APP_SETTINGS,
  SETTING_KEYS,
  SettingKey,
  droppedPlatformKeys,
  resolveSetting,
  setPlatformValues,
} from './app-settings'

describe('app settings', () => {
  const env = { ...process.env }

  beforeEach(() => {
    for (const key of SETTING_KEYS) delete process.env[APP_SETTINGS[key].env]
    setPlatformValues({})
  })

  afterEach(() => {
    process.env = { ...env }
    setPlatformValues({})
  })

  // One setting of each type, with a valid value for every level
  const cases: Array<{
    key: SettingKey
    env: string
    envRaw: string
    builtIn: unknown
    envValue: unknown
    platform: unknown
    override: unknown
  }> = [
    {
      key: 'recoveryPollEnabled',
      env: 'RECOVERY_POLL_ENABLED',
      envRaw: 'true',
      builtIn: false,
      envValue: true,
      platform: false,
      override: true,
    },
    {
      key: 'periodicJobMinutes',
      env: 'PERIODIC_JOB_MINUTES',
      envRaw: '45',
      builtIn: 30,
      envValue: 45,
      platform: 60,
      override: 120,
    },
    {
      key: 'latestVersionName',
      env: 'LATEST_APP_VERSION_NAME',
      envRaw: '2.9.0',
      builtIn: '2.8.0',
      envValue: '2.9.0',
      platform: '2.10.0',
      override: '2.10.1',
    },
  ]

  describe.each(cases)(
    '$key',
    ({ key, env, envRaw, builtIn, envValue, platform, override }) => {
      it('uses the built-in default when nothing is set', () => {
        expect(resolveSetting(key, {})).toBe(builtIn)
      })

      it('takes the env var over the built-in default', () => {
        process.env[env] = envRaw
        expect(resolveSetting(key, {})).toBe(envValue)
      })

      it('takes the platform document over the env var', () => {
        process.env[env] = envRaw
        setPlatformValues({ [key]: platform })
        expect(resolveSetting(key, {})).toBe(platform)
      })

      it('takes the device override over the platform document', () => {
        process.env[env] = envRaw
        setPlatformValues({ [key]: platform })
        expect(resolveSetting(key, { [key]: override })).toBe(override)
      })
    },
  )

  describe('bad values', () => {
    const bad: Array<[SettingKey, unknown]> = [
      ['recoveryPollEnabled', 'true'],
      ['recoveryPollEnabled', 1],
      ['recoveryPollEnabled', { value: true }],
      ['periodicJobMinutes', '60'],
      ['periodicJobMinutes', 60.5],
      ['periodicJobMinutes', 14],
      ['periodicJobMinutes', 241],
      ['periodicJobMinutes', { value: 60 }],
      ['periodicJobMinutes', Number.NaN],
      ['latestVersionCode', 22.5],
      ['latestVersionCode', 0],
      ['latestVersionCode', 2 ** 31],
      ['latestVersionName', 210],
      ['latestVersionName', ''],
      ['latestVersionName', { name: '2.10.0' }],
      ['claimMinGapSeconds', 9],
      ['claimMinGapSeconds', 301],
      ['directUploadRetryDelaySeconds', 29],
      ['directUploadRetryDelaySeconds', 3601],
      ['sendingMarkerYoungMinutes', 2],
      ['sendingMarkerYoungMinutes', 61],
      ['deviceLogMaxEntries', 20001],
      ['periodicJobMinutes', Infinity],
      ['periodicJobMinutes', -0],
      ['latestVersionCode', -0],
      ['latestVersionCode', -Infinity],
      ['latestVersionName', 'x'.repeat(33)],
    ]

    // A valid value that differs from the built-in default
    function goodValue(key: SettingKey): unknown {
      const spec = APP_SETTINGS[key]
      if (spec.type === 'boolean') return !spec.default
      if (spec.type === 'string') return '2.10.0'
      return (spec as { max: number }).max
    }

    it.each(bad)(
      'drops %s = %p in an override and falls to the platform value',
      (key, value) => {
        const platform = goodValue(key)
        setPlatformValues({ [key]: platform })
        expect(resolveSetting(key, { [key]: value })).toBe(platform)
      },
    )

    it.each(bad)(
      'drops %s = %p in the platform document and falls to the env var',
      (key, value) => {
        const spec = APP_SETTINGS[key]
        const [raw, parsed] =
          spec.type === 'boolean'
            ? [String(!spec.default), !spec.default]
            : spec.type === 'string'
              ? ['2.9.0', '2.9.0']
              : [
                  String((spec as { max: number }).max),
                  (spec as { max: number }).max,
                ]
        process.env[spec.env] = raw
        setPlatformValues({ [key]: value })
        expect(resolveSetting(key, {})).toBe(parsed)
      },
    )

    it.each([
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', '10', 30],
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', '500', 30],
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', 'abc', 30],
      ['LATEST_APP_VERSION_CODE', 'latestVersionCode', '-3', 18],
      ['LATEST_APP_VERSION_CODE', 'latestVersionCode', '0', 18],
      ['LATEST_APP_VERSION_NAME', 'latestVersionName', '   ', '2.8.0'],
      ['DEVICE_LOG_MAX_ENTRIES', 'deviceLogMaxEntries', '100', 10000],
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', '15.9', 30],
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', '30min', 30],
      ['DEVICE_LOG_MAX_ENTRIES', 'deviceLogMaxEntries', '1e4', 10000],
      ['PERIODIC_JOB_MINUTES', 'periodicJobMinutes', 'Infinity', 30],
      ['LATEST_APP_VERSION_CODE', 'latestVersionCode', '-0', 18],
      ['LATEST_APP_VERSION_CODE', 'latestVersionCode', '20.5', 18],
      ['LATEST_APP_VERSION_NAME', 'latestVersionName', 'x'.repeat(33), '2.8.0'],
    ] as Array<[string, SettingKey, string, unknown]>)(
      'drops %s = %p from the env and uses the built-in default',
      (envKey, key, raw, builtIn) => {
        process.env[envKey] = raw
        expect(resolveSetting(key, {})).toBe(builtIn)
      },
    )

    it.each([
      ['claimMinGapSeconds', 10, 300],
      ['directUploadRetryDelaySeconds', 30, 3600],
      ['sendingMarkerYoungMinutes', 3, 60],
    ] as Array<[SettingKey, number, number]>)(
      'accepts %s at both ends of its range',
      (key, min, max) => {
        expect(resolveSetting(key, { [key]: min })).toBe(min)
        expect(resolveSetting(key, { [key]: max })).toBe(max)
      },
    )

    it('keeps spaces around an env integer allowed', () => {
      process.env.PERIODIC_JOB_MINUTES = '  60 '
      expect(resolveSetting('periodicJobMinutes')).toBe(60)
    })

    it('trims latestVersionName at every level', () => {
      process.env.LATEST_APP_VERSION_NAME = ' 2.9.0 '
      expect(resolveSetting('latestVersionName')).toBe('2.9.0')
      setPlatformValues({ latestVersionName: ' 2.10.0\n' })
      expect(resolveSetting('latestVersionName')).toBe('2.10.0')
      expect(
        resolveSetting('latestVersionName', { latestVersionName: ' 2.10.1 ' }),
      ).toBe('2.10.1')
      const longest = 'x'.repeat(32)
      expect(
        resolveSetting('latestVersionName', { latestVersionName: longest }),
      ).toBe(longest)
    })

    it('reads only own keys of an override with a __proto__ key', () => {
      const parsed = JSON.parse(
        '{"__proto__": {"pullEnabled": true, "periodicJobMinutes": 60}}',
      )
      expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(
        true,
      )
      expect(resolveSetting('pullEnabled', parsed)).toBe(false)
      expect(resolveSetting('periodicJobMinutes', parsed)).toBe(30)

      const inherited = Object.create({ pullEnabled: true })
      expect(resolveSetting('pullEnabled', inherited)).toBe(false)
      setPlatformValues(Object.create({ periodicJobMinutes: 60 }))
      expect(resolveSetting('periodicJobMinutes')).toBe(30)
    })

    it('reads env booleans as before: only true and 1 are on', () => {
      process.env.APP_ANALYTICS_ENABLED = 'yes'
      expect(resolveSetting('analyticsEnabled')).toBe(false)
      process.env.APP_ANALYTICS_ENABLED = ' TRUE '
      expect(resolveSetting('analyticsEnabled')).toBe(true)
      process.env.APP_ANALYTICS_ENABLED = ''
      expect(resolveSetting('analyticsEnabled')).toBe(true)
    })

    it('ignores overrides and a platform document that are not objects', () => {
      setPlatformValues(['periodicJobMinutes', 60])
      expect(
        resolveSetting('periodicJobMinutes', 'periodicJobMinutes=60'),
      ).toBe(30)
      setPlatformValues(null)
      expect(resolveSetting('periodicJobMinutes', [60])).toBe(30)
    })
  })

  describe('keys released builds read', () => {
    // Values on main before the registry; the JSON type must never change
    const table: Array<
      [string | undefined, boolean, boolean, boolean, number, string]
    > = [
      // env value, sendSchedulerV2Enabled, recoveryPollEnabled, updateNotificationsEnabled, latestVersionCode, latestVersionName
      [undefined, true, false, false, 18, '2.8.0'],
      ['', true, false, false, 18, '2.8.0'],
      ['0', false, false, false, 18, '0'],
      ['false', false, false, false, 18, 'false'],
      ['TRUE', true, true, true, 18, 'TRUE'],
      [' 22 ', false, false, false, 22, '22'],
      ['abc', false, false, false, 18, 'abc'],
    ]

    it.each(table)(
      'env %p',
      (raw, scheduler, recovery, updates, code, name) => {
        for (const key of [
          'SEND_SCHEDULER_V2_ENABLED',
          'RECOVERY_POLL_ENABLED',
          'UPDATE_NOTIFICATIONS_ENABLED',
          'LATEST_APP_VERSION_CODE',
          'LATEST_APP_VERSION_NAME',
        ]) {
          if (raw === undefined) delete process.env[key]
          else process.env[key] = raw
        }

        const values = {
          sendSchedulerV2Enabled: resolveSetting('sendSchedulerV2Enabled'),
          recoveryPollEnabled: resolveSetting('recoveryPollEnabled'),
          updateNotificationsEnabled: resolveSetting(
            'updateNotificationsEnabled',
          ),
          latestVersionCode: resolveSetting('latestVersionCode'),
          latestVersionName: resolveSetting('latestVersionName'),
        }
        expect(values).toEqual({
          sendSchedulerV2Enabled: scheduler,
          recoveryPollEnabled: recovery,
          updateNotificationsEnabled: updates,
          latestVersionCode: code,
          latestVersionName: name,
        })
        expect(typeof values.sendSchedulerV2Enabled).toBe('boolean')
        expect(typeof values.recoveryPollEnabled).toBe('boolean')
        expect(typeof values.updateNotificationsEnabled).toBe('boolean')
        expect(Number.isInteger(values.latestVersionCode)).toBe(true)
        expect(typeof values.latestVersionName).toBe('string')
      },
    )
  })

  describe('platform document checks', () => {
    it('lists unknown and invalid keys', () => {
      expect(
        droppedPlatformKeys({
          periodicJobMinutes: 60,
          pullEnabled: 'yes',
          latestVersionCode: 22.5,
          heartbeatIntervalMinutes: 30,
        }),
      ).toEqual([
        'pullEnabled',
        'latestVersionCode',
        'heartbeatIntervalMinutes',
      ])
      expect(
        droppedPlatformKeys(JSON.parse('{"__proto__": {}, "toString": 1}')),
      ).toEqual(['__proto__', 'toString'])
      expect(droppedPlatformKeys(null)).toEqual([])
      expect(droppedPlatformKeys({})).toEqual([])
    })
  })

  describe('server switches', () => {
    it('let a device override the carrier verdict only', () => {
      setPlatformValues({
        carrierVerdictEnabled: false,
        multipartFailureFinalEnabled: true,
        partReportsStoreEnabled: true,
      })
      const overrides = {
        carrierVerdictEnabled: true,
        multipartFailureFinalEnabled: false,
        partReportsStoreEnabled: false,
      }
      expect(resolveSetting('carrierVerdictEnabled', overrides)).toBe(true)
      expect(resolveSetting('multipartFailureFinalEnabled', overrides)).toBe(
        true,
      )
      expect(resolveSetting('partReportsStoreEnabled', overrides)).toBe(true)
    })

    it('follow the platform document without a restart', () => {
      process.env.CARRIER_VERDICT_ENABLED = 'false'
      process.env.MULTIPART_FAILURE_FINAL_ENABLED = 'true'
      expect(resolveSetting('carrierVerdictEnabled')).toBe(false)
      setPlatformValues({
        carrierVerdictEnabled: true,
        multipartFailureFinalEnabled: false,
      })
      expect(resolveSetting('carrierVerdictEnabled')).toBe(true)
      expect(resolveSetting('multipartFailureFinalEnabled')).toBe(false)
    })
  })
})
