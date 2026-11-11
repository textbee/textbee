import { describe, expect, it } from 'vitest'
import { suggestEmail } from './email-typo'

const cases: Array<[string, string | null]> = [
  ['bob@gmail.con', 'bob@gmail.com'],
  ['bob@gamil.com', 'bob@gmail.com'],
  ['bob@gmai.com', 'bob@gmail.com'],
  ['bob@gmail.co', 'bob@gmail.com'],
  ['bob@gmial.con', 'bob@gmail.com'],
  ['bob@yahoom.com', 'bob@yahoo.com'],
  ['bob@hormail.com', 'bob@hotmail.com'],
  ['bob@oulook.com', 'bob@outlook.com'],
  ['bob@acme.con', 'bob@acme.com'],
  [' Bob@Gmail.com ', null],
  ['bob@gmx.com', null],
  ['bob@yahoo.fr', null],
  ['bob@foxmail.com', null],
  ['bob@tincloud.com', null],
  ['bob@acme.co', null],
  ['bob@kk.kk', null],
  ['bob@mail.con', 'bob@mail.com'],
  ['bob@ymail.con', 'bob@ymail.com'],
  ['bob@hotmail.con', 'bob@hotmail.com'],
  ['bob@yahoo.con', 'bob@yahoo.com'],
  ['bob@hotmail.co', 'bob@hotmail.com'],
  ['bob@gmail.comm', 'bob@gmail.com'],
  ['bob@gmail.com.br', 'bob@gmail.com'],
  ['bob@mail.gmail.com', null],
  ['bob@live.co.uk', null],
  ['bob@yahoo.co.jp', null],
  ['bob@aon.com', null],
  ['bob@hive.com', null],
  ['bob@icloud.com.cn', null],
  ['bob@proton.com', null],
]

const extraCases: Array<[string, string | null]> = [
  ['bob@gmail.vom', 'bob@gmail.com'],
  ['bob@gmal.com', 'bob@gmail.com'],
  ['bob@googlemail.co', 'bob@googlemail.com'],
  ['bob@student.gmail.edu', null],
  ['Bob@Gamil.com', 'bob@gmail.com'],
]

const malformed = ['', '   ', 'bob', 'bob@', '@gmail.con', 'a@b@gmail.con']

describe('suggestEmail', () => {
  it.each(cases)('%j gives %j', (input, expected) => {
    expect(suggestEmail(input)).toBe(expected)
  })

  it.each(extraCases)('%j gives %j', (input, expected) => {
    expect(suggestEmail(input)).toBe(expected)
  })

  it.each(malformed)('returns null for malformed input %j', (input) => {
    expect(suggestEmail(input)).toBeNull()
  })
})
