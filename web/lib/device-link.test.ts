import { beforeEach, describe, expect, it } from 'vitest'
import {
  displayCode,
  isLinkDeviceAddress,
  normalizeCode,
  storeTypedCode,
  takeTypedCode,
} from './device-link'

describe('normalizeCode', () => {
  it('accepts small letters, a missing hyphen and spaces', () => {
    expect(normalizeCode('K7QX-2M9P')).toBe('K7QX2M9P')
    expect(normalizeCode('k7qx2m9p')).toBe('K7QX2M9P')
    expect(normalizeCode(' k7qx 2m9p ')).toBe('K7QX2M9P')
  })

  it('refuses a wrong length or other characters', () => {
    expect(normalizeCode('abc')).toBeNull()
    expect(normalizeCode('K7QX-2M9P1')).toBeNull()
    expect(normalizeCode('K7QX_2M9P')).toBeNull()
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode(undefined)).toBeNull()
  })
})

describe('displayCode', () => {
  it('puts the hyphen in the middle', () => {
    expect(displayCode('K7QX2M9P')).toBe('K7QX-2M9P')
  })
})

describe('typed code hand-off', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('returns the stored code once and removes it', () => {
    expect(storeTypedCode('K7QX2M9P')).toBe(true)
    expect(takeTypedCode()).toBe('K7QX2M9P')
    expect(takeTypedCode()).toBeNull()
  })

  it('removes a stored value that is not a code', () => {
    window.sessionStorage.setItem('textbee.linkDevice.typedCode', 'abc')
    expect(takeTypedCode()).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })
})

describe('isLinkDeviceAddress', () => {
  it('matches the link page with or without a code', () => {
    expect(isLinkDeviceAddress('/link-device', '')).toBe(true)
    expect(isLinkDeviceAddress('/link-device', '?code=K7QX-2M9P')).toBe(true)
  })

  it('matches a login or sign-up page that returns to the link page', () => {
    expect(
      isLinkDeviceAddress('/login', '?redirect=%2Flink-device%3Fcode%3DK7QX-2M9P')
    ).toBe(true)
    expect(
      isLinkDeviceAddress(
        '/register',
        '?redirect=%252Flink-device%253Fcode%253DK7QX-2M9P'
      )
    ).toBe(true)
  })

  it('leaves every other page alone', () => {
    expect(isLinkDeviceAddress('/dashboard', '')).toBe(false)
    expect(isLinkDeviceAddress('/login', '?redirect=%2Fdashboard')).toBe(false)
    expect(isLinkDeviceAddress('/login', null)).toBe(false)
    expect(isLinkDeviceAddress(null, null)).toBe(false)
  })
})
