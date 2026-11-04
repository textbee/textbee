import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LoginForm from './login-form'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

const signIn = vi.fn()
vi.mock('next-auth/react', () => ({ signIn: (...a: unknown[]) => signIn(...a) }))

// signIn reflects next-auth's real redirect semantics: with redirect:true it
// navigates and never resolves a usable result; with redirect:false it resolves
// { error, ok }. A component that reads the result while passing redirect:true
// can never see the error, which is the bug under test.
const redirectAwareSignIn = (_provider: string, opts: { redirect?: boolean }) =>
  opts?.redirect
    ? undefined
    : { error: 'CredentialsSignin', ok: false, status: 401, url: null }

// Turnstile needs a live Cloudflare widget it cannot get in jsdom, so the hook
// is mocked to hand the form a token immediately, making the form submittable.
vi.mock('@/lib/turnstile', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    useTurnstile: (opts: { onToken?: (t: string) => void }) => {
      // The widget fires its callback after mount, never during render
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => opts.onToken?.('test-turnstile-token'), [])
      return {
        containerRef: { current: null },
        token: 'test-turnstile-token',
        error: null,
        isReady: true,
      }
    },
  }
})

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Email'), 'user@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'secret123')
  await userEvent.click(screen.getByRole('button', { name: /^log in$/i }))
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signIn.mockImplementation(redirectAwareSignIn)
  })

  // The reported bug: wrong credentials showed no message and reloaded, because
  // redirect:true made the error branch dead code.
  it('shows an error and does not navigate on wrong credentials', async () => {
    // Uses the redirect-aware default: only redirect:false yields a readable
    // error. Against the redirect:true code this returns undefined, so the
    // message never renders and this test fails, which is the point.
    render(<LoginForm />)
    await fillAndSubmit()

    expect(
      await screen.findByText(/invalid email or password/i)
    ).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('calls signIn without a redirect so the result can be read', async () => {
    render(<LoginForm />)
    await fillAndSubmit()

    await waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(signIn).toHaveBeenCalledWith(
      'email-password-login',
      expect.objectContaining({ redirect: false })
    )
  })

  it('navigates to the dashboard on success', async () => {
    signIn.mockResolvedValueOnce({
      error: null,
      ok: true,
      status: 200,
      url: null,
    })

    render(<LoginForm />)
    await fillAndSubmit()

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    expect(
      screen.queryByText(/invalid email or password/i)
    ).not.toBeInTheDocument()
  })

  describe('with a redirect param', () => {
    afterEach(() => window.history.replaceState(null, '', '/'))

    const succeed = () =>
      signIn.mockResolvedValueOnce({ error: null, ok: true, status: 200, url: null })

    it('returns to the page that sent the reader to log in, query included', async () => {
      const target = `${window.location.origin}/checkout/pro?billingInterval=yearly&from=email&ref=U2`
      window.history.replaceState(null, '', `/login?redirect=${encodeURIComponent(target)}`)
      succeed()

      render(<LoginForm />)
      await fillAndSubmit()

      await waitFor(() =>
        expect(push).toHaveBeenCalledWith(
          '/checkout/pro?billingInterval=yearly&from=email&ref=U2'
        )
      )
    })

    it('ignores a redirect to another site', async () => {
      window.history.replaceState(
        null,
        '',
        `/login?redirect=${encodeURIComponent('https://evil.example.net/x')}`
      )
      succeed()

      render(<LoginForm />)
      await fillAndSubmit()

      await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    })
  })
})
