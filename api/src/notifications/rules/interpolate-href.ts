/**
 * Substitutes per-account values into an authored link.
 *
 * Some campaign links have to carry who is clicking. The feedback survey is a
 * Google Form that prefills a name and an email, and the stored href is one
 * string shared by every account, so the substitution happens as the feed is
 * built rather than in the browser.
 *
 * Only hrefs are templated. Titles and bodies are left alone on purpose: a URL
 * needs percent-encoding and visible copy does not, so one function cannot
 * safely do both.
 */

// Deliberately tiny. Each is a value the feed already holds, and a wider list
// would turn an authored link into a way to read accounts out of the database.
export const HREF_TOKENS = ['user.id', 'user.name', 'user.email'] as const

export type HrefToken = (typeof HREF_TOKENS)[number]

export type HrefTokenValues = Partial<Record<HrefToken, string | undefined>>

const TOKEN_PATTERN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

const ALLOWED: ReadonlySet<string> = new Set(HREF_TOKENS)

// Percent-encoding only, never `+` for a space. A plus reads as a space in a
// query string but as a literal plus in a path, so a token placed in a path
// would resolve to the wrong URL. `%20` is a space in both.
function encode(value: string): string {
  return encodeURIComponent(value)
}

/** Every token the link mentions, in order, including ones we do not know. */
export function referencedTokens(href: string): string[] {
  const found: string[] = []
  for (const match of String(href ?? '').matchAll(TOKEN_PATTERN)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

/** The tokens an author got wrong. Authoring rejects a link carrying any. */
export function unknownTokens(href: string): string[] {
  return referencedTokens(href).filter((token) => !ALLOWED.has(token))
}

/**
 * An unknown token, or a known one the account has no value for, becomes an
 * empty string. Leaving the literal in place would send `{{user.email}}` to
 * whoever owns the link and show the reader a broken form.
 */
export function interpolateHref(href: string, values?: HrefTokenValues): string {
  const text = String(href ?? '')
  if (!text.includes('{{')) return text
  return text.replace(TOKEN_PATTERN, (_match, token: string) => {
    if (!ALLOWED.has(token)) return ''
    const value = values?.[token as HrefToken]
    return value ? encode(String(value)) : ''
  })
}
