import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SupportForm from './support-form'

const { currentUser } = vi.hoisted(() => ({
  currentUser: { email: 'ada@example.com' },
}))

vi.mock('@/lib/api', () => ({
  useCurrentUser: () => ({ data: { ...currentUser } }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Ada', email: 'ada@example.com' } },
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/turnstile', () => ({
  useTurnstile: () => ({ containerRef: { current: null }, token: null, error: null }),
}))

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

describe('SupportForm email', () => {
  beforeEach(() => {
    currentUser.email = 'ada@example.com'
  })

  it('follows the account email while the field is untouched', () => {
    const { rerender } = render(<SupportForm />)
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com')

    currentUser.email = 'ada@gmail.com'
    rerender(<SupportForm />)
    expect(screen.getByLabelText('Email')).toHaveValue('ada@gmail.com')

    currentUser.email = 'ada@outlook.com'
    rerender(<SupportForm />)
    expect(screen.getByLabelText('Email')).toHaveValue('ada@outlook.com')
  })

  it('keeps an edited value when the account email changes', async () => {
    const { rerender } = render(<SupportForm />)
    const input = screen.getByLabelText('Email')
    await userEvent.clear(input)
    await userEvent.type(input, 'me@example.com')

    currentUser.email = 'ada@gmail.com'
    rerender(<SupportForm />)
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com')
  })
})
