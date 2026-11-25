import { describe, expect, it } from 'vitest'
import { render, screen, userEvent, within } from '@/test/render'
import WebhookDeliveriesTable from './deliveries-table'

const smsData = {
  _id: 'sms-1',
  message: 'hello',
  type: 'SENT',
  status: 'DELIVERED',
}

const rows = [
  { event: 'full', payload: { a: 1 }, smsData },
  { event: 'payload-only', payload: { a: 2 } },
  { event: 'empty' },
  { event: 'sms-only', smsData },
]

const getRow = (event: string) =>
  screen.getByText(event).closest('tr') as HTMLTableRowElement

const modalOpen = () => screen.queryByRole('dialog') !== null

describe('WebhookDeliveriesTable details', () => {
  it('names the action button and enables it only when the modal can open', () => {
    render(<WebhookDeliveriesTable data={rows as any} />)
    const buttons = screen.getAllByRole('button', { name: 'View payload' })
    expect(buttons).toHaveLength(4)
    expect(buttons[0]).toBeEnabled()
    expect(buttons[1]).toBeDisabled()
    expect(buttons[2]).toBeDisabled()
    expect(buttons[3]).toBeDisabled()
  })

  it('opens the modal from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup()
    render(<WebhookDeliveriesTable data={rows as any} />)
    const row = getRow('full')
    expect(row).toHaveAttribute('tabindex', '0')

    row.focus()
    await user.keyboard('{Enter}')
    expect(modalOpen()).toBe(true)
    await user.keyboard('{Escape}')
    expect(modalOpen()).toBe(false)

    row.focus()
    await user.keyboard(' ')
    expect(modalOpen()).toBe(true)
  })

  it('opens the modal when the button is clicked', async () => {
    const user = userEvent.setup()
    render(<WebhookDeliveriesTable data={rows as any} />)
    await user.click(
      within(getRow('full')).getByRole('button', { name: 'View payload' })
    )
    expect(modalOpen()).toBe(true)
  })

  it('does not open or focus rows without both payload and sms data', async () => {
    const user = userEvent.setup()
    render(<WebhookDeliveriesTable data={rows as any} />)
    for (const event of ['payload-only', 'empty', 'sms-only']) {
      const row = getRow(event)
      expect(row).not.toHaveAttribute('tabindex')
      expect(row).toHaveAttribute('aria-disabled', 'true')
      row.focus()
      await user.keyboard('{Enter}')
      await user.click(row)
      expect(modalOpen()).toBe(false)
    }
  })
})
