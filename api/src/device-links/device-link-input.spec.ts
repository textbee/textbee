import {
  CODE_ALPHABET,
  displayCode,
  maskEmail,
  newCode,
  newPollToken,
  normalizeCode,
  parseApproveBody,
  parseCreateBody,
  parseLinkHeaders,
  parsePollToken,
  parseTesters,
  serverHash,
  sha256,
} from './device-link-input'

const body = {
  deviceName: 'Google Pixel 8',
  brand: 'Google',
  manufacturer: 'Google',
  model: 'Pixel 8',
  appVersionCode: 23,
  appVersionName: '2.11.0',
  osApiLevel: 36,
  locale: 'en-US',
  deviceId: '665f1c2ab3d4e5f6a7b8c9d0',
  installerPackage: 'com.android.vending',
  playServicesStatus: 0,
  hasStoredKey: true,
  keyRejected: false,
  clientProtocol: 1,
}

describe('parseCreateBody', () => {
  it('reads every field of the documented body', () => {
    expect(parseCreateBody(body)).toEqual(body)
  })

  it('requires the four required fields', () => {
    for (const field of ['deviceName', 'brand', 'model', 'appVersionCode']) {
      const { [field]: _left, ...rest } = body as Record<string, unknown>
      expect(parseCreateBody(rest)).toBeNull()
    }
  })

  it.each([
    ['deviceName', ''],
    ['deviceName', '   '],
    ['deviceName', 'x'.repeat(61)],
    ['deviceName', 'Pixel\u0000'],
    ['brand', 5],
    ['model', { name: 'Pixel' }],
    ['appVersionCode', 0],
    ['appVersionCode', 22.5],
    ['appVersionCode', '23'],
  ])('refuses %s = %p', (field, value) => {
    expect(parseCreateBody({ ...body, [field]: value })).toBeNull()
  })

  it('trims names and accepts 60 characters', () => {
    const input = parseCreateBody({ ...body, deviceName: `  ${'x'.repeat(60)}  ` })
    expect(input?.deviceName).toBe('x'.repeat(60))
  })

  it.each([
    ['deviceId', 'abc'],
    ['deviceId', 'zz5f1c2ab3d4e5f6a7b8c9d0'],
    ['manufacturer', 'x'.repeat(61)],
    ['osApiLevel', -1],
    ['locale', 'en US'],
    ['installerPackage', 'not a package'],
    ['hasStoredKey', 'true'],
    ['clientProtocol', 0],
  ])('drops a bad optional %s', (field, value) => {
    const input = parseCreateBody({ ...body, [field]: value })
    expect(input).not.toBeNull()
    expect(input).not.toHaveProperty(field)
  })

  it('ignores fields it does not know', () => {
    expect(parseCreateBody({ ...body, user: 'x', status: 'approved' })).toEqual(body)
  })

  it.each([null, 'text', [body]])('refuses a body that is not an object: %p', (value) => {
    expect(parseCreateBody(value)).toBeNull()
  })
})

describe('parseLinkHeaders', () => {
  it('reads and trims the three headers', () => {
    expect(
      parseLinkHeaders({ 'x-install-id': ' abc ', 'x-phone-id': 'p1', 'x-app-signer': 's1' }),
    ).toEqual({ installId: 'abc', phoneId: 'p1', phoneSigner: 's1' })
  })

  it('treats empty, long and non-printable values as absent', () => {
    expect(
      parseLinkHeaders({ 'x-install-id': '', 'x-phone-id': 'x'.repeat(65), 'x-app-signer': 'a b' }),
    ).toEqual({})
    expect(parseLinkHeaders({ 'x-phone-id': 'x'.repeat(64) })).toEqual({ phoneId: 'x'.repeat(64) })
    expect(parseLinkHeaders(undefined)).toEqual({})
  })
})

describe('codes and tokens', () => {
  it('makes 8 characters from the alphabet without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode()
      expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{8}$`))
      expect(code).not.toMatch(/[01ILO]/)
    }
  })

  it('accepts a code with or without the hyphen, in any letter case', () => {
    expect(normalizeCode('K7QX-2M9P')).toBe('K7QX2M9P')
    expect(normalizeCode('k7qx2m9p')).toBe('K7QX2M9P')
    expect(normalizeCode(' k7qx-2m9p ')).toBe('K7QX2M9P')
    expect(displayCode('K7QX2M9P')).toBe('K7QX-2M9P')
  })

  it.each(['K7QX-2M9', 'K7QX-2M9P1', 'K0QX-2M9P', 'abc', '', 5, null])(
    'refuses %p as a code',
    (value) => {
      expect(normalizeCode(value)).toBeUndefined()
    },
  )

  it('makes a poll token of 43 base64url characters and reads it back', () => {
    const token = newPollToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(parsePollToken({ pollToken: token })).toBe(token)
    expect(parsePollToken({ pollToken: 'short' })).toBeUndefined()
    expect(parsePollToken(null)).toBeUndefined()
  })

  it('hashes with SHA-256 and with a server secret', () => {
    expect(sha256('a')).toHaveLength(64)
    const before = process.env.DEVICE_LINK_SECRET
    process.env.DEVICE_LINK_SECRET = 'one'
    const first = serverHash('net', '203.0.113.5')
    process.env.DEVICE_LINK_SECRET = 'two'
    expect(serverHash('net', '203.0.113.5')).not.toBe(first)
    expect(serverHash('phone', '203.0.113.5')).not.toBe(serverHash('net', '203.0.113.5'))
    process.env.DEVICE_LINK_SECRET = before
  })
})

describe('parseApproveBody', () => {
  it('reads both actions', () => {
    expect(parseApproveBody({ action: 'new', name: ' Shop phone ' })).toEqual({
      action: 'new',
      name: 'Shop phone',
    })
    expect(parseApproveBody({ action: 'new' })).toEqual({ action: 'new' })
    expect(
      parseApproveBody({ action: 'reconnect', deviceId: '665F1C2AB3D4E5F6A7B8C9D0' }),
    ).toEqual({ action: 'reconnect', deviceId: '665f1c2ab3d4e5f6a7b8c9d0' })
  })

  it('reads the typed code in any spelling', () => {
    expect(parseApproveBody({ action: 'new', typedCode: 'k7qx-2m9p' })).toEqual({
      action: 'new',
      typedCode: 'K7QX2M9P',
    })
    // Kept as a value that never matches, so a bad typed code is a mismatch
    expect(parseApproveBody({ action: 'new', typedCode: 'abc' })).toEqual({
      action: 'new',
      typedCode: '',
    })
  })

  it('keeps makeDefault only when it is true and the action is new', () => {
    expect(parseApproveBody({ action: 'new', makeDefault: true })).toEqual({
      action: 'new',
      makeDefault: true,
    })
    expect(parseApproveBody({ action: 'new', name: 'Shop phone', makeDefault: true })).toEqual({
      action: 'new',
      name: 'Shop phone',
      makeDefault: true,
    })
    expect(parseApproveBody({ action: 'new', makeDefault: false })).toEqual({ action: 'new' })
    expect(parseApproveBody({ action: 'new', makeDefault: null })).toEqual({ action: 'new' })
    expect(
      parseApproveBody({ action: 'reconnect', deviceId: '665f1c2ab3d4e5f6a7b8c9d0', makeDefault: true }),
    ).toEqual({ action: 'reconnect', deviceId: '665f1c2ab3d4e5f6a7b8c9d0' })
  })

  it.each([
    null,
    {},
    { action: 'delete' },
    { action: 'new', makeDefault: 'true' },
    { action: 'new', makeDefault: 1 },
    { action: 'reconnect', deviceId: '665f1c2ab3d4e5f6a7b8c9d0', makeDefault: 'yes' },
    { action: 'new', name: '' },
    { action: 'new', name: 'x'.repeat(61) },
    { action: 'reconnect' },
    { action: 'reconnect', deviceId: 'abc' },
  ])('refuses %p', (value) => {
    expect(parseApproveBody(value)).toBeNull()
  })
})

describe('parseTesters', () => {
  it('keeps only 24 character ids', () => {
    expect([
      ...parseTesters(' 665f1c2ab3d4e5f6a7b8c9d0 ,abc,,665F1C2AB3D4E5F6A7B8C9D1'),
    ]).toEqual(['665f1c2ab3d4e5f6a7b8c9d0', '665f1c2ab3d4e5f6a7b8c9d1'])
    expect(parseTesters('').size).toBe(0)
    expect(parseTesters(undefined).size).toBe(0)
  })
})

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane@example.com')).toBe('j***@example.com')
    expect(maskEmail(undefined)).toBe('')
  })
})
