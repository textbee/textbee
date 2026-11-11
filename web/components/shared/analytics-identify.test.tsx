import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import AnalyticsIdentify from './analytics-identify'

const { useSession, useCurrentUser } = vi.hoisted(() => ({
  useSession: vi.fn(),
  useCurrentUser: vi.fn(),
}))

vi.mock('next-auth/react', () => ({ useSession }))
vi.mock('@/lib/api', () => ({ useCurrentUser }))
vi.mock('@/lib/analytics/config', () => ({ isEnabled: () => true }))

const clarity = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  window.clarity = clarity
})

afterEach(() => {
  window.clarity = undefined
})

describe('AnalyticsIdentify', () => {
  it('uses the email from who-am-i once it loads', () => {
    useSession.mockReturnValue({ data: { user: { email: 'old@example.com' } } })
    useCurrentUser.mockReturnValue({ data: { email: 'new@example.com' } })
    render(<AnalyticsIdentify />)

    expect(clarity).toHaveBeenCalledWith('set', 'userId', 'new@example.com')
  })

  it('falls back to the session email while who-am-i loads', () => {
    useSession.mockReturnValue({ data: { user: { email: 'old@example.com' } } })
    useCurrentUser.mockReturnValue({ data: undefined })
    render(<AnalyticsIdentify />)

    expect(clarity).toHaveBeenCalledWith('set', 'userId', 'old@example.com')
  })

  it('does not ask who-am-i without a session', () => {
    useSession.mockReturnValue({ data: null })
    useCurrentUser.mockReturnValue({ data: undefined })
    render(<AnalyticsIdentify />)

    expect(useCurrentUser).toHaveBeenCalledWith({ enabled: false })
    expect(clarity).not.toHaveBeenCalled()
  })
})
