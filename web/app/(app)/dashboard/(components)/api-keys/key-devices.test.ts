import { describe, expect, it } from 'vitest'
import { keyDevicesWarning, lastSeenLabel } from './key-devices'

describe('keyDevicesWarning', () => {
  it('speaks of one device in the singular', () => {
    expect(keyDevicesWarning(1)).toBe(
      '1 device used this key in the last 7 days. It stops working with textbee until you enter a new key in the textbee app on it.'
    )
  })

  it('counts several devices', () => {
    expect(keyDevicesWarning(2)).toBe(
      '2 devices used this key in the last 7 days. They stop working with textbee until you enter a new key in the textbee app on each one.'
    )
  })
})

describe('lastSeenLabel', () => {
  it('uses the compact lowercase form', () => {
    expect(lastSeenLabel(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())).toBe(
      'last seen 2h ago'
    )
    expect(lastSeenLabel(new Date().toISOString())).toBe('last seen just now')
  })

  it('returns null for a missing or invalid time', () => {
    expect(lastSeenLabel(undefined)).toBeNull()
    expect(lastSeenLabel('not a date')).toBeNull()
  })
})
