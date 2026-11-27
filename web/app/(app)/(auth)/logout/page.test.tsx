import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

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

  it('still ends on the login page when signing out fails', async () => {
    signOut.mockRejectedValue(new Error('network down'))
    useSession.mockReturnValue({ status: 'authenticated' })
    render(<Logout />)
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/login'))
  })

  it('sends a signed-out visitor to the login page without signing out', () => {
    useSession.mockReturnValue({ status: 'unauthenticated' })
    render(<Logout />)
    expect(push).toHaveBeenCalledWith('/login')
    expect(signOut).not.toHaveBeenCalled()
    expect(loadPage).not.toHaveBeenCalled()
  })
})
