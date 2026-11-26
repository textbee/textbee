// Connecting a phone by sign-in: the code the textbee app shows, and its
// hand-off from the dashboard to the link page.

import { Routes } from '@/config/routes'

const LINK_DEVICE_PATH = Routes.linkDevice

// Session storage only: the code never travels in an address, so a link can
// never pass as a typed code.
const TYPED_CODE_KEY = 'textbee.linkDevice.typedCode'

export const BAD_CODE_TEXT = 'Check the code. It has 8 letters and numbers.'

/** The code in upper case without hyphens or spaces, or null when it is not 8 letters and numbers. */
export function normalizeCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const code = input.replace(/[\s-]/g, '').toUpperCase()
  return /^[A-Z0-9]{8}$/.test(code) ? code : null
}

/** "K7QX2M9P" as "K7QX-2M9P". */
export function displayCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** Stores a code the user typed in the dashboard. False when the browser refuses. */
export function storeTypedCode(code: string): boolean {
  try {
    window.sessionStorage.setItem(TYPED_CODE_KEY, code)
    return true
  } catch {
    return false
  }
}

/** Reads the stored typed code and removes it, whether it is used or not. */
export function takeTypedCode(): string | null {
  try {
    const value = window.sessionStorage.getItem(TYPED_CODE_KEY)
    window.sessionStorage.removeItem(TYPED_CODE_KEY)
    return normalizeCode(value)
  } catch {
    return null
  }
}

/**
 * True for the link page, and for any page that returns to it after login.
 * Those addresses can hold a code, so no third-party script may run there.
 */
export function isLinkDeviceAddress(
  pathname: string | null | undefined,
  search: string | null | undefined
): boolean {
  if (
    pathname === LINK_DEVICE_PATH ||
    pathname?.startsWith(`${LINK_DEVICE_PATH}/`)
  ) {
    return true
  }
  if (!search) return false
  const redirect = new URLSearchParams(search).get('redirect')
  if (!redirect) return false
  let decoded = redirect
  try {
    decoded = decodeURIComponent(redirect)
  } catch {
    decoded = redirect
  }
  return decoded.includes(LINK_DEVICE_PATH.slice(1))
}
