import { skipReason } from './email-eligibility'

describe('skipReason', () => {
  const user = { email: 'a@example.com' }

  it('allows an account in good standing, verified or not', () => {
    expect(skipReason(user, false)).toBeNull()
  })

  it('ignores the product email preference', () => {
    expect(skipReason({ ...user, emailPreferences: { productEmails: false } } as any, false)).toBeNull()
  })

  it('skips suppressed addresses', () => {
    expect(skipReason(user, true)).toBe('suppressed')
  })

  it('skips banned, deleting and missing accounts', () => {
    expect(skipReason({ ...user, isBanned: true }, false)).toBe('not_eligible')
    expect(skipReason({ ...user, accountDeletionRequestedAt: new Date() }, false)).toBe('not_eligible')
    expect(skipReason({}, false)).toBe('not_eligible')
    expect(skipReason(null, false)).toBe('not_eligible')
  })
})
