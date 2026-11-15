import { Types } from 'mongoose'
import { apiKeyUsageUpdate } from './api-key-usage'

describe('apiKeyUsageUpdate', () => {
  const keyId = new Types.ObjectId()

  it('records the key on a device that has none yet', () => {
    const update = apiKeyUsageUpdate({}, keyId)

    expect(update.apiKey).toBeInstanceOf(Types.ObjectId)
    expect(String(update.apiKey)).toBe(String(keyId))
    expect(Object.keys(update)).toEqual(['apiKey'])
  })

  it('records nothing when the same key is stored', () => {
    expect(apiKeyUsageUpdate({ apiKey: keyId }, keyId)).toEqual({})
  })

  it('compares a key given as a string with the stored id', () => {
    expect(apiKeyUsageUpdate({ apiKey: keyId }, String(keyId))).toEqual({})
  })

  it('records a different key', () => {
    const otherKeyId = new Types.ObjectId()

    expect(
      String(apiKeyUsageUpdate({ apiKey: keyId }, otherKeyId).apiKey),
    ).toBe(String(otherKeyId))
  })

  it.each([undefined, null, '', 'not-an-id'])(
    'records nothing for a request without a valid key id (%p)',
    (apiKeyId) => {
      expect(apiKeyUsageUpdate({}, apiKeyId as any)).toEqual({})
    },
  )
})
