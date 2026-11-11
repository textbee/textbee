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
  it('uses the account id from who-am-i once it loads', () => {
    useSession.mockReturnValue({
      data: { user: { id: 'session_id', email: 'ada@example.com' } },
    })
    useCurrentUser.mockReturnValue({
      data: { _id: 'user_1', email: 'ada@example.com' },
    })
    render(<AnalyticsIdentify />)

    expect(clarity).toHaveBeenCalledTimes(1)
    expect(clarity).toHaveBeenCalledWith('set', 'userId', 'user_1')
  })

  it('falls back to the session id while who-am-i loads', () => {
    useSession.mockReturnValue({
      data: { user: { id: 'user_1', email: 'ada@example.com' } },
    })
    useCurrentUser.mockReturnValue({ data: undefined })
    render(<AnalyticsIdentify />)

    expect(clarity).toHaveBeenCalledWith('set', 'userId', 'user_1')
  })

  it('never sends the email', () => {
    useSession.mockReturnValue({
      data: { user: { id: 'user_1', email: 'ada@example.com' } },
    })
    useCurrentUser.mockReturnValue({
      data: { _id: 'user_1', email: 'ada@example.com' },
    })
    render(<AnalyticsIdentify />)

    expect(JSON.stringify(clarity.mock.calls)).not.toContain('ada@example.com')
  })

  it('sends nothing when no id is known', () => {
    useSession.mockReturnValue({ data: { user: { email: 'ada@example.com' } } })
    useCurrentUser.mockReturnValue({ data: { email: 'ada@example.com' } })
    render(<AnalyticsIdentify />)

    expect(clarity).not.toHaveBeenCalled()
  })

  it('does not ask who-am-i without a session', () => {
    useSession.mockReturnValue({ data: null })
    useCurrentUser.mockReturnValue({ data: undefined })
    render(<AnalyticsIdentify />)

    expect(useCurrentUser).toHaveBeenCalledWith({ enabled: false })
    expect(clarity).not.toHaveBeenCalled()
  })
})
