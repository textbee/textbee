import { HttpException } from '@nestjs/common'
import { assertValidRecipients, findInvalidRecipients } from './recipients'

describe('findInvalidRecipients', () => {
  it('accepts international numbers, local numbers and short codes', () => {
    expect(
      findInvalidRecipients([
        '+15555550100',
        '(555) 555-0101',
        '605',
        '12345',
        '555ー555ー0101',
      ]),
    ).toEqual([])
  })

  it('flags sender names, emails, placeholders and stray letters', () => {
    expect(
      findInvalidRecipients([
        'MYBANK',
        'name@example.com',
        '+1XXXXXXXXXX',
        '+1555o550100',
        'Банк',
      ]),
    ).toEqual([
      'MYBANK',
      'name@example.com',
      '+1XXXXXXXXXX',
      '+1555o550100',
      'Банк',
    ])
  })

  it('flags values with no digit', () => {
    expect(findInvalidRecipients(['', '+', '!!!'])).toEqual(['', '+', '!!!'])
  })

  it('flags values that are not strings', () => {
    expect(findInvalidRecipients([15555550100, null])).toEqual([
      '15555550100',
      'null',
    ])
  })
})

describe('assertValidRecipients', () => {
  it('passes valid recipients', () => {
    expect(() => assertValidRecipients(['+15555550100', '605'])).not.toThrow()
  })

  it('names the first five invalid recipients and counts the rest', () => {
    const invalid = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    try {
      assertValidRecipients(invalid)
      throw new Error('expected a throw')
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException)
      const { error } = (e as HttpException).getResponse() as { error: string }
      expect(error).toContain('"a", "b", "c", "d", "e" and 2 more')
      expect((e as HttpException).getStatus()).toBe(400)
    }
  })
})
