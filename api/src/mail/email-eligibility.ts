// Categories this service sends; both ignore the product email preference.
export type EmailCategory = 'account' | 'usage'

export type SkipReason = 'suppressed' | 'disabled' | 'not_eligible'

export interface EligibilityUser {
  email?: string
  isBanned?: boolean
  accountDeletionRequestedAt?: Date | null
}

/** Why an email must not go to this user, or null when it may. */
export const skipReason = (
  user: EligibilityUser | null | undefined,
  suppressed: boolean,
): SkipReason | null => {
  if (!user?.email || user.isBanned || user.accountDeletionRequestedAt) {
    return 'not_eligible'
  }
  return suppressed ? 'suppressed' : null
}
