import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders, screen } from '@/test/render'
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
