import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestProviders } from '@/test/render'
import SmsDetailsDialog from './sms-details-dialog'

const failed = (errorCode: string) => ({
  _id: 'm1',
  type: 'SENT' as const,
  status: 'failed',
  recipient: '+15550100',
  message: 'hello',
  errorCode,
  errorMessage: 'SMS permission not granted',
})

describe('SmsDetailsDialog failure help', () => {
  it('links the permission guide for PERMISSION_DENIED', () => {
    render(
      <SmsDetailsDialog message={failed('PERMISSION_DENIED')} open onOpenChange={() => {}} />,
      { wrapper: TestProviders }
    )

    const link = screen.getByRole('link', { name: /how to fix it/i })
    expect(link.getAttribute('href')).toContain('utm_source=message_details')
  })

  it('shows no permission help for other failures', () => {
    render(<SmsDetailsDialog message={failed('1')} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

    expect(screen.queryByRole('link', { name: /how to fix it/i })).toBeNull()
  })
})

describe('SmsDetailsDialog SIM', () => {
  const sent = {
    _id: 'm2',
    type: 'SENT' as const,
    status: 'sent',
    recipient: '+15550100',
    message: 'hello',
  }
  const open = (message: Parameters<typeof SmsDetailsDialog>[0]['message']) =>
    render(<SmsDetailsDialog message={message} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

  it('shows the SIM the phone reported', () => {
    open({ ...sent, simSubscriptionId: 19, simUsed: { subscriptionId: 19, slotIndex: 1 } })

    expect(screen.getByText('Sent from SIM 2 (ID 19)')).toBeTruthy()
    expect(screen.queryByText(/but the phone used/)).toBeNull()
  })

  it('shows no SIM when the app did not report one', () => {
    open({ ...sent, simSubscriptionId: 19 })

    expect(screen.queryByText(/Sent from|Received on/)).toBeNull()
  })

  it('explains when the phone used a different SIM than requested', () => {
    open({ ...sent, simSubscriptionId: 18, simUsed: { subscriptionId: 17, slotIndex: 0 } })

    expect(screen.getByText(/asked for SIM ID 18/)).toBeTruthy()
    expect(screen.getByText(/but the phone used SIM 1/)).toBeTruthy()
  })
})
