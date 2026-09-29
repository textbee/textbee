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
