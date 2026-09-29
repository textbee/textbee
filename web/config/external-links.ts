const POLAR_CUSTOMER_PORTAL_REQUEST_BASE =
  'https://polar.sh/textbee/portal/request'

export function polarCustomerPortalRequestUrl(
  email?: string | null
): string {
  const trimmed = email?.trim()
  if (!trimmed) return POLAR_CUSTOMER_PORTAL_REQUEST_BASE
  return `${POLAR_CUSTOMER_PORTAL_REQUEST_BASE}?email=${encodeURIComponent(trimmed)}`
}

const SMS_PERMISSION_GUIDE =
  'https://textbee.dev/blog/android-15-send-sms-permission-guide'

export function smsPermissionGuideUrl(source: string): string {
  return `${SMS_PERMISSION_GUIDE}?utm_source=${source}&utm_medium=app&utm_campaign=sms_permission`
}

export const ExternalLinks = {
  patreon: 'https://patreon.com/vernu',
  github: 'https://github.com/textbee/textbee',
  discord: 'https://textbee.dev/discord',
  polar: 'https://donate.textbee.dev',
  twitter: 'https://x.com/textbeedotdev',
  linkedin: 'https://www.linkedin.com/company/textbeedotdev',
}
