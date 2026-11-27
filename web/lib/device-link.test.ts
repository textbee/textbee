import { beforeEach, describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  codeCharsFrom,
  codeFromLink,
  displayCode,
  formatCodeChars,
  isLinkDeviceAddress,
  linkPageReturnPath,
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

describe('linkPageReturnPath', () => {
  const origin = 'https://app.example.com'

  it('keeps a same-site link page path with its code', () => {
    expect(linkPageReturnPath('/link-device?code=K7QX-2M9P', origin)).toBe(
      '/link-device?code=K7QX-2M9P'
    )
    expect(
      linkPageReturnPath('https://app.example.com/link-device?code=K7QX-2M9P', origin)
    ).toBe('/link-device?code=K7QX-2M9P')
  })

  it('falls back to the bare link page for anything else', () => {
    expect(linkPageReturnPath('https://textbee.dev/link-device', origin)).toBe('/link-device')
    expect(linkPageReturnPath('//evil.example.net/link-device', origin)).toBe('/link-device')
    expect(linkPageReturnPath('/dashboard', origin)).toBe('/link-device')
    expect(linkPageReturnPath('', origin)).toBe('/link-device')
  })
})

describe('code alphabet', () => {
  it('is the server alphabet, without 0, O, 1, I or L', () => {
    expect(CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789')
  })

  it('refuses a code with a character outside the alphabet', () => {
    expect(normalizeCode('K7QX2M0P')).toBeNull()
    expect(normalizeCode('K7QO2M9P')).toBeNull()
    expect(normalizeCode('k7qx-2m9p')).toBe('K7QX2M9P')
  })
})

describe('codeCharsFrom', () => {
  it('keeps the alphabet in upper case, at most 8', () => {
    expect(codeCharsFrom('7TR9098GGGJGFJ')).toEqual({
      chars: '7TR998GG',
      droppedConfusable: false,
    })
    expect(codeCharsFrom(' k7qx-2m9p ').chars).toBe('K7QX2M9P')
  })

  it('reads the code of a link', () => {
    expect(
      codeCharsFrom('https://app.textbee.dev/link-device?code=K7QX-2M9P').chars
    ).toBe('K7QX2M9P')
    expect(codeCharsFrom('/link-device?x=1&code=k7qx%2D2m9p').chars).toBe('K7QX2M9P')
    expect(codeCharsFrom('app.textbee.dev/link-device?code=k7qx2m9p&x=1').chars).toBe('K7QX2M9P')
  })

  it('reads the query as a browser does: encoded names, not the part after #', () => {
    expect(codeCharsFrom('/link-device?%63ode=K7QX-2M9P').chars).toBe('K7QX2M9P')
    // A code only after # is not in the query: the link gives no code
    expect(codeCharsFrom('/link-device#help?code=K7QX-2M9P').chars).toBe('')
    expect(codeCharsFrom('https://app.textbee.dev/link-device').chars).toBe('')
  })

  it('cleans text that is not a link, also with stray symbols', () => {
    expect(codeCharsFrom('K7QX=2M9P').chars).toBe('K7QX2M9P')
    expect(codeCharsFrom('k7qx?').chars).toBe('K7QX')
  })

  it('reports a dropped O, I or L', () => {
    expect(codeCharsFrom('K7QO')).toEqual({ chars: 'K7Q', droppedConfusable: true })
    expect(codeCharsFrom('k7ql').droppedConfusable).toBe(true)
    expect(codeCharsFrom('K7Q0').droppedConfusable).toBe(false)
  })
})

describe('formatCodeChars', () => {
  it('shows the hyphen once four characters are in', () => {
    expect(formatCodeChars('')).toBe('')
    expect(formatCodeChars('K7Q')).toBe('K7Q')
    expect(formatCodeChars('K7QX')).toBe('K7QX-')
    expect(formatCodeChars('K7QX2M9P')).toBe('K7QX-2M9P')
  })
})

describe('codeFromLink', () => {
  it('is null for a typed code and the code or empty for a link', () => {
    expect(codeFromLink('K7QX-2M9P')).toBeNull()
    expect(codeFromLink('https://app.textbee.dev/link-device?code=K7QX-2M9P')).toBe('K7QX-2M9P')
    expect(codeFromLink('/link-device')).toBe('')
  })
})
