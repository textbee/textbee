import { HttpStatus } from '@nestjs/common'
import {
  MAX_MESSAGE_BYTES,
  assertMessageFits,
  messageByteLength,
} from './message-size'

describe('messageByteLength', () => {
  it.each([
    ['ASCII', 'Hello', 5],
    ['Latin with accents', 'éè', 4],
    ['Cyrillic', 'при', 6],
    ['Chinese', '中文', 6],
    ['an emoji, as the phone stores it', '\u{1F600}', 6],
    ['NUL', '\u0000', 2],
    ['empty', '', 0],
  ])('counts %s', (_name, text, bytes) => {
    expect(messageByteLength(text)).toBe(bytes)
  })

  it('matches UTF-8 for text inside the Basic Multilingual Plane', () => {
    const text = 'Order é п 中 € 123'
    expect(messageByteLength(text)).toBe(Buffer.byteLength(text, 'utf8'))
  })
})

describe('assertMessageFits', () => {
  it('accepts a message at the limit', () => {
    expect(() => assertMessageFits('a'.repeat(MAX_MESSAGE_BYTES))).not.toThrow()
  })

  it('refuses a message one byte over the limit, naming the field', () => {
    expect.assertions(2)
    try {
      assertMessageFits(
        'a'.repeat(MAX_MESSAGE_BYTES + 1),
        'messages[2].message',
      )
    } catch (e) {
      expect(e.getStatus()).toBe(HttpStatus.BAD_REQUEST)
      expect(e.getResponse()).toEqual({
        success: false,
        error:
          'messages[2].message is 9001 bytes long. The limit is 9000 bytes in UTF-8, where an emoji counts as 6 bytes. Split the text into several messages.',
      })
    }
  })

  it('leaves a value that is not text to the other checks', () => {
    expect(() => assertMessageFits(undefined)).not.toThrow()
  })
})
