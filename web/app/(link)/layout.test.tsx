import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@/test/render'

const getServerSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import LinkLayout from './layout'

async function renderLayout() {
  render(await LinkLayout({ children: <p>Page</p> }))
  return screen.getByRole('banner')
}

describe('link page frame', () => {
  it('leads a signed-in user back to the dashboard', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
    const header = await renderLayout()

    expect(within(header).getByRole('link', { name: /textbee/ })).toHaveAttribute(
      'href',
      '/dashboard'
    )
    expect(
      within(header).getByRole('link', { name: 'Back to dashboard' })
    ).toHaveAttribute('href', '/dashboard')
  })

  it('leads a signed-out visitor to the login page, with no back link', async () => {
    getServerSession.mockResolvedValue(null)
    const header = await renderLayout()

    expect(within(header).getByRole('link', { name: /textbee/ })).toHaveAttribute(
      'href',
      '/login'
    )
    expect(
      within(header).queryByRole('link', { name: 'Back to dashboard' })
    ).not.toBeInTheDocument()
  })

  it('keeps the footer to privacy and terms', async () => {
    getServerSession.mockResolvedValue(null)
    await renderLayout()
    const footer = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(footer).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Privacy',
      'Terms',
    ])
  })

  describe('inside a frame', () => {
    afterEach(() => vi.restoreAllMocks())

    it('shows the logo with no link and no back link', async () => {
      vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
      getServerSession.mockResolvedValue({ user: { email: 'jane@example.com' } })
      const header = await renderLayout()

      expect(within(header).getByText('text')).toBeInTheDocument()
      expect(within(header).queryAllByRole('link')).toHaveLength(0)
    })
  })
})
