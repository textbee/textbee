import { getBool, getNumber } from './config-coerce'

// Fake ConfigService: returns whatever env-like map holds (always strings, like real env).
const fake = (map: Record<string, unknown>) =>
  ({ get: (k: string) => map[k] } as any)

describe('config-coerce', () => {
  it('getBool coerces string "false" to false (the bug this fixes)', () => {
    expect(getBool(fake({ USE_SMS_QUEUE: 'false' }), 'USE_SMS_QUEUE', true)).toBe(
      false,
    )
    expect(getBool(fake({ USE_SMS_QUEUE: 'true' }), 'USE_SMS_QUEUE', false)).toBe(
      true,
    )
    expect(getBool(fake({}), 'USE_SMS_QUEUE', false)).toBe(false)
    expect(getBool(fake({ X: true }), 'X', false)).toBe(true)
  })

  it('getNumber returns a real number, not a string', () => {
    const n = getNumber(fake({ MAX: '100' }), 'MAX', 5)
    expect(n).toBe(100)
    expect(typeof n).toBe('number')
    expect(getNumber(fake({}), 'MAX', 5)).toBe(5)
    expect(getNumber(fake({ MAX: 'nope' }), 'MAX', 5)).toBe(5)
  })
})
