import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const signOut = vi.hoisted(() => vi.fn())
const useSession = vi.hoisted(() => vi.fn())
vi.mock('next-auth/react', () => ({ signOut, useSession }))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const loadPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', () => ({ loadPage }))

import Logout from './page'

beforeEach(() => {
  signOut.mockReset()
  useSession.mockReset()
  push.mockReset()
  loadPage.mockReset()
})

describe('logout page', () => {
  it('signs out once and ends on the login page of this site', async () => {
    // The login library answers with its own site, which is not the app
    signOut.mockResolvedValue({ url: 'https://textbee.dev' })
    useSession.mockReturnValue({ status: 'authenticated' })
    const { rerender } = render(<Logout />)
    rerender(<Logout />)

    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/login'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith({ redirect: false })
    expect(screen.getByText('Logging out...')).toBeInTheDocument()
  })

  // The expired-login path: a 401 on the dashboard leads here while the
  // login cookie still works. Loading the login page would send the visitor
  // back to the dashboard and round again.
  it('stays put when signing out fails, so the 401 path cannot loop', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    useSession.mockReturnValue({ status: 'authenticated' })
    render(<Logout />)

    expect(
      await screen.findByText('Could not log out. Check your connection and try again.')
    ).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(loadPage).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('tries again on the button and then ends on the login page', async () => {
    signOut.mockRejectedValueOnce(new Error('network down'))
    signOut.mockResolvedValueOnce({ url: 'https://textbee.dev' })
    useSession.mockReturnValue({ status: 'authenticated' })
    render(<Logout />)

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/login'))
    expect(signOut).toHaveBeenCalledTimes(2)
  })

  it('sends a signed-out visitor to the login page without signing out', () => {
    useSession.mockReturnValue({ status: 'unauthenticated' })
    render(<Logout />)
    expect(push).toHaveBeenCalledWith('/login')
    expect(signOut).not.toHaveBeenCalled()
    expect(loadPage).not.toHaveBeenCalled()
  })
})
