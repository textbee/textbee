import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({ signOut }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next-themes', () => ({ useTheme: () => ({ setTheme: vi.fn() }) }))
const loadPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', () => ({ loadPage }))
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ toast }))

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

  it('stays on the page with an error toast when signing out fails', async () => {
    toast.mockReset()
    signOut.mockRejectedValue(new Error('network down'))
    render(<CommandMenu open onOpenChange={vi.fn()} />)
    await userEvent.click(await screen.findByRole('option', { name: /Log out/ }))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        variant: 'destructive',
        title: 'Could not log out. Check your connection and try again.',
      })
    )
    expect(loadPage).not.toHaveBeenCalled()
  })

  it('turns the item off while the sign-out runs and on again after a failure', async () => {
    toast.mockReset()
    let fail = (_error: Error) => {}
    signOut.mockReturnValue(
      new Promise((_resolve, reject) => {
        fail = reject
      })
    )
    render(<CommandMenu open onOpenChange={vi.fn()} />)
    const item = await screen.findByRole('option', { name: /Log out/ })
    await userEvent.click(item)
    await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'true'))
    await userEvent.click(item)
    expect(signOut).toHaveBeenCalledTimes(1)

    fail(new Error('network down'))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    await waitFor(() => expect(item).toHaveAttribute('aria-disabled', 'false'))
    expect(loadPage).not.toHaveBeenCalled()
  })
})
