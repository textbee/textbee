import { pickDeviceUpdateFields, pickDeviceWritableFields } from './gateway.dto'

describe('pickDeviceWritableFields', () => {
  it('keeps every field a device client legitimately sends', () => {
    const input = {
      enabled: true,
      fcmToken: 'token',
      brand: 'samsung',
      manufacturer: 'samsung',
      model: 'SM-S928B',
      name: 'samsung SM-S928B',
      serial: 'abc',
      buildId: 'BP2A.250605.031.A3',
      os: 'Android',
      osVersion: '16',
      osApiLevel: 36,
      osBuildFingerprint: 'samsung/e3qxxx/e3q:16/BP2A.250605.031.A3/x:user/release-keys',
      appVersionName: '2.8.0',
      appVersionCode: 18,
      simInfo: { lastUpdated: 1, sims: [] },
    } as any

    expect(pickDeviceWritableFields(input)).toEqual(input)
  })

  // There is no global ValidationPipe, so the body reaches `$set` as-is. These
  // are device fields a client must never be able to write on its own device.
  it.each([
    ['user', '507f1f77bcf86cd799439011'],
    ['sentSMSCount', 0],
    ['receivedSMSCount', 999],
    ['isDefault', true],
    ['osVersionSource', 'reported'],
    ['heartbeatEnabled', false],
    ['smsSendDelaySeconds', 0],
    ['lastHeartbeat', new Date()],
    ['_id', 'deadbeefdeadbeefdeadbeef'],
    ['simNumbers', [{ slotIndex: 0, phoneNumber: '+15555550123' }]],
  ])('drops a client-sent %s', (field, value) => {
    const picked = pickDeviceWritableFields({
      model: 'Pixel 6',
      [field]: value,
    } as any)

    expect(picked).not.toHaveProperty(field)
    expect(picked.model).toBe('Pixel 6')
  })

  it('omits absent fields rather than setting them undefined', () => {
    // An explicit undefined would still be a key, and Mongoose only drops
    // undefined from $set by convention, so keep the object minimal.
    expect(pickDeviceWritableFields({ model: 'Pixel 6' } as any)).toEqual({
      model: 'Pixel 6',
    })
  })

  it('tolerates an empty or missing body', () => {
    expect(pickDeviceWritableFields({} as any)).toEqual({})
    expect(pickDeviceWritableFields(undefined as any)).toEqual({})
  })
})

describe('pickDeviceUpdateFields', () => {
  it('adds simNumbers to the device fields', () => {
    const simNumbers = [{ slotIndex: 1, phoneNumber: '' }]
    expect(
      pickDeviceUpdateFields({ name: 'Office', simNumbers, user: 'x' } as any),
    ).toEqual({ name: 'Office', simNumbers })
  })

  it('leaves simNumbers out when the body has none', () => {
    expect(pickDeviceUpdateFields({ fcmToken: 'token' } as any)).toEqual({
      fcmToken: 'token',
    })
    expect(pickDeviceUpdateFields(undefined as any)).toEqual({})
    expect(pickDeviceUpdateFields({ simNumbers: null } as any)).toEqual({})
  })

  it('still drops fields no client may write', () => {
    expect(
      pickDeviceUpdateFields({ isDefault: true, sentSMSCount: 0 } as any),
    ).toEqual({})
  })
})
