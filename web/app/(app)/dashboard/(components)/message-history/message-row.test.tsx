import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDevices } from '@/test/fixtures'
import type { Device } from '@/lib/api'
import { MessageRow } from './message-row'
import type { SmsMessage } from './types'

const device = mockDevices[0] as unknown as Device
const sent = (fields: Partial<SmsMessage>): SmsMessage => ({
  _id: 'm1',
  type: 'SENT',
  recipient: '+15555550142',
  message: 'Your order has shipped',
  createdAt: '2026-11-05T09:00:00.000Z',
  ...fields,
})
const failure = (minute: number) => ({
  code: '4',
  at: `2026-11-05T09:0${minute}:00.000Z`,
  source: 'device' as const,
})

function renderRow(message: SmsMessage, onSelect = vi.fn()) {
  render(<MessageRow message={message} device={device} onSelect={onSelect} />)
  return screen.getByRole('button')
}

describe('MessageRow reason line', () => {
  it('shows the first sentence of why a failed message was not sent', () => {
    const row = renderRow(
      sent({
        status: 'failed',
        errorMessage: 'The phone had no cellular service. Check signal and try again.',
      })
    )

    const reason = within(row).getByText('The phone had no cellular service.')
    expect(reason.className).toContain('truncate')
    expect(reason.className).toContain('text-destructive')
    expect(within(row).queryByText(/Check signal/)).toBeNull()
  })

  it('shows no reason on a delivered message with leftover error text', () => {
    const row = renderRow(sent({ status: 'delivered', errorMessage: 'Old error.' }))

    expect(within(row).queryByText('Old error.')).toBeNull()
  })
})

describe('MessageRow retry icon', () => {
  it('marks a delivered message that failed before it was sent', () => {
    const row = renderRow(sent({ status: 'delivered', issueHistory: [failure(1)] }))

    expect(row.textContent).toContain('Delivered, failed once before it was sent')
    // The icon adds nothing interactive inside the row button
    const badge = within(row).getByText('Delivered')
    expect(badge.querySelectorAll('button, a, [tabindex]')).toHaveLength(0)
  })

  it('counts several failures', () => {
    const row = renderRow(sent({ status: 'sent', issueHistory: [failure(1), failure(2)] }))

    expect(row.textContent).toContain('Sent, failed 2 times before it was sent')
  })

  it('does not mark a message whose only entries are delivery reports', () => {
    const row = renderRow(
      sent({ status: 'sent', issueHistory: [{ ...failure(1), deliveryReport: true }] })
    )

    expect(row.textContent).not.toMatch(/failed/i)
  })

  it('shows a tooltip on hover and still opens the message on click', async () => {
    const onSelect = vi.fn()
    const message = sent({ status: 'delivered', issueHistory: [failure(1)] })
    const row = renderRow(message, onSelect)
    const user = userEvent.setup()

    const icon = row.querySelector('.lucide-rotate-ccw')?.parentElement as HTMLElement
    await user.hover(icon)
    expect(
      (await screen.findAllByText(
        'Failed once before it was sent. Open the message to see what happened.'
      )).length
    ).toBeGreaterThan(0)

    await user.click(icon)
    expect(onSelect).toHaveBeenCalledWith(message)
  })
})
