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

  it('links the permission guide when only the catalog name says so', () => {
    render(
      <SmsDetailsDialog
        message={{ ...failed('9'), errorName: 'PERMISSION_DENIED' }}
        open
        onOpenChange={() => {}}
      />,
      { wrapper: TestProviders }
    )

    expect(screen.getByRole('link', { name: /how to fix it/i })).toBeTruthy()
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

    expect(screen.queryByText('Not sent')).toBeNull()
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

    expect(screen.getByText('Attempts before it was sent')).toBeTruthy()
    expect(screen.getByText(/Push service · code FCM_SEND_TIMEOUT/)).toBeTruthy()
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
    expect(screen.queryByText('Attempts before it was sent')).toBeNull()
    expect(screen.queryByText('Not sent')).toBeNull()
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

    expect(screen.queryByText('Earlier failures')).toBeNull()
    expect(screen.getByText('Delivery reports')).toBeTruthy()
  })

  it('explains an unknown status as a missing report', () => {
    render(
      <SmsDetailsDialog message={{ ...base, status: 'unknown' }} open onOpenChange={() => {}} />,
      { wrapper: TestProviders }
    )

    expect(screen.getByText(/No status report from the phone yet/)).toBeTruthy()
    expect(screen.queryByText('Not sent')).toBeNull()
  })
})

describe('SmsDetailsDialog not sent box', () => {
  const base = { _id: 'm4', type: 'SENT' as const, recipient: '605', message: 'A' }
  const open = (message: Parameters<typeof SmsDetailsDialog>[0]['message']) =>
    render(<SmsDetailsDialog message={message} open onOpenChange={() => {}} />, {
      wrapper: TestProviders,
    })

  it('shows the catalog text, the meta line, the docs link and the phone text', () => {
    open({
      ...base,
      status: 'failed',
      errorCode: '7',
      errorName: 'SHORT_CODE_CANCELLED',
      errorMessage: 'The phone asked to allow this short code, and someone tapped Cancel.',
      deviceMessage: 'Short code not allowed on this carrier.',
      docsUrl: 'https://textbee.dev/docs/short-codes',
      failedAt: '2026-11-05T09:00:00.000Z',
      issueHistory: [{ code: '7', at: '2026-11-05T09:00:00.000Z', source: 'device' }],
    })

    expect(screen.getByText('Not sent')).toBeTruthy()
    expect(screen.getByText(/someone tapped Cancel/)).toBeTruthy()
    expect(screen.getByText('Phone · code 7 · SHORT_CODE_CANCELLED')).toBeTruthy()
    const link = screen.getByRole('link', { name: /how to fix this/i })
    expect(link.getAttribute('href')).toBe('https://textbee.dev/docs/short-codes')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('Text from the phone').closest('details')?.open).toBe(false)
    expect(screen.getByText('Short code not allowed on this carrier.')).toBeTruthy()
    // the current failure is in the box, not repeated below it
    expect(screen.queryByText('Earlier failures')).toBeNull()
  })

  it('renders an old API failure without catalog fields', () => {
    open({ ...base, status: 'failed', errorCode: '7', errorMessage: 'Short code not allowed.' })

    expect(screen.getByText('Not sent')).toBeTruthy()
    expect(screen.getByText('Short code not allowed.')).toBeTruthy()
    expect(screen.getByText('code 7')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('Text from the phone')).toBeNull()
  })

  it('lists earlier failures as a timeline with expandable entries', () => {
    open({
      ...base,
      status: 'failed',
      errorCode: '7',
      errorMessage: 'Cancelled.',
      failedAt: '2026-11-05T09:05:00.000Z',
      issueHistory: [
        {
          code: '4',
          message: 'The phone had no cellular service. Check signal and try again.',
          deviceMessage: 'No cellular service.',
          at: '2026-11-05T09:01:40.000Z',
          source: 'device',
        },
        { code: '7', at: '2026-11-05T09:05:00.000Z', source: 'device' },
      ],
    })

    expect(screen.getByText('Earlier failures')).toBeTruthy()
    expect(screen.getByText('The phone had no cellular service.')).toBeTruthy()
    const full = screen.getByText(
      'The phone had no cellular service. Check signal and try again.'
    )
    expect(full.closest('details')?.open).toBe(false)
    expect(screen.getByText('Text from the phone: No cellular service.')).toBeTruthy()
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
