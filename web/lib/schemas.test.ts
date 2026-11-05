import { describe, expect, it } from 'vitest'
import { sendSmsSchema } from './schemas'

const valid = { deviceId: 'device_1', recipients: ['+15555550100'], message: 'hi' }

const deviceIdError = (deviceId: unknown) => {
  const result = sendSmsSchema.safeParse({ ...valid, deviceId })
  return result.success
    ? undefined
    : result.error.issues.find((issue) => issue.path[0] === 'deviceId')?.message
}

describe('sendSmsSchema deviceId', () => {
  it('asks for a device when none is selected', () => {
    // The form starts with deviceId undefined.
    expect(deviceIdError(undefined)).toBe('Please select a device')
  })

  it('asks for a device when the value is empty', () => {
    expect(deviceIdError('')).toBe('Please select a device')
  })

  it('accepts a selected device', () => {
    expect(sendSmsSchema.safeParse(valid).success).toBe(true)
  })
})

describe('sendSmsSchema recipients', () => {
  const accepts = (recipient: string) =>
    sendSmsSchema.safeParse({ ...valid, recipients: [recipient] }).success

  it('accepts international numbers, local numbers and short codes', () => {
    expect(accepts('+15555550100')).toBe(true)
    expect(accepts('5555550100')).toBe(true)
    expect(accepts('605')).toBe(true)
  })

  it('accepts the longest E.164 number', () => {
    expect(accepts('+123456789012345')).toBe(true)
  })

  it('rejects sender names and impossible lengths', () => {
    expect(accepts('MYBANK')).toBe(false)
    expect(accepts('12')).toBe(false)
    expect(accepts('1234567890123456')).toBe(false)
  })
})
