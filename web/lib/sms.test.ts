import { describe, expect, it } from 'vitest'
import { getSegmentInfo, hasLetters, isGsm7 } from './sms'

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
  })

  it('passes numbers and formatting', () => {
    expect(hasLetters('+1 (555) 555-0123')).toBe(false)
    expect(hasLetters('605')).toBe(false)
  })
})
