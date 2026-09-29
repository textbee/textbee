import { describe, expect, it } from 'vitest'
import { formatDeviceName } from './utils'

describe('formatDeviceName', () => {
  it('leads with the custom name and keeps the hardware in brackets', () => {
    expect(
      formatDeviceName({ brand: 'samsung', model: 'SM-A515F', name: 'Office phone' })
    ).toBe('Office phone (samsung SM-A515F)')
  })

  it('shows only the hardware when the name is the default brand and model', () => {
    expect(
      formatDeviceName({ brand: 'samsung', model: 'SM-A515F', name: 'samsung SM-A515F' })
    ).toBe('samsung SM-A515F')
  })

  it('ignores a blank or missing name', () => {
    expect(formatDeviceName({ brand: 'Google', model: 'Pixel 8', name: '  ' })).toBe(
      'Google Pixel 8'
    )
    expect(formatDeviceName({ brand: 'Google', model: 'Pixel 8', name: null })).toBe(
      'Google Pixel 8'
    )
  })

  it('shows the custom name alone when brand and model are missing', () => {
    expect(formatDeviceName({ name: 'Office phone' })).toBe('Office phone')
  })
})
