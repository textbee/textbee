import {
  APP_SETTINGS,
  SETTING_KEYS,
  SettingKey,
  droppedPlatformKeys,
  envSnapshot,
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

  describe('update rollout and minimum build', () => {
    it('use the built-in defaults when nothing is set', () => {
      expect(resolveSetting('updateRolloutPercent')).toBe(100)
      expect(resolveSetting('minSupportedVersionCode')).toBe(0)
    })

    it('read the env and the platform document, with range checks', () => {
      process.env.UPDATE_ROLLOUT_PERCENT = '10'
      process.env.MIN_SUPPORTED_APP_VERSION_CODE = '18'
      expect(resolveSetting('updateRolloutPercent')).toBe(10)
      expect(resolveSetting('minSupportedVersionCode')).toBe(18)

      setPlatformValues({ updateRolloutPercent: 0, minSupportedVersionCode: 20 })
      expect(resolveSetting('updateRolloutPercent')).toBe(0)
      expect(resolveSetting('minSupportedVersionCode')).toBe(20)

      setPlatformValues({ updateRolloutPercent: 101, minSupportedVersionCode: -1 })
      expect(resolveSetting('updateRolloutPercent')).toBe(10)
      expect(resolveSetting('minSupportedVersionCode')).toBe(18)

      process.env.UPDATE_ROLLOUT_PERCENT = '50.5'
      process.env.MIN_SUPPORTED_APP_VERSION_CODE = 'abc'
      expect(resolveSetting('updateRolloutPercent')).toBe(100)
      expect(resolveSetting('minSupportedVersionCode')).toBe(0)
    })

    it('let a device override the minimum build but not the percent', () => {
      const overrides = { updateRolloutPercent: 0, minSupportedVersionCode: 21 }
      expect(resolveSetting('updateRolloutPercent', overrides)).toBe(100)
      expect(resolveSetting('minSupportedVersionCode', overrides)).toBe(21)
    })
  })

  describe('notice', () => {
    const good = {
      id: 'maintenance-2026.11_a',
      level: 'warning',
      text: 'Sending is slow today.',
      actionLabel: 'Details',
      actionUrl: 'https://textbee.dev/status?from=app#today',
      dismissible: true,
    }
    const platform = { ...good, id: 'platform', level: 'info' }
    const envNotice = { ...good, id: 'env', actionLabel: undefined, actionUrl: undefined }
    const { actionLabel, actionUrl, ...noAction } = good

    it('is absent when nothing is set', () => {
      expect(resolveSetting('notice')).toBeNull()
      expect(resolveSetting('notice', {})).toBeNull()
    })

    it('takes the device, then the platform document, then the env', () => {
      process.env.APP_NOTICE_JSON = JSON.stringify(envNotice)
      expect(resolveSetting('notice')).toEqual({ ...noAction, id: 'env' })
      setPlatformValues({ notice: platform })
      expect(resolveSetting('notice')).toEqual(platform)
      expect(resolveSetting('notice', { notice: good })).toEqual(good)
    })

    it('keeps only the six fields, trims the texts and leaves out a missing action', () => {
      expect(
        resolveSetting('notice', {
          notice: { ...good, text: '  Sending is slow today. ', actionLabel: ' Details ', extra: 1 },
        }),
      ).toEqual(good)
      expect(resolveSetting('notice', { notice: noAction })).toEqual(noAction)
      expect(
        resolveSetting('notice', { notice: { ...noAction, actionLabel: null, actionUrl: '' } }),
      ).toEqual(noAction)
    })

    it('accepts each field at its limits', () => {
      const limits = {
        ...good,
        id: 'a'.repeat(40),
        text: 'x'.repeat(200),
        actionLabel: 'y'.repeat(30),
        actionUrl: `https://textbee.dev/${'z'.repeat(2048 - 20)}`,
        dismissible: false,
      }
      expect(limits.actionUrl).toHaveLength(2048)
      expect(resolveSetting('notice', { notice: limits })).toEqual(limits)
      expect(resolveSetting('notice', { notice: { ...good, id: 'a' } })).toEqual({ ...good, id: 'a' })
      expect(resolveSetting('notice', { notice: { ...good, text: 'x' } })).toEqual({ ...good, text: 'x' })
      expect(resolveSetting('notice', { notice: { ...good, level: 'info' } })).toEqual({ ...good, level: 'info' })
    })

    const bad: Array<[string, Record<string, unknown>]> = [
      ['no id', { id: undefined }],
      ['an empty id', { id: '' }],
      ['an id of 41 characters', { id: 'a'.repeat(41) }],
      ['an id with a space', { id: 'a b' }],
      ['an id with a slash', { id: 'a/b' }],
      ['an id that is a number', { id: 7 }],
      ['no level', { level: undefined }],
      ['an unknown level', { level: 'critical' }],
      ['an upper case level', { level: 'INFO' }],
      ['no text', { text: undefined }],
      ['blank text', { text: '   ' }],
      ['text of 201 characters', { text: 'x'.repeat(201) }],
      ['text that is a number', { text: 5 }],
      ['a line break in the text', { text: 'one\ntwo' }],
      ['a carriage return in the text', { text: 'one\rtwo' }],
      ['a line separator in the text', { text: 'one\u2028two' }],
      ['a control character in the text', { text: 'one\u0007two' }],
      ['a C1 control character in the text', { text: 'one\u0085two' }],
      ['a right-to-left override in the text', { text: 'one\u202etwo' }],
      ['a bidirectional isolate in the text', { text: 'one\u2067two' }],
      ['an Arabic letter mark in the text', { text: 'one\u061ctwo' }],
      ['a zero width space in the text', { text: 'one\u200btwo' }],
      ['a left-to-right mark in the text', { text: 'one\u200etwo' }],
      ['a right-to-left mark in the text', { text: 'one\u200ftwo' }],
      ['a word joiner in the text', { text: 'one\u2060two' }],
      ['an invisible plus in the text', { text: 'one\u2064two' }],
      ['a byte order mark in the text', { text: 'one\ufefftwo' }],
      ['a lone high surrogate in the text', { text: 'one\ud800two' }],
      ['a lone low surrogate in the text', { text: 'one\udc00two' }],
      ['a zero width space in the label', { actionLabel: 'Up\u200bdate' }],
      ['a lone surrogate in the label', { actionLabel: 'Update\ud800' }],
      ['a label of 31 characters', { actionLabel: 'y'.repeat(31) }],
      ['a line break in the label', { actionLabel: 'Up\ndate' }],
      ['a left-to-right override in the label', { actionLabel: '\u202dUpdate' }],
      ['a label that is a number', { actionLabel: 1 }],
      ['a label without a link', { actionUrl: undefined }],
      ['a link without a label', { actionLabel: undefined }],
      ['an http link', { actionUrl: 'http://textbee.dev' }],
      ['a javascript link', { actionUrl: 'javascript:alert(1)' }],
      ['a link that does not parse', { actionUrl: 'https://' }],
      ['a relative link', { actionUrl: '/download' }],
      ['a link with a user name', { actionUrl: 'https://user@textbee.dev' }],
      ['a link with a password', { actionUrl: 'https://user:pass@textbee.dev' }],
      ['a link with a space', { actionUrl: 'https://textbee.dev/a b' }],
      ['a link with a tab', { actionUrl: 'https://textbee.dev/\ta' }],
      ['a link with a line break', { actionUrl: 'https://textbee.dev/\n' }],
      ['a link with a control character', { actionUrl: 'https://textbee.dev/\u0000' }],
      ['a link of 2049 characters', { actionUrl: `https://textbee.dev/${'z'.repeat(2049 - 20)}` }],
      ['a link that is not a string', { actionUrl: { href: 'https://textbee.dev' } }],
      ['a link without the two slashes', { actionUrl: 'https:textbee.dev/x' }],
      ['a link with one slash', { actionUrl: 'https:/x' }],
      ['a link in upper case', { actionUrl: 'HTTPS://x' }],
      ['a link with backslashes', { actionUrl: 'https:\\\\x' }],
      ['a link with a space before it', { actionUrl: ' https://textbee.dev' }],
      ['no dismissible', { dismissible: undefined }],
      ['dismissible as a string', { dismissible: 'true' }],
      ['dismissible as a number', { dismissible: 1 }],
      ['a title of 61 characters', { title: 't'.repeat(61) }],
      ['a line break in the title', { title: 'Heads\nup' }],
      ['a control character in the title', { title: 'Heads\u0007up' }],
      ['a title that is a number', { title: 1 }],
      ['a max age of 0 hours', { maxAgeHours: 0 }],
      ['a max age of 8761 hours', { maxAgeHours: 8761 }],
      ['a max age that is not whole', { maxAgeHours: 1.5 }],
      ['a max age as a string', { maxAgeHours: '24' }],
      ['notify as a string', { notify: 'yes' }],
      ['notify as a number', { notify: 1 }],
      ['an unknown app link', { actionUrl: 'textbee://nothing' }],
      ['an app link with a path', { actionUrl: 'textbee://device-health/x' }],
      ['an app link in upper case', { actionUrl: 'TEXTBEE://device-health' }],
      ['an app link with a query', { actionUrl: 'textbee://add-api-key?x=1' }],
      ['a store link', { actionUrl: 'market://details' }],
      ['an http link to another site', { actionUrl: 'http://example.com' }],
    ]

    it.each(bad)('drops a device notice with %s and falls to the platform one', (_, change) => {
      setPlatformValues({ notice: platform })
      expect(resolveSetting('notice', { notice: { ...good, ...change } })).toEqual(platform)
    })

    it.each(bad)('drops a platform notice with %s and falls to the env one', (_, change) => {
      process.env.APP_NOTICE_JSON = JSON.stringify(envNotice)
      setPlatformValues({ notice: { ...good, ...change } })
      expect(resolveSetting('notice')).toEqual({ ...noAction, id: 'env' })
      expect(droppedPlatformKeys({ notice: { ...good, ...change } })).toEqual(['notice'])
    })

    it.each(bad)('drops an env notice with %s', (_, change) => {
      process.env.APP_NOTICE_JSON = JSON.stringify({ ...good, ...change })
      expect(resolveSetting('notice')).toBeNull()
    })

    it.each([
      ['an array', [good]],
      ['a string', 'Sending is slow today.'],
      ['null', null],
    ])('drops a notice that is %s at every level', (_, value) => {
      process.env.APP_NOTICE_JSON = JSON.stringify(value)
      setPlatformValues({ notice: value })
      expect(resolveSetting('notice', { notice: value })).toBeNull()
    })

    it('drops env text that is not JSON', () => {
      process.env.APP_NOTICE_JSON = '{id: maintenance}'
      expect(resolveSetting('notice')).toBeNull()
    })

    it('allows a zero width joiner and a surrogate pair in the text', () => {
      const text = 'Family \ud83d\udc68\u200d\ud83d\udc69 ok'
      expect(resolveSetting('notice', { notice: { ...good, text } })).toEqual({ ...good, text })
    })

    it('sends the link the parser read, not the raw text', () => {
      const sent = (actionUrl: string) =>
        (resolveSetting('notice', { notice: { ...good, actionUrl } }) as { actionUrl: string })
          .actionUrl
      expect(sent('https://textbee.dev\\@evil.com')).toBe('https://textbee.dev/@evil.com')
      expect(sent('https://TextBee.dev/a?b=\u00fc')).toBe('https://textbee.dev/a?b=%C3%BC')
      expect(sent('https://textbee.dev')).toBe('https://textbee.dev/')
    })

    it('parses the env notice once per raw value', () => {
      process.env.APP_NOTICE_JSON = JSON.stringify({ ...good, id: 'once' })
      const parse = jest.spyOn(JSON, 'parse')
      try {
        const first = resolveSetting('notice')
        expect(resolveSetting('notice')).toBe(first)
        expect(parse).toHaveBeenCalledTimes(1)
        process.env.APP_NOTICE_JSON = JSON.stringify({ ...good, id: 'next' })
        expect(resolveSetting('notice')).toEqual({ ...good, id: 'next' })
        expect(parse).toHaveBeenCalledTimes(2)
      } finally {
        parse.mockRestore()
      }
    })

    it('passes the platform document check when valid', () => {
      expect(droppedPlatformKeys({ notice: good })).toEqual([])
    })

    it('accepts a title, the error level, a max age and notify', () => {
      const full = { ...good, level: 'error', title: 'Heads up', maxAgeHours: 24, notify: true }
      expect(resolveSetting('notice', { notice: full })).toEqual(full)
      expect(resolveSetting('notice', { notice: { ...full, title: ' Heads up ' } })).toEqual(full)
      expect(resolveSetting('notice', { notice: { ...good, title: 't'.repeat(60) } })).toEqual({
        ...good,
        title: 't'.repeat(60),
      })
      for (const maxAgeHours of [1, 8760]) {
        expect(resolveSetting('notice', { notice: { ...good, maxAgeHours } })).toEqual({ ...good, maxAgeHours })
      }
    })

    it('leaves out notify unless true, and a missing title or max age', () => {
      expect(resolveSetting('notice', { notice: { ...good, notify: false } })).toEqual(good)
      expect(
        resolveSetting('notice', { notice: { ...good, notify: null, title: null, maxAgeHours: null } }),
      ).toEqual(good)
      expect(resolveSetting('notice', { notice: { ...good, title: '  ' } })).toEqual(good)
    })

    it('keeps the key order of a notice without the new fields', () => {
      const read = resolveSetting('notice', { notice: { ...good, notify: false } })
      expect(Object.keys(read as object)).toEqual(['id', 'level', 'text', 'dismissible', 'actionLabel', 'actionUrl'])
    })

    it.each(['textbee://device-health', 'textbee://add-api-key', 'textbee://battery-settings'])(
      'accepts the app link %s as is',
      (actionUrl) => {
        expect(resolveSetting('notice', { notice: { ...good, actionUrl } })).toEqual({ ...good, actionUrl })
      },
    )
  })

  describe('env snapshot', () => {
    it('carries the rollout percent, the minimum build and the notice when set and valid', () => {
      const notice = {
        id: 'env',
        level: 'info',
        text: 'Hello',
        dismissible: true,
      }
      process.env.UPDATE_ROLLOUT_PERCENT = '10'
      process.env.MIN_SUPPORTED_APP_VERSION_CODE = '18'
      process.env.APP_NOTICE_JSON = JSON.stringify(notice)
      expect(envSnapshot()).toEqual({
        updateRolloutPercent: 10,
        minSupportedVersionCode: 18,
        notice,
      })
    })

    it('leaves them out when invalid', () => {
      process.env.UPDATE_ROLLOUT_PERCENT = '101'
      process.env.MIN_SUPPORTED_APP_VERSION_CODE = '-1'
      process.env.APP_NOTICE_JSON = '{"id":"env"}'
      expect(envSnapshot()).toEqual({})
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

    it('switch device route counting on by default, by env or platform, never per device', () => {
      expect(resolveSetting('deviceRouteThrottleEnabled')).toBe(true)
      process.env.DEVICE_ROUTE_THROTTLE_ENABLED = 'false'
      expect(resolveSetting('deviceRouteThrottleEnabled')).toBe(false)
      setPlatformValues({ deviceRouteThrottleEnabled: true })
      expect(
        resolveSetting('deviceRouteThrottleEnabled', {
          deviceRouteThrottleEnabled: false,
        }),
      ).toBe(true)
    })
  })
})
