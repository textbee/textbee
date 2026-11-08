import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readLastLoginMethod, saveLastLoginMethod } from './last-login-method'

describe('last login method', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('returns null when nothing is stored', () => {
    expect(readLastLoginMethod()).toBeNull()
  })

  it('returns a saved method', () => {
    saveLastLoginMethod('google')
    expect(readLastLoginMethod()).toBe('google')
    saveLastLoginMethod('password')
    expect(readLastLoginMethod()).toBe('password')
  })

  it('ignores an unknown stored value', () => {
    window.localStorage.setItem('textbee.lastLoginMethod', 'facebook')
    expect(readLastLoginMethod()).toBeNull()
  })

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    expect(readLastLoginMethod()).toBeNull()
    expect(() => saveLastLoginMethod('google')).not.toThrow()
  })
})
