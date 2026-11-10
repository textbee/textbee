import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import EditProfileForm from './edit-profile-form'

const { toast, updateOptions } = vi.hoisted(() => ({
  toast: vi.fn(),
  updateOptions: {} as { onError?: (err: Error) => void },
}))

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}))

vi.mock('@/lib/api', () => ({
  useCurrentUser: () => ({
    data: { name: 'Ada', email: 'ada@example.com', phone: '+10000000000' },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUpdateProfile: (options: { onError?: (err: Error) => void }) => {
    updateOptions.onError = options.onError
    return { mutate: vi.fn(), isPending: false, isSuccess: false }
  },
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ update: vi.fn() }),
}))

vi.mock('react-hook-form', () => ({
  useForm: () => ({
    register: () => ({}),
    getValues: () => ({ name: 'Ada', phone: '+10000000000' }),
    handleSubmit: (fn: (values: unknown) => void) => (event: unknown) =>
      fn(event),
    formState: { errors: {} },
  }),
}))

describe('EditProfileForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateOptions.onError = undefined
  })

  it('shows a failed update as a destructive toast', () => {
    render(<EditProfileForm />)

    updateOptions.onError?.(new Error('name is already taken'))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        title: 'Failed to update profile',
      })
    )
  })

  it('shows what failed in the toast description', () => {
    render(<EditProfileForm />)

    updateOptions.onError?.(new Error('name is already taken'))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'name is already taken' })
    )
  })

  it('does not use the destructive variant for a successful update', () => {
    render(<EditProfileForm />)

    // The success toast is a plain one: the failure must not look like it.
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    )
  })
})
