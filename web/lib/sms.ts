// SMS encoding helpers, shared by the send page, the bulk send flow and the
// reply composer so all three report segment counts identically.

export type SegmentInfo = {
  length: number
  segments: number
  perSegment: number
  // GSM-7 fits more per segment than UCS-2, which is needed for non-Latin
  // characters and most emoji.
  encoding: 'GSM-7' | 'UCS-2'
}

// Characters representable in the GSM 03.38 alphabet.
const GSM_7_CHARS =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
const GSM_7_EXTENDED = '^{}\\[~]|€'

export function isGsm7(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i)
    if (GSM_7_CHARS.indexOf(char) === -1 && GSM_7_EXTENDED.indexOf(char) === -1) {
      return false
    }
  }
  return true
}

/** Segment count for a message, so a user is not surprised by cost. */
export function getSegmentInfo(text: string): SegmentInfo {
  const gsm = isGsm7(text)
  const encoding = gsm ? 'GSM-7' : 'UCS-2'
  const single = gsm ? 160 : 70
  const multi = gsm ? 153 : 67
  const length = text.length

  if (length === 0) {
    return { length: 0, segments: 0, perSegment: single, encoding }
  }
  if (length <= single) {
    return { length, segments: 1, perSegment: single, encoding }
  }
  return {
    length,
    segments: Math.ceil(length / multi),
    perSegment: multi,
    encoding,
  }
}

/**
 * Strip formatting so "+1 (415) 555-0101" and "+14155550101" are recognised as
 * the same recipient for duplicate detection.
 */
export function normalizePhone(value: string): string {
  const trimmed = value.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return hasPlus ? `+${digits}` : digits
}

// 3 digits covers the shortest short codes. 15 is the E.164 maximum.
export const MIN_RECIPIENT_DIGITS = 3
export const MAX_RECIPIENT_DIGITS = 15
// The shortest full phone number, as opposed to a short code.
export const MIN_FULL_NUMBER_DIGITS = 7

// Letters in any script. The Japanese long vowel mark (U+30FC, halfwidth
// U+FF70) is left out because Japanese input often types it in place of a
// hyphen.
const LETTER = /(?![\u30fc\uff70])\p{L}/u

/** Sender names such as "MYBANK" send messages but cannot receive them. */
export function hasLetters(value: string): boolean {
  return LETTER.test(value)
}

/** Remove the formatting people type inside a number, keeping a leading plus. */
export function stripPhoneFormatting(value: string): string {
  return value.trim().replace(/[\s.()\-\u30fc\uff70]/g, '')
}

/**
 * Permissive validity check. The carrier is the real authority on whether a
 * number can be reached, so this accepts international numbers, local numbers
 * and short codes, and only rejects input that cannot be any of them.
 */
export function isPlausiblePhone(value: string): boolean {
  const normalized = normalizePhone(value)
  const digits = normalized.replace(/\D/g, '')
  if (digits.length < MIN_RECIPIENT_DIGITS || digits.length > MAX_RECIPIENT_DIGITS) {
    return false
  }
  // Reject anything carrying characters that are neither digits, separators,
  // nor a leading plus.
  return /^\+?[\d\s()./\-\u30fc\uff70]+$/.test(value.trim())
}
