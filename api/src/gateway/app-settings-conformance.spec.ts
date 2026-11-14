import { readFileSync } from 'fs'
import { join } from 'path'
import {
  APP_SETTINGS,
  NOTICE_LIST_MAX,
  SETTING_KEYS,
  droppedPlatformKeys,
  resolveSetting,
  setPlatformValues,
} from './app-settings'
import { chooseNotices, inUpdateGroup, rolloutBucket } from './device-config'

// Shared fixture: each repo that keeps a copy of these rules runs the same file
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'app-settings-conformance.json'), 'utf8'),
)
const settings: Record<string, any> = fixture.settings

describe('app settings conformance', () => {
  // The platform values are module state
  afterEach(() => setPlatformValues({}))

  it('lists exactly the keys of the registry', () => {
    expect([...SETTING_KEYS].sort()).toEqual(Object.keys(settings).sort())
  })

  it.each(Object.keys(settings))('%s matches the registry', (key) => {
    const spec: Record<string, unknown> = APP_SETTINGS[key]
    const expected = settings[key]
    expect({
      type: spec.type,
      env: spec.env,
      default: spec.default,
      min: spec.min ?? null,
      max: spec.max ?? null,
      maxLength: spec.maxLength ?? null,
      target: spec.target,
      deviceOverride: spec.deviceOverride,
    }).toEqual({
      type: expected.type,
      env: expected.env,
      default: expected.default,
      min: expected.min,
      max: expected.max,
      maxLength: expected.maxLength,
      target: expected.target,
      deviceOverride: expected.deviceOverride,
    })
  })

  it.each(Object.keys(settings))('%s has samples for both sides', (key) => {
    expect(settings[key].accept.length).toBeGreaterThan(0)
    expect(settings[key].reject.length).toBeGreaterThan(0)
  })

  it.each(Object.keys(settings))('%s reads its accepted samples', (key) => {
    for (const value of settings[key].accept) {
      expect(droppedPlatformKeys({ [key]: value })).toEqual([])
    }
  })

  it.each(Object.keys(settings))('%s drops its rejected samples', (key) => {
    for (const value of settings[key].reject) {
      expect(droppedPlatformKeys({ [key]: value })).toEqual([key])
    }
  })

  it('allows as many notices in a list as the fixture', () => {
    expect(NOTICE_LIST_MAX).toBe(fixture.noticeListMax)
  })

  it.each(
    fixture.noticeOrder as { server: string; admin: number; order: string[] }[],
  )('orders $admin admin notices with server notice $server', ({ server, admin, order }) => {
    const notices = Array.from({ length: admin }, (_, i) => ({
      id: `admin-${i + 1}`,
      level: 'info' as const,
      text: `Notice ${i + 1}`,
      dismissible: true,
    }))
    // Build 21 with the latest at 22: the update notice applies; a minimum of 22 makes it unsupported
    const sent = chooseNotices(
      { versionCode: server === 'none' ? 22 : 21, versionName: '2.9.0' },
      {
        latestVersionCode: 22,
        latestVersionName: '2.10.0',
        minSupportedVersionCode: server === 'unsupported' ? 22 : 0,
        notice: notices,
      },
      new Date('2026-11-13T00:00:00Z'),
    )
    expect(sent.map((n) => n.id.replace(/^(update|unsupported)-.*$/, '$1'))).toEqual(order)
  })

  it.each(fixture.reads as { key: string; stored: unknown; reads: unknown }[])(
    'reads a stored $key value as the fixture says',
    ({ key, stored, reads }) => {
      setPlatformValues({ [key]: stored })
      expect(resolveSetting(key as (typeof SETTING_KEYS)[number])).toEqual(
        reads,
      )
    },
  )

  it.each(fixture.rollout as { deviceId: string; bucket: number }[])(
    'puts $deviceId in bucket $bucket',
    ({ deviceId, bucket }) => {
      expect(rolloutBucket(deviceId)).toBe(bucket)
    },
  )

  it.each(
    fixture.updateGroup as {
      deviceId: string
      percent: number
      inGroup: boolean
    }[],
  )(
    'at $percent percent, $deviceId in the update group is $inGroup',
    ({ deviceId, percent, inGroup }) => {
      expect(inUpdateGroup(deviceId, percent)).toBe(inGroup)
    },
  )
})
