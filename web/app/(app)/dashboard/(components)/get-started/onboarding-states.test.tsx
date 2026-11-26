import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, screen, waitFor } from '@/test/render'
import { server } from '@/test/msw/server'
import { API_BASE_URL, mockUser } from '@/test/fixtures'
import GetStartedCard from './index'

// Fail-closed policy: the checklist may only render from complete data. A
// backend failure must never show a fresh user "stuck on Verify your email".

describe('GetStartedCard states', () => {
  it('renders the error card with retry when whoAmI fails (no checklist)', async () => {
    server.use(
      http.get(`${API_BASE_URL}/auth/who-am-i`, () =>
        HttpResponse.json({ message: 'down' }, { status: 500 })
      )
    )

    renderWithProviders(<GetStartedCard />)

    await waitFor(() =>
      expect(
        screen.getByText(/Couldn't load your setup status/)
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    // Never render steps computed from missing data.
    expect(screen.queryByText('Verify your email')).not.toBeInTheDocument()
  })

  it('renders progress and the active step for a mid-funnel user', async () => {
    server.use(
      http.get(`${API_BASE_URL}/auth/who-am-i`, () =>
        HttpResponse.json({
          data: { ...mockUser, emailVerifiedAt: null, onboardingCompletedAt: null },
        })
      )
    )

    renderWithProviders(<GetStartedCard />)

    // 5 of 6 done (only verify_email pending with the default fixtures).
    await waitFor(() =>
      expect(screen.getByText('5 of 6')).toBeInTheDocument()
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    // The active step is expanded with its inline resend action.
    expect(screen.getByText('Verify your email')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /resend email/i })
    ).toBeInTheDocument()
    // The user's email address is surfaced.
    expect(screen.getByText(mockUser.email)).toBeInTheDocument()
  })

  it('shows full progress for an all-done user (before auto-complete lands)', async () => {
    renderWithProviders(<GetStartedCard />)

    await waitFor(() => expect(screen.getByText('6 of 6')).toBeInTheDocument())
    expect(screen.getByText('All steps complete!')).toBeInTheDocument()
  })

  // Reopening a finished step used to render an empty row: the body was gated
  // on the step NOT being done. Someone who wanted to replace a leaked or lost
  // API key had no route back to that action from the checklist.
  it('lets a completed API key step be reopened to generate another key', async () => {
    const user = userEvent.setup()
    renderWithProviders(<GetStartedCard />)

    await waitFor(() => expect(screen.getByText('6 of 6')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Generate an API key' }))

    // The action is back, and says plainly that it makes an additional key.
    expect(
      await screen.findByRole('button', { name: /generate another api key/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/You already have a key/)).toBeInTheDocument()
  })

  // The counterpart to the test above. Allowing a done step to stay selected
  // must not break the original behaviour: if the step you are sitting on
  // completes underneath you (the card polls), the selection should move on
  // rather than stranding you on a finished step.
  it('advances off a step that completes while you are sitting on it', async () => {
    const user = userEvent.setup()
    let apiKeyCount = 0
    server.use(
      http.get(`${API_BASE_URL}/gateway/stats`, () =>
        HttpResponse.json({
          data: {
            totalSentSMSCount: 0,
            totalReceivedSMSCount: 0,
            totalDeviceCount: 0,
            totalApiKeyCount: apiKeyCount,
          },
        })
      )
    )

    renderWithProviders(<GetStartedCard />)

    // Done with these stats: verify_email (fixture user is verified) and
    // choose_plan (fixture subscription is a paid plan).
    await waitFor(() => expect(screen.getByText('2 of 6')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Generate an API key' }))
    expect(
      await screen.findByRole('button', { name: /^generate api key$/i })
    ).toBeInTheDocument()

    // The key now exists; the next poll completes the step under the user.
    apiKeyCount = 3

    await waitFor(
      () => expect(screen.getByText('3 of 6')).toBeInTheDocument(),
      { timeout: 15000 }
    )

    // The selection moved on rather than stranding the user on a finished
    // step, so that step's action is no longer the one being offered.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /^generate api key$/i })
      ).not.toBeInTheDocument()
    )
  }, 20000)

  it('keeps the API key wording while the settings route does not exist', async () => {
    renderWithProviders(<GetStartedCard />)
    await waitFor(() => expect(screen.getByText('6 of 6')).toBeInTheDocument())
    expect(screen.getByText('Generate an API key')).toBeInTheDocument()
    expect(screen.getByText('Register your device')).toBeInTheDocument()
    expect(screen.queryByText('Connect your phone')).not.toBeInTheDocument()
  })

  it('keeps the API key wording while sign-in is off for the account', async () => {
    server.use(
      http.get(`${API_BASE_URL}/auth/device-link-settings`, () =>
        HttpResponse.json({ data: { enabled: false, defaultTab: 'code' } })
      )
    )
    renderWithProviders(<GetStartedCard />)
    await waitFor(() => expect(screen.getByText('6 of 6')).toBeInTheDocument())
    expect(screen.getByText('Generate an API key')).toBeInTheDocument()
    expect(screen.queryByText('Connect your phone')).not.toBeInTheDocument()
  })

  it('uses the sign-in wording while sign-in is on for the account', async () => {
    server.use(
      http.get(`${API_BASE_URL}/auth/device-link-settings`, () =>
        HttpResponse.json({ data: { enabled: true, defaultTab: 'code' } })
      )
    )
    renderWithProviders(<GetStartedCard />)
    expect(await screen.findByText('Connect your phone')).toBeInTheDocument()
    expect(screen.getByText('Create an API key for your code')).toBeInTheDocument()
    expect(screen.queryByText('Generate an API key')).not.toBeInTheDocument()
  })
})
