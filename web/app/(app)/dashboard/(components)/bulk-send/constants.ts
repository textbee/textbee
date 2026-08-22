export const MAX_FILE_SIZE = 1024 * 1024 // 1 MB
export const FALLBACK_MAX_ROWS = 50
export const SAMPLE_CSV = '/samples/bulk-sms-sample.csv'
export const PREVIEW_ROWS = 5

export const REASON_LABEL: Record<string, string> = {
  empty: 'no phone number',
  invalid: 'not a valid phone number',
  duplicate: 'duplicate number',
}

// Advisory only: above this many recipients the review step warns about how
// long the send will take. Nothing is blocked. Tunable per deploy, and it must
// carry the NEXT_PUBLIC_ prefix to be readable from the browser at all.
export const BULK_RECIPIENT_WARN_THRESHOLD =
  Number(process.env.NEXT_PUBLIC_BULK_RECIPIENT_WARN_THRESHOLD) || 500

// Matches DEFAULT_SMS_SEND_DELAY_SECONDS on the API, used when a device has
// not reported its own pacing.
export const DEFAULT_SEND_DELAY_SECONDS = 5
