import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import AppHeader from './app-header'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const useSession = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
  signOut: vi.fn(),
}))

const session: Session = {
  user: { id: 'user_1', name: 'Test User', email: 'test@example.com' },
  expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
} as Session

const accountMenu = () => screen.queryByRole('button', { name: /T/ })
const logInLink = () => screen.queryAllByRole('link', { name: 'Log in' })

describe('AppHeader session state', () => {
  beforeEach(() => useSession.mockReset())

  // The layout keeps the header mounted, so after an in-app sign in the
  // server prop is still null while the client session is authenticated.
  it('shows the account menu when the client session signed in after render', () => {
    useSession.mockReturnValue({ data: session, status: 'authenticated' })
    render(<AppHeader session={null} />)
    expect(accountMenu()).toBeInTheDocument()
    expect(logInLink()).toHaveLength(0)
  })

  it('shows the signed-out links once the client session signs out', () => {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(<AppHeader session={session} />)
    expect(logInLink().length).toBeGreaterThan(0)
  })

  it('falls back to the server session while the client session loads', () => {
    useSession.mockReturnValue({ data: undefined, status: 'loading' })
    render(<AppHeader session={session} />)
    expect(accountMenu()).toBeInTheDocument()
    expect(logInLink()).toHaveLength(0)
  })
})
