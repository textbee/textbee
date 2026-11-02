import { describe, expect, it } from 'vitest'
import {
  devicePresence,
  needsNewerAppForPresence,
  onlineWindowMs,
  presenceHint,
} from './device-presence'
import { toExactLabel } from '@/components/shared/relative-time'

const MINUTE_MS = 60 * 1000
const now = new Date('2026-10-27T12:00:00Z').getTime()
const ago = (minutes: number) => new Date(now - minutes * MINUTE_MS).toISOString()

describe('devicePresence', () => {
  it('is online after a recent heartbeat', () => {
    expect(devicePresence({ enabled: true, lastHeartbeat: ago(10) }, now)).toBe('online')
  })

  it('tolerates one missed heartbeat at the default interval', () => {
    expect(devicePresence({ enabled: true, lastHeartbeat: ago(64) }, now)).toBe('online')
    expect(devicePresence({ enabled: true, lastHeartbeat: ago(66) }, now)).toBe('offline')
  })

  it('widens the window for a longer heartbeat interval', () => {
    const device = { enabled: true, heartbeatIntervalMinutes: 120, lastHeartbeat: ago(200) }
    expect(onlineWindowMs(device)).toBe(245 * MINUTE_MS)
    expect(devicePresence(device, now)).toBe('online')
  })

  it('reports a disabled device as disabled whatever its heartbeat', () => {
    expect(devicePresence({ enabled: false, lastHeartbeat: ago(1) }, now)).toBe('disabled')
  })

  it('is unknown when the device never sent a heartbeat', () => {
    expect(devicePresence({ enabled: true, lastHeartbeat: null }, now)).toBe('unknown')
    expect(devicePresence({ enabled: true }, now)).toBe('unknown')
  })

  it('treats an unparseable timestamp as no heartbeat', () => {
    expect(devicePresence({ enabled: true, lastHeartbeat: 'not a date' }, now)).toBe('unknown')
  })
})

const hintDevice = (over: Record<string, unknown>) =>
  ({ _id: 'd1', brand: 'Google', model: 'Pixel 8', enabled: true, ...over }) as Parameters<
    typeof presenceHint
  >[0]

describe('needsNewerAppForPresence', () => {
  it('is true for builds before 2.7.0 and for an unknown version', () => {
    expect(needsNewerAppForPresence(hintDevice({ appVersionCode: 15 }), now)).toBe(true)
    expect(needsNewerAppForPresence(hintDevice({}), now)).toBe(true)
  })

  it('is false from build 16, and once a status update arrived', () => {
    expect(needsNewerAppForPresence(hintDevice({ appVersionCode: 16 }), now)).toBe(false)
    expect(
      needsNewerAppForPresence(hintDevice({ appVersionCode: 14, lastHeartbeat: ago(5) }), now)
    ).toBe(false)
  })

  it('prefers the version from the latest status update', () => {
    const device = hintDevice({ appVersionCode: 14, appVersionInfo: { versionCode: 20 } })
    expect(needsNewerAppForPresence(device, now)).toBe(false)
  })
})

describe('presenceHint', () => {
  it('gives the last seen time while online', () => {
    const last = ago(5)
    expect(presenceHint(hintDevice({ lastHeartbeat: last }), now)).toBe(
      `Last seen 5 minutes ago (${toExactLabel(new Date(last))}). The app sends a status update every 30 minutes.`
    )
  })

  it('says "every minute" for a one-minute interval', () => {
    expect(
      presenceHint(hintDevice({ lastHeartbeat: ago(0.5), heartbeatIntervalMinutes: 1 }), now)
    ).toContain('Last seen just now (')
    expect(
      presenceHint(hintDevice({ lastHeartbeat: ago(0.5), heartbeatIntervalMinutes: 1 }), now)
    ).toContain('every minute.')
  })

  it('uses the device interval', () => {
    expect(
      presenceHint(hintDevice({ lastHeartbeat: ago(5), heartbeatIntervalMinutes: 15 }), now)
    ).toContain('every 15 minutes')
  })

  it('says how long an offline device has been quiet and what to do', () => {
    expect(presenceHint(hintDevice({ lastHeartbeat: ago(300) }), now)).toBe(
      'Not seen for 5 hours. The app sends a status update every 30 minutes. Open the textbee app on the phone and turn off battery optimization for textbee.'
    )
  })

  it('explains a disabled device and keeps its last seen time', () => {
    const last = ago(60 * 48)
    expect(presenceHint(hintDevice({ enabled: false, lastHeartbeat: last }), now)).toBe(
      `The gateway is off in the textbee app on this phone. Sends to this device fail until you turn it on. Last seen: ${toExactLabel(new Date(last))}.`
    )
    expect(presenceHint(hintDevice({ enabled: false }), now)).toBe(
      'The gateway is off in the textbee app on this phone. Sends to this device fail until you turn it on.'
    )
  })

  it('names the old version that sends no status updates', () => {
    expect(presenceHint(hintDevice({ appVersionCode: 14, appVersionName: '2.5.0' }), now)).toMatch(
      /^App 2\.5\.0 sends no status updates, so the dashboard cannot tell if this phone is online\. Update the app to .+\.$/
    )
    expect(presenceHint(hintDevice({}), now)).toMatch(
      /^This phone runs an old app version that sends no status updates/
    )
  })

  it('waits for the first status update on a build that sends them', () => {
    expect(presenceHint(hintDevice({ appVersionCode: 20 }), now)).toBe(
      'Not seen yet. Open the textbee app on the phone.'
    )
  })
})
