import { HttpException, HttpStatus } from '@nestjs/common'

// Letters in any script. Phones drop them when they encode the address, so
// "+1555o0100" would reach a different number and "MYBANK" reaches nobody.
// The Japanese long vowel mark (U+30FC, halfwidth U+FF70) is left out because
// Japanese input often types it in place of a hyphen.
const LETTER = /(?![\u30fc\uff70])\p{L}/u
const DIGIT = /\d/

const MAX_LISTED = 5

/**
 * Recipients that cannot be a phone number or short code: values that are not
 * strings, values with no digit, and values that contain letters, such as
 * sender names, emails and template placeholders left unfilled.
 */
export function findInvalidRecipients(recipients: unknown[]): string[] {
  return recipients
    .filter((r) => typeof r !== 'string' || LETTER.test(r) || !DIGIT.test(r))
    .map((r) => String(r))
}

/** Rejects the request before anything is queued or billed. */
export function assertValidRecipients(recipients: unknown[]): void {
  const invalid = findInvalidRecipients(recipients)
  if (invalid.length === 0) return

  const listed = invalid
    .slice(0, MAX_LISTED)
    .map((r) => JSON.stringify(r))
    .join(', ')
  const more =
    invalid.length > MAX_LISTED
      ? ` and ${invalid.length - MAX_LISTED} more`
      : ''

  throw new HttpException(
    {
      success: false,
      error: `Invalid recipients: ${listed}${more}. A recipient must be a phone number or short code. Text such as a sender name or email cannot receive SMS.`,
    },
    HttpStatus.BAD_REQUEST,
  )
}
