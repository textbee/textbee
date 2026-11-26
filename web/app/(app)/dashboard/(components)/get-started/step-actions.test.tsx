import { describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import { renderWithProviders, screen, userEvent } from '@/test/render'
import StepActions from './step-actions'

describe('StepActions verify_email', () => {
  it('links to the email fix and the verification page', () => {
    renderWithProviders(
      <StepActions
        stepId='verify_email'
        isSaving={false}
        subLoading={false}
        userEmail='bob@gmail.con'
        onSkipStep={vi.fn()}
      />
    )

    expect(screen.getByText('bob@gmail.con')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Wrong address? Change it' })
    ).toHaveAttribute('href', '/verify-email?change=1')
    expect(
      screen.getByRole('link', { name: 'Open verification page' })
    ).toHaveAttribute('href', '/verify-email')
    expect(screen.queryByText('Enter verification code')).not.toBeInTheDocument()
  })
})

describe('StepActions register_device', () => {
  it('shows the QR panel of today while sign-in is off', () => {
    renderWithProviders(
      <StepActions
        stepId='register_device'
        isSaving={false}
        subLoading={false}
        onSkipStep={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: /Generate key & show QR/ })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Connect your phone' })
    ).not.toBeInTheDocument()
  })

  it('opens the add-device dialog while sign-in is on', async () => {
    server.use(
      http.get(`${API_BASE_URL}/auth/device-link-settings`, () =>
        HttpResponse.json({ data: { enabled: true, defaultTab: 'code' } })
      )
    )
    renderWithProviders(
      <StepActions
        stepId='register_device'
        isSaving={false}
        subLoading={false}
        signIn
        onSkipStep={vi.fn()}
      />
    )
    expect(
      screen.queryByRole('button', { name: /Generate key & show QR/ })
    ).not.toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Connect your phone' })
    )
    expect(
      await screen.findByRole('tab', { name: 'Enter code' })
    ).toBeInTheDocument()
  })
})
