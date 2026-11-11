import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from 'next-auth'
import AppHeader from './app-header'
import { OPEN_SEARCH_EVENT } from '@/lib/constants'

const pathname = vi.fn(() => '/dashboard')
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname(),
}))

const useSession = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
  signOut: vi.fn(),
}))

const useCurrentUser = vi.fn((_opts?: { enabled?: boolean }) => ({
  data: undefined as { email: string } | undefined,
}))
vi.mock('@/lib/api', () => ({
  useCurrentUser: (opts?: { enabled?: boolean }) => useCurrentUser(opts),
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

describe('AppHeader mobile search', () => {
  beforeEach(() => useSession.mockReset())

  it('opens the dashboard palette through the shared event', () => {
    useSession.mockReturnValue({ data: session, status: 'authenticated' })
    const onOpen = vi.fn()
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen)
    render(<AppHeader session={session} />)

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(onOpen).toHaveBeenCalledTimes(1)
    window.removeEventListener(OPEN_SEARCH_EVENT, onOpen)
  })
})

describe('AppHeader on auth pages', () => {
  beforeEach(() => useSession.mockReset())
  afterEach(() => pathname.mockReturnValue('/dashboard'))

  it.each(['/login', '/register'])('renders nothing on %s', (path) => {
    pathname.mockReturnValue(path)
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    const { container } = render(<AppHeader session={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AppHeader email', () => {
  beforeEach(() => {
    useSession.mockReset()
    useCurrentUser.mockClear()
  })

  it('shows the email from who-am-i over the sign-in email', async () => {
    useSession.mockReturnValue({ data: session, status: 'authenticated' })
    useCurrentUser.mockReturnValue({ data: { email: 'new@example.com' } })
    render(<AppHeader session={session} />)
    fireEvent.pointerDown(accountMenu()!, { button: 0, ctrlKey: false })

    expect(await screen.findByText('new@example.com')).toBeInTheDocument()
    expect(screen.queryByText('test@example.com')).not.toBeInTheDocument()
  })

  it('does not ask who-am-i for a signed-out visitor', () => {
    useSession.mockReturnValue({ data: null, status: 'unauthenticated' })
    render(<AppHeader session={null} />)
    expect(useCurrentUser).toHaveBeenCalledWith({ enabled: false })
  })
})
