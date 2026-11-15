import {
  APP_VERSION_FLAP_WINDOW_MS,
  MAX_APP_VERSION_HISTORY,
  appVersionHistoryChange,
  cleanAppInstallReport,
} from './app-version-history'

const now = new Date('2026-11-12T12:00:00.000Z')
const createdLongAgo = new Date('2026-01-01T00:00:00.000Z')
const PLAY = 'com.android.vending'
const KEY_21 = `21|2.9.0|${PLAY}`
const KEY_22 = `22|2.10.0|${PLAY}`

const entry = (versionCode: number, versionName: string, firstSeenAt: Date) => ({
  versionCode,
  versionName,
  installSource: 'play_store' as const,
  installerPackage: PLAY,
  firstSeenAt,
  seeded: false,
})

describe('cleanAppInstallReport', () => {
  it('keeps valid values, trimmed', () => {
    expect(
      cleanAppInstallReport(
        {
          installerPackage: ' com.android.vending ',
          initiatingPackage: 'com.android.chrome',
          appLastUpdateTime: 1762905600000,
        },
        now,
      ),
    ).toEqual({
      installerPackage: PLAY,
      initiatingPackage: 'com.android.chrome',
      appLastUpdateTime: new Date(1762905600000),
    })
  })

  it('keeps an empty installer, which means Android has no installer name', () => {
    expect(cleanAppInstallReport({ installerPackage: '' }, now)).toEqual({
      installerPackage: '',
    })
  })

  it('drops an empty initiating package', () => {
    expect(cleanAppInstallReport({ initiatingPackage: '  ' }, now)).toEqual({})
  })

  it.each([
    ['a number', 42],
    ['an object', { name: PLAY }],
    ['null', null],
    ['a slash', 'com.example/evil'],
    ['a space inside', 'com.android vending'],
    ['a dollar sign', '$where'],
    ['more than 255 characters', 'a'.repeat(256)],
    ['a lone dot', '.'],
    ['a double dot', 'com..store'],
    ['a leading dot', '.com.store'],
    ['a trailing dot', 'com.store.'],
  ])('drops a package name that is %s', (_label, value) => {
    expect(
      cleanAppInstallReport(
        { installerPackage: value, initiatingPackage: value },
        now,
      ),
    ).toEqual({})
  })

  it.each(['android', PLAY, 'com.sec.android.app.samsungapps', 'a_b.c1'])(
    'keeps the package name %s',
    (name) => {
      expect(cleanAppInstallReport({ installerPackage: name }, now)).toEqual({
        installerPackage: name,
      })
    },
  )

  it('keeps a package name of exactly 255 characters', () => {
    const name = 'a'.repeat(255)
    expect(cleanAppInstallReport({ installerPackage: name }, now)).toEqual({
      installerPackage: name,
    })
  })

  it.each([
    ['a string', '1762905600000'],
    ['a fraction', 1762905600000.5],
    ['before 2008', Date.UTC(2007, 11, 31)],
    ['more than a day ahead', now.getTime() + 24 * 60 * 60 * 1000 + 1],
    ['not a number', Number.NaN],
  ])('drops an update time that is %s', (_label, value) => {
    expect(cleanAppInstallReport({ appLastUpdateTime: value }, now)).toEqual({})
  })

  it('returns nothing for a body that is not an object', () => {
    expect(cleanAppInstallReport(undefined, now)).toEqual({})
    expect(cleanAppInstallReport('x', now)).toEqual({})
  })
})

describe('appVersionHistoryChange', () => {
  it('changes nothing when the key is the same', () => {
    expect(
      appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo, appVersionKey: KEY_22 },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      ),
    ).toEqual({ kind: 'none', seen: true })
  })

  it('produces the exact update for a new version', () => {
    const lastUpdate = new Date('2026-11-12T11:00:00.000Z')
    const change = appVersionHistoryChange(
      {
        _id: 'd1',
        createdAt: createdLongAgo,
        appVersionKey: KEY_21,
        appVersionHistory: [entry(21, '2.9.0', createdLongAgo)],
      },
      {
        versionCode: 22,
        versionName: '2.10.0',
        installerPackage: PLAY,
        initiatingPackage: 'com.android.chrome',
        appLastUpdateTime: lastUpdate,
      },
      now,
    )

    const newEntry = {
      versionCode: 22,
      versionName: '2.10.0',
      installSource: 'play_store',
      installerPackage: PLAY,
      installedAt: lastUpdate,
      firstSeenAt: now,
      seeded: false,
    }
    const history = { $ifNull: ['$appVersionHistory', []] }
    expect(change).toEqual({
      kind: 'append',
      seen: true,
      entry: newEntry,
      fields: {
        appVersionKey: KEY_22,
        installSource: 'play_store',
        installerPackage: PLAY,
        initiatingPackage: 'com.android.chrome',
      },
      filter: { _id: 'd1', appVersionKey: KEY_21 },
      update: [
        {
          $set: {
            appVersionHistory: {
              $slice: [
                {
                  $concatArrays: [
                    {
                      $map: {
                        input: { $range: [0, { $size: history }] },
                        as: 'i',
                        in: {
                          $cond: [
                            { $eq: ['$$i', { $subtract: [{ $size: history }, 1] }] },
                            {
                              $mergeObjects: [
                                { $arrayElemAt: [history, '$$i'] },
                                {
                                  lastSeenAt: {
                                    $ifNull: [
                                      '$appVersionLastSeenAt',
                                      { $ifNull: ['$lastHeartbeat', '$$REMOVE'] },
                                    ],
                                  },
                                },
                              ],
                            },
                            { $arrayElemAt: [history, '$$i'] },
                          ],
                        },
                      },
                    },
                    [{ $literal: newEntry }],
                  ],
                },
                -100,
              ],
            },
            appVersionKey: { $literal: KEY_22 },
            installSource: { $literal: 'play_store' },
            appVersionLastSeenAt: now,
            installerPackage: { $literal: PLAY },
            initiatingPackage: { $literal: 'com.android.chrome' },
          },
        },
      ],
    })
  })

  it('keeps the newest 100 entries', () => {
    expect(MAX_APP_VERSION_HISTORY).toBe(100)
    const change: any = appVersionHistoryChange(
      { _id: 'd1', appVersionKey: KEY_21 },
      { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
      now,
    )
    expect(change.update[0].$set.appVersionHistory.$slice[1]).toBe(-100)
  })

  it('adds an entry for a downgrade', () => {
    const change: any = appVersionHistoryChange(
      { _id: 'd1', appVersionKey: KEY_22 },
      { versionCode: 21, versionName: '2.9.0', installerPackage: PLAY },
      now,
    )
    expect(change.kind).toBe('append')
    expect(change.fields.appVersionKey).toBe(KEY_21)
    expect(change.filter.appVersionKey).toBe(KEY_22)
  })

  it('adds an entry for the same version from another installer', () => {
    const change: any = appVersionHistoryChange(
      { _id: 'd1', appVersionKey: KEY_22 },
      { versionCode: 22, versionName: '2.10.0', installerPackage: '' },
      now,
    )
    expect(change.kind).toBe('append')
    expect(change.entry).toEqual(
      expect.objectContaining({ installSource: 'apk', installerPackage: '' }),
    )
    expect(change.fields).toEqual({
      appVersionKey: '22|2.10.0|',
      installSource: 'apk',
      installerPackage: '',
    })
    // A reported install without an initiating package clears the old one
    expect(change.update[0].$set.initiatingPackage).toBe('$$REMOVE')
  })

  describe('a request without an installer field', () => {
    it('reuses the installer of the current key', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', appVersionKey: KEY_21 },
        { versionCode: 22, versionName: '2.10.0' },
        now,
      )
      expect(change.fields).toEqual({
        appVersionKey: KEY_22,
        installSource: 'play_store',
        installerPackage: PLAY,
      })
      expect(change.update[0].$set).not.toHaveProperty('initiatingPackage')
      expect(change.entry).not.toHaveProperty('installedAt')
    })

    it('never adds an entry on its own for the same version', () => {
      expect(
        appVersionHistoryChange(
          { _id: 'd1', appVersionKey: KEY_22 },
          { versionCode: 22, versionName: '2.10.0' },
          now,
        ),
      ).toEqual({ kind: 'none', seen: true })
    })

    it('records an unknown source when no installer was ever reported', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo },
        { versionCode: 20, versionName: '2.8.0' },
        now,
      )
      expect(change.fields).toEqual({
        appVersionKey: '20|2.8.0|~',
        installSource: 'unknown',
      })
      expect(change.entry).not.toHaveProperty('installerPackage')
      expect(change.update[0].$set).not.toHaveProperty('installerPackage')
    })
  })

  describe('an installer that arrives after its version', () => {
    const KEY_22_NO_INSTALLER = '22|2.10.0|~'
    const unknownEntry = (fields: Record<string, unknown> = {}) => ({
      versionCode: 22,
      versionName: '2.10.0',
      installSource: 'unknown' as const,
      firstSeenAt: createdLongAgo,
      seeded: false,
      ...fields,
    })
    const pending = (fields: Record<string, unknown> = {}) => ({
      _id: 'd1',
      createdAt: createdLongAgo,
      appVersionKey: KEY_22_NO_INSTALLER,
      appVersionHistory: [entry(21, '2.9.0', createdLongAgo), unknownEntry(fields)],
    })

    it('produces the exact in-place update that completes the newest entry', () => {
      const lastUpdate = new Date('2026-11-12T11:00:00.000Z')
      const change = appVersionHistoryChange(
        pending(),
        {
          versionCode: 22,
          versionName: '2.10.0',
          installerPackage: PLAY,
          initiatingPackage: 'com.android.chrome',
          appLastUpdateTime: lastUpdate,
        },
        now,
      )

      const history = { $ifNull: ['$appVersionHistory', []] }
      expect(change).toEqual({
        kind: 'complete',
        seen: true,
        fields: {
          appVersionKey: KEY_22,
          installSource: 'play_store',
          installerPackage: PLAY,
          initiatingPackage: 'com.android.chrome',
        },
        filter: { _id: 'd1', appVersionKey: KEY_22_NO_INSTALLER },
        update: [
          {
            $set: {
              appVersionHistory: {
                $map: {
                  input: { $range: [0, { $size: history }] },
                  as: 'i',
                  in: {
                    $cond: [
                      { $eq: ['$$i', { $subtract: [{ $size: history }, 1] }] },
                      {
                        $mergeObjects: [
                          { $arrayElemAt: [history, '$$i'] },
                          {
                            installSource: { $literal: 'play_store' },
                            installerPackage: { $literal: PLAY },
                            installedAt: { $literal: lastUpdate },
                          },
                        ],
                      },
                      { $arrayElemAt: [history, '$$i'] },
                    ],
                  },
                },
              },
              appVersionKey: { $literal: KEY_22 },
              installSource: { $literal: 'play_store' },
              appVersionLastSeenAt: now,
              installerPackage: { $literal: PLAY },
              initiatingPackage: { $literal: 'com.android.chrome' },
            },
          },
        ],
      })
    })

    it('keeps an install time the entry already has', () => {
      const change: any = appVersionHistoryChange(
        pending({ installedAt: createdLongAgo }),
        {
          versionCode: 22,
          versionName: '2.10.0',
          installerPackage: '',
          appLastUpdateTime: new Date('2026-11-12T11:00:00.000Z'),
        },
        now,
      )
      expect(change.kind).toBe('complete')
      const patch = change.update[0].$set.appVersionHistory.$map.in.$cond[1].$mergeObjects[1]
      expect(patch).toEqual({
        installSource: { $literal: 'apk' },
        installerPackage: { $literal: '' },
      })
    })

    it('gives one entry when the version comes first and the installer later', () => {
      const fromUnknown: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo },
        { versionCode: 22, versionName: '2.10.0' },
        now,
      )
      expect(fromUnknown.kind).toBe('append')
      expect(fromUnknown.fields.appVersionKey).toBe(KEY_22_NO_INSTALLER)

      const later = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo, appVersionKey: KEY_22_NO_INSTALLER, appVersionHistory: [fromUnknown.entry] },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(later.kind).toBe('complete')
    })

    it('gives one entry when the version and installer come together', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(change.kind).toBe('append')
      expect(change.fields.appVersionKey).toBe(KEY_22)
      expect(
        appVersionHistoryChange(
          { _id: 'd1', appVersionKey: KEY_22, appVersionHistory: [change.entry] },
          { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
          now,
        ),
      ).toEqual({ kind: 'none', seen: true })
    })

    it('keeps the unknown entry of a build that never sends an installer', () => {
      expect(
        appVersionHistoryChange(pending(), { versionCode: 22, versionName: '2.10.0' }, now),
      ).toEqual({ kind: 'none', seen: true })
    })

    it('never overwrites a known installer of the same version', () => {
      const change: any = appVersionHistoryChange(
        {
          _id: 'd1',
          appVersionKey: KEY_22,
          appVersionHistory: [entry(22, '2.10.0', createdLongAgo)],
        },
        { versionCode: 22, versionName: '2.10.0', installerPackage: 'org.fdroid.fdroid' },
        now,
      )
      expect(change.kind).toBe('append')
      expect(change.entry.installSource).toBe('other_store')
    })

    it('appends for a different version', () => {
      const change = appVersionHistoryChange(
        pending(),
        { versionCode: 23, versionName: '2.11.0', installerPackage: PLAY },
        now,
      )
      expect(change.kind).toBe('append')
    })
  })

  describe('a stored key', () => {
    it.each([
      ['without a separator', 'broken'],
      ['with an installer that is not a package name', '22|2.10.0|not a package'],
      ['with an installer that has a double dot', '22|2.10.0|com..store'],
      ['with an installer that is a lone dot', '22|2.10.0|.'],
    ])('%s is read as having no installer field', (_label, appVersionKey) => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', appVersionKey },
        { versionCode: 22, versionName: '2.10.0' },
        now,
      )
      expect(change.fields.appVersionKey).toBe('22|2.10.0|~')
      expect(change.filter.appVersionKey).toBe(appVersionKey)
    })

    it('keeps an empty installer part', () => {
      expect(
        appVersionHistoryChange(
          { _id: 'd1', appVersionKey: '22|2.10.0|' },
          { versionCode: 22, versionName: '2.10.0' },
          now,
        ),
      ).toEqual({ kind: 'none', seen: true })
    })
  })

  it('cleans and caps the stored version name before it enters an entry', () => {
    const change: any = appVersionHistoryChange(
      { _id: 'd1', appVersionCode: 16, appVersionName: `  ${'n'.repeat(300)}  ` },
      { useStoredVersion: true },
      now,
    )
    expect(change.entry.versionName).toBe('n'.repeat(255))
    expect(change.fields.appVersionKey).toBe(`16|${'n'.repeat(255)}|~`)
  })

  it('keys an empty installer as an empty part', () => {
    const change: any = appVersionHistoryChange(
      { _id: 'd1', createdAt: createdLongAgo },
      { versionCode: 22, versionName: '2.10.0', installerPackage: '' },
      now,
    )
    expect(change.fields.appVersionKey).toBe('22|2.10.0|')
    expect(change.entry.installSource).toBe('apk')
  })

  describe('the first entry', () => {
    it('is seeded for a device created before this request', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(change.kind).toBe('append')
      expect(change.entry.seeded).toBe(true)
      expect(change.filter).toEqual({ _id: 'd1', appVersionKey: { $exists: false } })
    })

    it('is seeded for a device without a creation time', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1' },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(change.entry.seeded).toBe(true)
    })

    it('is not seeded for a device registering now', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: new Date(now.getTime() - 60 * 1000) },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(change.entry.seeded).toBe(false)
    })

    it('is never seeded once the device has a history', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo, appVersionKey: KEY_21 },
        { versionCode: 22, versionName: '2.10.0', installerPackage: PLAY },
        now,
      )
      expect(change.entry.seeded).toBe(false)
    })
  })

  describe('a heartbeat that reports no version', () => {
    it('starts the history from the stored registration version', () => {
      const change: any = appVersionHistoryChange(
        { _id: 'd1', createdAt: createdLongAgo, appVersionCode: 16, appVersionName: '2.6.0' },
        { useStoredVersion: true },
        now,
      )
      expect(change.kind).toBe('append')
      expect(change.entry).toEqual({
        versionCode: 16,
        versionName: '2.6.0',
        installSource: 'unknown',
        firstSeenAt: now,
        seeded: true,
      })
      expect(change.fields.appVersionKey).toBe('16|2.6.0|~')
    })

    it('starts the history from the stored heartbeat version', () => {
      const change: any = appVersionHistoryChange(
        {
          _id: 'd1',
          appVersionCode: 16,
          appVersionName: '2.6.0',
          appVersionInfo: { versionCode: 17, versionName: '2.7.0' },
        },
        { useStoredVersion: true },
        now,
      )
      expect(change.fields.appVersionKey).toBe('17|2.7.0|~')
      expect(change.entry.seeded).toBe(true)
    })

    it('never adds a second entry', () => {
      expect(
        appVersionHistoryChange(
          { _id: 'd1', appVersionKey: '16|2.6.0|~', appVersionCode: 17, appVersionName: '2.7.0' },
          { useStoredVersion: true },
          now,
        ),
      ).toEqual({ kind: 'none', seen: true })
    })

    it('does nothing without a stored version', () => {
      expect(
        appVersionHistoryChange({ _id: 'd1' }, { useStoredVersion: true }, now),
      ).toEqual({ kind: 'none', seen: false })
    })

    it('does nothing for a device update without a version', () => {
      expect(
        appVersionHistoryChange(
          { _id: 'd1', appVersionKey: KEY_22, appVersionCode: 22 },
          { installerPackage: '' },
          now,
        ),
      ).toEqual({ kind: 'none', seen: false })
    })
  })

  it.each([
    ['zero', 0],
    ['a string', '22'],
    ['a fraction', 22.5],
  ])('treats a version code that is %s as not reported', (_label, versionCode) => {
    expect(
      appVersionHistoryChange(
        { _id: 'd1', appVersionKey: KEY_22 },
        { versionCode, versionName: '2.11.0', installerPackage: PLAY },
        now,
      ),
    ).toEqual({ kind: 'none', seen: false })
  })

  it('takes a missing version name from the stored version of the same code', () => {
    expect(
      appVersionHistoryChange(
        { _id: 'd1', appVersionKey: KEY_22, appVersionCode: 22, appVersionName: '2.10.0' },
        { versionCode: 22, installerPackage: PLAY },
        now,
      ),
    ).toEqual({ kind: 'none', seen: true })
  })

  describe('flap guard', () => {
    const flapDevice = (lastFirstSeenAt: Date) => ({
      _id: 'd1',
      createdAt: createdLongAgo,
      appVersionKey: KEY_22,
      appVersionHistory: [
        entry(21, '2.9.0', createdLongAgo),
        entry(22, '2.10.0', lastFirstSeenAt),
      ],
    })
    const back = { versionCode: 21, versionName: '2.9.0', installerPackage: PLAY }

    it('counts instead of appending when the last entry is under 24 hours old', () => {
      const change = appVersionHistoryChange(
        flapDevice(new Date(now.getTime() - APP_VERSION_FLAP_WINDOW_MS + 1)),
        back,
        now,
      )
      // No write of its own, and the last-seen time stays with the newest entry
      expect(change).toEqual({ kind: 'flap', seen: false })
    })

    it('appends when the last entry is 24 hours old', () => {
      const change = appVersionHistoryChange(
        flapDevice(new Date(now.getTime() - APP_VERSION_FLAP_WINDOW_MS)),
        back,
        now,
      )
      expect(change.kind).toBe('append')
    })

    it('appends a version that is not the one before the last', () => {
      const change = appVersionHistoryChange(
        flapDevice(new Date(now.getTime() - 60 * 1000)),
        { versionCode: 23, versionName: '2.11.0', installerPackage: PLAY },
        now,
      )
      expect(change.kind).toBe('append')
    })

    it('treats an unknown installer entry by its ~ key', () => {
      const change = appVersionHistoryChange(
        {
          _id: 'd1',
          appVersionKey: KEY_22,
          appVersionHistory: [
            { versionCode: 21, versionName: '2.9.0', installSource: 'unknown', firstSeenAt: createdLongAgo, seeded: true },
            entry(22, '2.10.0', new Date(now.getTime() - 60 * 1000)),
          ],
        },
        // No installer field reuses the installer of KEY_22, so this is not the ~ entry
        { versionCode: 21, versionName: '2.9.0' },
        now,
      )
      expect(change.kind).toBe('append')
    })
  })
})
