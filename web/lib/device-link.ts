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

/** Opens the link page in this tab, as a fresh page load. */
export function openLinkPage(): void {
  window.location.assign(LINK_DEVICE_PATH)
}

// Add-device dialog: which tab opens first. The server sends its choice; a tab
// the user picked by hand is kept with the server's choice of that moment.
export type AddDeviceTab = 'code' | 'key'

const TAB_KEY = 'textbee.addDevice.tab'

/** The server's first tab. Anything but 'key', and no value at all, means 'code'. */
export function serverTab(value: unknown): AddDeviceTab {
  return value === 'key' ? 'key' : 'code'
}

function readTabMemory(): { tab: AddDeviceTab; defaultTab: AddDeviceTab } | null {
  try {
    const raw = window.localStorage.getItem(TAB_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { tab?: unknown; defaultTab?: unknown }
    const valid = (value: unknown) => value === 'code' || value === 'key'
    if (!valid(parsed?.tab) || !valid(parsed?.defaultTab)) return null
    return {
      tab: parsed.tab as AddDeviceTab,
      defaultTab: parsed.defaultTab as AddDeviceTab,
    }
  } catch {
    return null
  }
}

/** The tab the dialog opens on: the stored tab while the server's choice is unchanged. */
export function firstTab(serverDefault: AddDeviceTab): AddDeviceTab {
  const stored = readTabMemory()
  return stored && stored.defaultTab === serverDefault ? stored.tab : serverDefault
}

/** Drops a stored tab that was picked under another server choice. */
export function forgetStaleTab(serverDefault: AddDeviceTab): void {
  const stored = readTabMemory()
  if (!stored || stored.defaultTab === serverDefault) return
  try {
    window.localStorage.removeItem(TAB_KEY)
  } catch {
    // Storage cannot be changed: the server's tab still wins
  }
}

/** Keeps a tab the user picked by hand, with the server's choice of that moment. */
export function rememberTab(tab: AddDeviceTab, serverDefault: AddDeviceTab): void {
  try {
    window.localStorage.setItem(
      TAB_KEY,
      JSON.stringify({ tab, defaultTab: serverDefault })
    )
  } catch {
    // Storage cannot be written: the dialog opens on the server's tab
  }
}
