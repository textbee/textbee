import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginWithGoogle from './login-with-google'
import { readLastLoginMethod, saveLastLoginMethod } from '@/lib/last-login-method'

const signIn = vi.fn()
const toast = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-toast', () => ({ toast }))
vi.mock('next-auth/react', () => ({
  signIn: (...a: unknown[]) => signIn(...a),
  getSession: () => Promise.resolve(null),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@react-oauth/google', () => ({
  GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => children,
  GoogleLogin: ({
    onSuccess,
  }: {
    onSuccess: (response: { credential: string }) => void
  }) => <button onClick={() => onSuccess({ credential: 'token' })}>Google</button>,
}))

describe('LoginWithGoogle last used', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'client-id')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
  })

  it('shows the label when Google was last used', async () => {
    saveLastLoginMethod('google')
    render(<LoginWithGoogle showLastUsed />)
    expect(await screen.findByText('Last used')).toBeInTheDocument()
  })

  it('hides the label after a password login', async () => {
    saveLastLoginMethod('password')
    render(<LoginWithGoogle showLastUsed />)
    await screen.findByRole('button', { name: 'Google' })
    expect(screen.queryByText('Last used')).not.toBeInTheDocument()
  })

  it('hides the label where it is not asked for', async () => {
    saveLastLoginMethod('google')
    render(<LoginWithGoogle />)
    await screen.findByRole('button', { name: 'Google' })
    expect(screen.queryByText('Last used')).not.toBeInTheDocument()
  })

  it('saves the method after a successful sign-in', async () => {
    signIn.mockResolvedValue({ error: null, ok: true })
    render(<LoginWithGoogle />)
    await userEvent.click(await screen.findByRole('button', { name: 'Google' }))
    await waitFor(() => expect(readLastLoginMethod()).toBe('google'))
  })

  it('does not save the method after a failed sign-in', async () => {
    signIn.mockResolvedValue({ error: 'failed', ok: false })
    render(<LoginWithGoogle />)
    await userEvent.click(await screen.findByRole('button', { name: 'Google' }))
    await waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(readLastLoginMethod()).toBeNull()
  })
})

describe('LoginWithGoogle errors', () => {
  const MESSAGE =
    'This email is linked to another Google account. Sign in with your password or reset it.'

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'client-id')
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
  })

  it('shows the message the API returned', async () => {
    signIn.mockResolvedValue({ error: MESSAGE, ok: false, status: 401 })
    render(<LoginWithGoogle />)
    await userEvent.click(await screen.findByRole('button', { name: 'Google' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: MESSAGE, variant: 'destructive' })
      )
    )
  })

  it('keeps the generic message for other failures', async () => {
    signIn.mockResolvedValue({ error: 'CredentialsSignin', ok: false, status: 401 })
    render(<LoginWithGoogle />)
    await userEvent.click(await screen.findByRole('button', { name: 'Google' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Could not sign you in with Google',
          variant: 'destructive',
        })
      )
    )
  })
})
