import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageRow } from './message-row'
import SmsDetailsDialog from './sms-details-dialog'
import type { Device } from '@/lib/api'
import type { SmsMessage } from './types'

const OFFICE = {
  _id: 'device_1',
  brand: 'samsung',
  model: 'SM-A515F',
  name: 'Office phone',
  enabled: true,
} as Device

const FAILED: SmsMessage = {
  _id: 'sms_1',
  type: 'SENT',
  status: 'failed',
  recipient: '+15555550123',
  message: 'Hello',
  errorCode: 'GENERIC_FAILURE',
  createdAt: '2026-09-25T10:00:00Z',
  // Populated device as older API builds return it, without the custom name.
  device: { _id: 'device_1', brand: 'samsung', model: 'SM-A515F' } as Device,
}

describe('device labels in message history', () => {
  it('shows the custom name in the details dialog', () => {
    render(
      <SmsDetailsDialog message={FAILED} device={OFFICE} open onOpenChange={vi.fn()} />
    )
    expect(screen.getByText('Office phone (samsung SM-A515F)')).toBeVisible()
  })

  it('falls back to the populated device when the list has none', () => {
    render(<SmsDetailsDialog message={FAILED} open onOpenChange={vi.fn()} />)
    expect(screen.getByText('samsung SM-A515F')).toBeVisible()
  })

  it('labels the row only when given a device label', () => {
    const { rerender } = render(
      <MessageRow message={FAILED} device={OFFICE} onSelect={vi.fn()} />
    )
    expect(screen.queryByText(/Office phone/)).toBeNull()

    rerender(
      <MessageRow
        message={FAILED}
        device={OFFICE}
        deviceLabel='Office phone (samsung SM-A515F)'
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByText('Office phone (samsung SM-A515F)')).toBeVisible()
  })
})
