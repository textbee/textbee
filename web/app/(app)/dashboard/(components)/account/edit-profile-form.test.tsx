import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import EditProfileForm from './edit-profile-form'

type UpdateOptions = {
  onSuccess?: () => void
  onError?: (err: unknown) => void
}

const { toast, updateOptions } = vi.hoisted(() => ({
  toast: vi.fn(),
  updateOptions: {} as UpdateOptions,
}))

const httpError = (message: unknown) =>
  Object.assign(new Error('Request failed with status code 400'), {
    response: { data: { message } },
  })

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}))

vi.mock('@/lib/api', () => ({
  useCurrentUser: () => ({
    data: { name: 'Ada', email: 'ada@example.com', phone: '+10000000000' },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useUpdateProfile: (options: UpdateOptions) => {
    updateOptions.onSuccess = options.onSuccess
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
    updateOptions.onSuccess = undefined
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

  it('shows the server message in the toast description', () => {
    render(<EditProfileForm />)

    updateOptions.onError?.(httpError('name is already taken'))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'name is already taken' })
    )
  })

  it('joins a list of validation messages', () => {
    render(<EditProfileForm />)

    updateOptions.onError?.(httpError(['name is required', 'phone is invalid']))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'name is required, phone is invalid',
      })
    )
  })

  it('falls back to the error message when the server sent none', () => {
    render(<EditProfileForm />)

    updateOptions.onError?.(new Error('Network Error'))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Network Error' })
    )
  })

  it('does not use the destructive variant for a successful update', () => {
    render(<EditProfileForm />)

    updateOptions.onSuccess?.()

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Profile updated successfully!' })
    )
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' })
    )
  })
})
