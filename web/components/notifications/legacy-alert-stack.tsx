'use client'

import AccountDeletionAlert from '@/app/(app)/dashboard/(components)/alerts/account-deletion-alert'
import JoinDiscordBanner from '@/app/(app)/dashboard/(components)/alerts/join-discord-banner'
import PastDueBillingAlert from '@/app/(app)/dashboard/(components)/alerts/past-due-billing-alert'
import SmsPermissionAlert from '@/app/(app)/dashboard/(components)/alerts/sms-permission-alert'
import UpgradeToProAlert from '@/app/(app)/dashboard/(components)/alerts/upgrade-to-pro-alert'
import VerifyEmailAlert from '@/app/(app)/dashboard/(components)/alerts/verify-email-alert'
import UpdateAppNotificationBar from '@/app/(app)/dashboard/(components)/devices/update-app-notification-bar'

// The dashboard's original top-of-page messages in their original order, plus
// the SMS permission alert. This is what renders while the notification engine is switched off,
// which is the shipped default, so turning the engine off is a true rollback
// rather than a blank slot.
//
// These components and this wrapper are removed once the engine has run at full
// exposure long enough to trust. Until then they are the fallback for a feed
// that errors, so they have to keep working.
export function LegacyAlertStack() {
  return (
    <>
      <UpdateAppNotificationBar />
      <VerifyEmailAlert />
      <PastDueBillingAlert />
      <SmsPermissionAlert />
      <AccountDeletionAlert />
      <UpgradeToProAlert />
      <JoinDiscordBanner />
    </>
  )
}
