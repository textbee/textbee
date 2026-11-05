import { describe, expect, it } from 'vitest'
import {
  getSegmentInfo,
  hasLetters,
  hasOnlyPhoneCharacters,
  isGsm7,
  isPlausiblePhone,
  isShortCode,
  recipientError,
  stripPhoneFormatting,
} from './sms'

// Moved here from bulk-send/bulk-csv.test.ts when the segment helpers became
// shared by the send page, bulk send and the reply composer.

describe('isGsm7', () => {
  it('accepts the basic latin alphabet', () => {
    expect(isGsm7('Hello there 123')).toBe(true)
  })

  it('rejects characters that force UCS-2', () => {
    expect(isGsm7('Hello 😀')).toBe(false)
    expect(isGsm7('日本語')).toBe(false)
  })
})

describe('getSegmentInfo', () => {
  it('counts a short GSM-7 message as one segment', () => {
    const info = getSegmentInfo('Hello there')
    expect(info).toMatchObject({ segments: 1, encoding: 'GSM-7', perSegment: 160 })
  })

  it('treats an empty message as zero segments', () => {
    expect(getSegmentInfo('').segments).toBe(0)
  })

  it('splits past 160 GSM-7 characters', () => {
    expect(getSegmentInfo('a'.repeat(160)).segments).toBe(1)
    expect(getSegmentInfo('a'.repeat(161)).segments).toBe(2)
    expect(getSegmentInfo('a'.repeat(306)).segments).toBe(2)
    expect(getSegmentInfo('a'.repeat(307)).segments).toBe(3)
  })

  it('drops to UCS-2 limits when a character needs it', () => {
    const info = getSegmentInfo('Hello 😀')
    expect(info.encoding).toBe('UCS-2')
    expect(info.perSegment).toBe(70)
  })

  it('splits UCS-2 past 70 characters', () => {
    expect(getSegmentInfo(`😀${'a'.repeat(70)}`).segments).toBe(2)
  })
})

describe('hasLetters', () => {
  it('flags sender names in any script', () => {
    expect(hasLetters('MYBANK')).toBe(true)
    expect(hasLetters('Банк')).toBe(true)
    expect(hasLetters('123ʰ456')).toBe(true)
  })

  it('passes numbers and formatting', () => {
    expect(hasLetters('+1 (555) 555-0123')).toBe(false)
    expect(hasLetters('605')).toBe(false)
    // Japanese input types the long vowel mark in place of a hyphen.
    expect(hasLetters('555ー555ー0101')).toBe(false)
  })
})

describe('isPlausiblePhone', () => {
  it('accepts numbers, short codes and the Japanese long vowel mark', () => {
    expect(isPlausiblePhone('+1 (555) 555-0123')).toBe(true)
    expect(isPlausiblePhone('605')).toBe(true)
    expect(isPlausiblePhone('555ー555ー0101')).toBe(true)
  })

  it('rejects too few or too many digits', () => {
    expect(isPlausiblePhone('12')).toBe(false)
    expect(isPlausiblePhone('1234567890123456')).toBe(false)
  })
})

describe('stripPhoneFormatting', () => {
  it('removes every separator the plausibility check accepts', () => {
    expect(stripPhoneFormatting(' +1 (555) 555-0101 ')).toBe('+15555550101')
    expect(stripPhoneFormatting('555/555.0101')).toBe('5555550101')
    expect(stripPhoneFormatting('555ー555ｰ0101')).toBe('5555550101')
  })
})

describe('recipientError', () => {
  it('accepts numbers and short codes', () => {
    expect(recipientError('605')).toBeNull()
    expect(recipientError('+1 (555) 555-0123')).toBeNull()
  })

  it('names the problem', () => {
    expect(recipientError('MYBANK')).toMatch(/contains letters/)
    expect(recipientError('12')).toMatch(/^"12" is too short/)
    expect(recipientError('1234567890123456')).toMatch(/is too long/)
    expect(recipientError('555#0101')).toMatch(/is not a phone number/)
  })
})

describe('isShortCode', () => {
  it('flags short numbers without a country code', () => {
    expect(isShortCode('605')).toBe(true)
    expect(isShortCode('55555')).toBe(true)
  })

  it('passes full numbers and anything with a plus', () => {
    expect(isShortCode('0911234567')).toBe(false)
    expect(isShortCode('+15555550123')).toBe(false)
    expect(isShortCode('+605')).toBe(false)
  })
})

describe('hasOnlyPhoneCharacters', () => {
  it('accepts formatting and rejects other symbols', () => {
    expect(hasOnlyPhoneCharacters('+1 (555) 555-0101')).toBe(true)
    expect(hasOnlyPhoneCharacters('+1 (555) 555#0101')).toBe(false)
  })
})
