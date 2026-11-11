import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/render'
import { API_BASE_URL, mockUser } from '@/test/fixtures'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import VerifyEmailPage from './page'

const { push, replace, toast, searchParams } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  toast: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  useSearchParams: () => searchParams.current,
}))

vi.mock('@/hooks/use-toast', () => ({ toast, useToast: () => ({ toast }) }))

const endpoint = (path: string) => `${API_BASE_URL}${path}`

let currentEmail = 'bob@example.com'
let whoAmICalls = 0

const useEligibility = (body: Record<string, unknown> | null) =>
  server.use(
    http.get(endpoint(ApiEndpoints.auth.correctEmail()), () =>
      body
        ? HttpResponse.json(body)
        : HttpResponse.json({ message: 'Not Found' }, { status: 404 })
    )
  )

const useChangeResponse = (status: number, body: Record<string, unknown>) =>
  server.use(
    http.post(endpoint(ApiEndpoints.auth.correctEmail()), async ({ request }) => {
      if (status === 200) {
        const { newEmail } = (await request.json()) as { newEmail: string }
        currentEmail = newEmail
      }
      return HttpResponse.json(body, { status })
    })
  )

const renderPage = (
  query = 'verificationEmailSent=1',
  options?: Parameters<typeof renderWithProviders>[1]
) => {
  searchParams.current = new URLSearchParams(query)
  return renderWithProviders(<VerifyEmailPage />, options)
}

const hintFor = (input: HTMLElement) =>
  document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0])

const fillAndSubmit = async (email: string) => {
  const input = await screen.findByLabelText('New email')
  await userEvent.clear(input)
  await userEvent.type(input, email)
  await userEvent.type(screen.getByLabelText('Password'), 'password123')
  await userEvent.click(
    screen.getByRole('button', { name: 'Change email and send link' })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  currentEmail = 'bob@example.com'
  whoAmICalls = 0
  server.use(
    http.get(endpoint(ApiEndpoints.auth.whoAmI()), () => {
      whoAmICalls++
      return HttpResponse.json({
        data: { ...mockUser, email: currentEmail, emailVerifiedAt: null },
      })
    })
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  // @ts-ignore
  delete window.SupportHQWidget
})

describe('VerifyEmailPage address and fix link', () => {
  it('shows the stored address and the change link when eligible', async () => {
    useEligibility({ eligible: true })
    renderPage()

    const address = await screen.findByText('bob@example.com')
    expect(address.tagName).toBe('STRONG')
    expect(await screen.findByRole('button', { name: 'Change it' })).toBeInTheDocument()
    expect(screen.queryByText(/contact support/i)).not.toBeInTheDocument()
  })

  it('shows the address in the default state too', async () => {
    useEligibility({ eligible: true })
    renderPage('')

    expect(await screen.findByText('bob@example.com')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Change it' })).toBeInTheDocument()
  })

  it('offers support instead when the account has activity', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_HQ_PROJECT_ID', 'test-project')
    const open = vi.fn()
    // @ts-ignore
    window.SupportHQWidget = { open }
    useEligibility({ eligible: false, reason: 'has_activity' })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Contact support' }))
    expect(open).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Change it' })).not.toBeInTheDocument()
  })

  it('links to the support page when the chat is not configured', async () => {
    useEligibility({ eligible: false, reason: 'not_available' })
    renderPage()

    const link = await screen.findByRole('link', { name: 'Contact support' })
    expect(link).toHaveAttribute('href', '/dashboard/account/support')
  })

  it('shows no link when the eligibility check fails', async () => {
    useEligibility(null)
    renderPage()

    expect(await screen.findByText('bob@example.com')).toBeInTheDocument()
    await waitFor(() => expect(whoAmICalls).toBeGreaterThan(0))
    expect(screen.queryByText(/wrong email/i)).not.toBeInTheDocument()
  })

  it('warns about a typo and prefills the suggestion', async () => {
    currentEmail = 'bob@gmail.con'
    useEligibility({ eligible: true })
    renderPage()

    expect(
      await screen.findByText('This address looks like a typo. Did you mean bob@gmail.com?')
    ).toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change to bob@gmail.com' })
    )
    expect(await screen.findByLabelText('New email')).toHaveValue('bob@gmail.com')
  })

  it('shows the typo warning without the fix button when not eligible', async () => {
    currentEmail = 'bob@gmail.con'
    useEligibility({ eligible: false, reason: 'has_activity' })
    renderPage()

    expect(await screen.findByText(/this address looks like a typo/i)).toBeInTheDocument()
    expect(await screen.findByText('Contact support')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change to/i })).not.toBeInTheDocument()
  })

  it('opens the form from ?change=1', async () => {
    useEligibility({ eligible: true })
    renderPage('change=1')

    expect(await screen.findByLabelText('New email')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(
      screen.getByText('We will send a new verification link to this address.')
    ).toBeInTheDocument()
  })
})

describe('VerifyEmailPage email change', () => {
  it('changes the email, refetches the user and shows the new address', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(200, {
      message: 'We sent a verification link to ada@example.com.',
      email: 'ada@example.com',
      sent: true,
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Change it' }))
    const callsBefore = whoAmICalls
    await fillAndSubmit('ada@example.com')

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument()
    await waitFor(() => expect(whoAmICalls).toBeGreaterThan(callsBefore))
    expect(toast).toHaveBeenCalledWith({
      title: 'Email changed. We sent a link to ada@example.com.',
    })
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument()
  })

  it('returns to the email sent state after a change from ?change=1', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(200, {
      message: 'We sent a verification link to ada@example.com.',
      email: 'ada@example.com',
      sent: true,
    })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/verify-email?verificationEmailSent=true')
    )
  })

  it('shows the API message when the email could not be sent', async () => {
    const message =
      'Your email is now ada@example.com. Press resend to get the verification link.'
    useEligibility({ eligible: true })
    useChangeResponse(200, { message, email: 'ada@example.com', sent: false })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: message }))
  })

  it('shows a 409 error under the email field', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(409, {
      error: 'This email is already in use. Sign in with it instead.',
    })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    expect(
      await screen.findByText('This email is already in use. Sign in with it instead.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('New email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a wrong password under the password field', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(400, { error: 'Your password is incorrect.' })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    expect(await screen.findByText('Your password is incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the 429 text from the API', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(429, {
      error: 'Too many email changes. Try again tomorrow or contact support.',
    })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    expect(
      await screen.findByText(
        'Too many email changes. Try again tomorrow or contact support.'
      )
    ).toBeInTheDocument()
  })

  it('falls back to a generic text for a 429 without an error field', async () => {
    useEligibility({ eligible: true })
    useChangeResponse(429, {
      statusCode: 429,
      message: 'ThrottlerException: Too Many Requests',
    })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    expect(
      await screen.findByText('Too many requests. Try again later.')
    ).toBeInTheDocument()
  })

  it('shows the typo hint in the form and submits the typed address', async () => {
    useEligibility({ eligible: true })
    let posted: unknown
    server.use(
      http.post(endpoint(ApiEndpoints.auth.correctEmail()), async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({
          message: 'We sent a verification link to ada@gmail.con.',
          email: 'ada@gmail.con',
          sent: true,
        })
      })
    )
    renderPage('change=1')

    await userEvent.type(await screen.findByLabelText('New email'), 'ada@gmail.con')
    await userEvent.tab()
    expect(await screen.findByText(/did you mean ada@gmail\.com\?/i)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Password'), 'password123')
    await userEvent.click(
      screen.getByRole('button', { name: 'Change email and send link' })
    )
    await waitFor(() =>
      expect(posted).toEqual({ newEmail: 'ada@gmail.con', currentPassword: 'password123' })
    )
  })

  it('keeps a reserved line for the typo hint so the form does not move', async () => {
    useEligibility({ eligible: true })
    renderPage('change=1')

    const input = await screen.findByLabelText('New email')
    expect(hintFor(input)).toHaveClass('min-h-5')
    await userEvent.type(input, 'ada@gmail.con')
    await userEvent.tab()
    await screen.findByText(/did you mean ada@gmail\.com\?/i)
    expect(hintFor(input)).toHaveClass('min-h-5')
  })

  it('shows the limit message from the API when the link was not sent', async () => {
    const message =
      'Your email is now ada@example.com. You have reached the limit for verification emails. Try again tomorrow or contact support.'
    useEligibility({ eligible: true })
    useChangeResponse(200, { message, email: 'ada@example.com', sent: false })
    renderPage('change=1')

    await fillAndSubmit('ada@example.com')
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: message }))
  })

  it('closes the form and clears its fields and errors on Cancel', async () => {
    useEligibility({ eligible: true })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Change it' }))
    await userEvent.type(await screen.findByLabelText('New email'), 'ada@example.com')
    await userEvent.click(
      screen.getByRole('button', { name: 'Change email and send link' })
    )
    expect(await screen.findByText('Enter your password')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Change it' }))
    expect(await screen.findByLabelText('New email')).toHaveValue('')
    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument()
  })

  it('focuses New email when the form opens from the link', async () => {
    useEligibility({ eligible: true })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Change it' }))
    await waitFor(() => expect(screen.getByLabelText('New email')).toHaveFocus())
  })

  it('focuses New email when the form opens from the typo warning', async () => {
    currentEmail = 'bob@gmail.con'
    useEligibility({ eligible: true })
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Change to bob@gmail.com' })
    )
    await waitFor(() => expect(screen.getByLabelText('New email')).toHaveFocus())
  })

  it('focuses New email when the form opens from ?change=1', async () => {
    useEligibility({ eligible: true })
    renderPage('change=1')

    await waitFor(() => expect(screen.getByLabelText('New email')).toHaveFocus())
  })

  it('refetches eligibility and the user after a 403 and closes the form', async () => {
    let eligibility: Record<string, unknown> = { eligible: true }
    let eligibilityCalls = 0
    server.use(
      http.get(endpoint(ApiEndpoints.auth.correctEmail()), () => {
        eligibilityCalls++
        return HttpResponse.json(eligibility)
      })
    )
    useChangeResponse(403, { error: 'Contact support to change your email.' })
    renderPage('change=1')

    await screen.findByLabelText('New email')
    const userCallsBefore = whoAmICalls
    const eligibilityCallsBefore = eligibilityCalls
    eligibility = { eligible: false, reason: 'has_activity' }
    await fillAndSubmit('ada@example.com')

    await waitFor(() => expect(eligibilityCalls).toBeGreaterThan(eligibilityCallsBefore))
    await waitFor(() => expect(whoAmICalls).toBeGreaterThan(userCallsBefore))
    expect(await screen.findByText('Contact support')).toBeInTheDocument()
    expect(screen.queryByLabelText('New email')).not.toBeInTheDocument()
  })
})

describe('VerifyEmailPage signed out', () => {
  it('verifies a link without calling who-am-i', async () => {
    let posted: unknown
    server.use(
      http.post(endpoint(ApiEndpoints.auth.verifyEmail()), async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ message: 'Email verified successfully' })
      })
    )
    renderPage('userId=user_test_1&verificationCode=abc', { session: null })

    expect(
      await screen.findByText('Your email has been successfully verified')
    ).toBeInTheDocument()
    expect(posted).toEqual({ userId: 'user_test_1', verificationCode: 'abc' })
    expect(whoAmICalls).toBe(0)
  })
})

describe('VerifyEmailPage readable errors', () => {
  it('shows the API error text when resend hits the limit', async () => {
    useEligibility({ eligible: true })
    server.use(
      http.post(endpoint(ApiEndpoints.auth.sendEmailVerificationEmail()), () =>
        HttpResponse.json(
          { error: 'Too many email verification requests. Please try again later.' },
          { status: 429 }
        )
      )
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Click to resend' }))
    expect(
      await screen.findByText(
        'Too many email verification requests. Please try again later.'
      )
    ).toBeInTheDocument()
  })

  it('shows the API error text when a verification link is stale', async () => {
    useEligibility({ eligible: true })
    server.use(
      http.post(endpoint(ApiEndpoints.auth.verifyEmail()), () =>
        HttpResponse.json(
          { error: 'This link is for a previous email address. Request a new link.' },
          { status: 400 }
        )
      )
    )
    renderPage('userId=user_test_1&verificationCode=abc')

    expect(
      await screen.findByText(
        'This link is for a previous email address. Request a new link.'
      )
    ).toBeInTheDocument()
  })
})
