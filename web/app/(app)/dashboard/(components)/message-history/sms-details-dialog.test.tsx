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

describe('SmsDetailsDialog failure box', () => {
  const base = { _id: 'm2', type: 'SENT' as const, recipient: '+15550101', message: 'hi' }

  it('does not call a delivered message failed', () => {
    render(
      <SmsDetailsDialog
        message={{
          ...base,
          status: 'delivered',
          errorMessage: 'Status update timeout - no response from device after dispatch',
        }}
        open
        onOpenChange={() => {}}
      />,
      { wrapper: TestProviders }
    )

    expect(screen.queryByText('Delivery failed')).toBeNull()
  })

  it('lists earlier failures of a delivered message', () => {
    render(
      <SmsDetailsDialog
        message={{
          ...base,
          status: 'delivered',
          issueHistory: [
            { code: 'FCM_SEND_TIMEOUT', at: '2026-10-01T10:00:00.000Z', source: 'push' },
          ],
        }}
        open
        onOpenChange={() => {}}
      />,
      { wrapper: TestProviders }
    )

    expect(screen.getByText('1 failure recorded')).toBeTruthy()
    expect(screen.getByText(/FCM_SEND_TIMEOUT/)).toBeTruthy()
  })

  it('labels an unconfirmed delivery report on a sent message', () => {
    render(
      <SmsDetailsDialog
        message={{
          ...base,
          status: 'sent',
          issueHistory: [
            {
              code: '0',
              message: 'Delivery report was canceled',
              at: '2026-10-01T10:00:00.000Z',
              source: 'device',
              deliveryReport: true,
            },
          ],
        }}
        open
        onOpenChange={() => {}}
      />,
      { wrapper: TestProviders }
    )

    expect(screen.getAllByText(/Delivery report not confirmed/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/failures? recorded/)).toBeNull()
    expect(screen.queryByText('Delivery failed')).toBeNull()
  })

  it('does not file a delivery report under other failures', () => {
    render(
      <SmsDetailsDialog
        message={{
          ...base,
          status: 'failed',
          errorCode: '1',
          failedAt: '2026-10-01T10:05:00.000Z',
          issueHistory: [
            { code: '0', at: '2026-10-01T10:00:00.000Z', source: 'device', deliveryReport: true },
            { code: '1', at: '2026-10-01T10:05:00.000Z', source: 'device' },
          ],
        }}
        open
        onOpenChange={() => {}}
      />,
      { wrapper: TestProviders }
    )

    expect(screen.queryByText('Other failures')).toBeNull()
    expect(screen.getByText('Delivery reports not confirmed')).toBeTruthy()
  })

  it('explains an unknown status as a missing report', () => {
    render(
      <SmsDetailsDialog message={{ ...base, status: 'unknown' }} open onOpenChange={() => {}} />,
      { wrapper: TestProviders }
    )

    expect(screen.getByText(/No status report from the phone yet/)).toBeTruthy()
    expect(screen.queryByText('Delivery failed')).toBeNull()
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

  it('shows the carrier when the phone reported it', () => {
    open({
      ...sent,
      simUsed: { subscriptionId: 19, slotIndex: 1, carrierName: 'Smart' },
    })

    expect(screen.getByText('Sent from SIM 2 · Smart (ID 19)')).toBeTruthy()
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

describe('SmsDetailsDialog reply', () => {
  const received = (sender: string) => ({
    _id: 'm3',
    type: 'RECEIVED' as const,
    status: 'received',
    sender,
    message: 'Your code is 1234',
  })

  it('allows a reply to a short code', () => {
    render(<SmsDetailsDialog message={received('605')} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

    expect(screen.getByRole('button', { name: /reply/i }).hasAttribute('disabled')).toBe(false)
  })

  it('blocks a reply to a sender name', () => {
    render(<SmsDetailsDialog message={received('MYBANK')} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

    expect(screen.getByRole('button', { name: /reply/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/sender names cannot receive sms/i)).toBeTruthy()
  })

  it('blocks a reply to a value the send form rejects', () => {
    render(<SmsDetailsDialog message={received('12')} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

    expect(screen.getByRole('button', { name: /reply/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/not a phone number or short code/i)).toBeTruthy()
  })
})
