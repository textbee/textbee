import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({ signOut }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }))
const loadPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', () => ({ loadPage }))

import CommandMenu from './command-menu'

beforeEach(() => {
  signOut.mockReset()
  loadPage.mockReset()
})

describe('command menu log out', () => {
  it('ends on the login page of this site', async () => {
    // The login library answers with its own site, which is not the app
    signOut.mockResolvedValue({ url: 'https://textbee.dev/login' })
    const onOpenChange = vi.fn()
    render(<CommandMenu open onOpenChange={onOpenChange} />)

    await userEvent.click(await screen.findByRole('option', { name: /Log out/ }))
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/login'))
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('still ends on the login page when signing out fails', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    render(<CommandMenu open onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('option', { name: /Log out/ }))
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/login'))
  })
})
