// How a request is labelled before its origin is recorded.
//
// Everything here is a pure function of the request. The values are bounded
// labels, never free text from the caller, so a hostile user agent cannot grow
// a document or invent a channel.

export const ACCESS_CHANNELS = ['web', 'api', 'device'] as const
export type AccessChannel = (typeof ACCESS_CHANNELS)[number]

// Routes only the phone app calls. Builds that predate the client header are
// still placed correctly by these.
const DEVICE_ROUTE =
  /\/gateway\/devices\/[^/]+\/(heartbeat|receive-sms|receiveSMS|sms-status)$/

// The client header the official clients send, for example textbee-js/1.4.0.
const ANDROID_CLIENT = 'textbee-android'

const CLIENT_FAMILIES: { label: string; match: RegExp }[] = [
  { label: 'textbee-mcp-remote', match: /^textbee-mcp-remote\// },
  { label: 'textbee-mcp', match: /^textbee-mcp\// },
  { label: 'textbee-n8n', match: /^textbee-n8n\// },
  { label: 'textbee-js', match: /^textbee-js\b/ },
  { label: 'textbee-python', match: /^textbee-python\b/ },
  { label: 'textbee-android', match: /^textbee-android\b/ },
]

const USER_AGENT_FAMILIES: { label: string; match: RegExp }[] = [
  { label: 'browser', match: /mozilla\/|chrome\/|safari\/|firefox\/|edg\// },
  { label: 'curl', match: /^curl\// },
  { label: 'wget', match: /^wget\// },
  { label: 'postman', match: /postmanruntime/ },
  { label: 'insomnia', match: /insomnia/ },
  { label: 'python', match: /python-requests|httpx|aiohttp|urllib/ },
  { label: 'node', match: /axios\/|node-fetch|undici|got \(|^node\// },
  { label: 'php', match: /guzzlehttp|^php\/|symfony httpclient/ },
  { label: 'go', match: /^go-http-client/ },
  { label: 'java', match: /okhttp\/|apache-httpclient|^java\// },
  { label: 'dotnet', match: /^\.net|restsharp/ },
  { label: 'ruby', match: /^ruby|faraday/ },
]

/** The path without its query string, which is where a key may appear. */
export function requestPath(url: string | undefined): string {
  return (url ?? '').split('?')[0]
}

/**
 * Which way into the account this request came: the dashboard in a browser,
 * an API key on someone's own server, or the phone app.
 *
 * A bearer token is only ever minted for a dashboard session. An API key is
 * shared by the app and by customer code, so the app is recognised by the
 * routes only it calls or by the client header newer builds send.
 */
export function classifyChannel({
  hasBearer,
  path,
  sdkClient,
}: {
  hasBearer: boolean
  path?: string
  sdkClient?: string
}): AccessChannel {
  if (hasBearer) return 'web'
  if (sdkClient?.toLowerCase().startsWith(ANDROID_CLIENT)) return 'device'
  if (DEVICE_ROUTE.test(requestPath(path))) return 'device'
  return 'api'
}

/**
 * Which kind of client made the request, as one of a fixed set of labels.
 * The declared client wins, since a caller that names itself is more reliable
 * than a user agent string.
 */
export function classifyClient({
  sdkClient,
  userAgent,
}: {
  sdkClient?: string
  userAgent?: string
}): string {
  const declared = sdkClient?.trim().toLowerCase()
  if (declared) {
    const known = CLIENT_FAMILIES.find((family) => family.match.test(declared))
    if (known) return known.label
  }

  const agent = userAgent?.trim().toLowerCase()
  if (!agent) return 'unknown'

  // Browsers first: several of them also carry tokens that look like a library.
  const family = USER_AGENT_FAMILIES.find((entry) => entry.match.test(agent))
  return family ? family.label : 'other'
}

/**
 * Remembers keys for a while so repeated work can be skipped.
 *
 * Insertion ordered, so the oldest key is the first one out when the map is
 * full, and a key seen again moves back to the end. Expiry is checked on read
 * and swept in bulk occasionally, so nothing here holds a timer and nothing
 * keeps the process alive.
 */
export class RecentKeys<T = true> {
  private readonly entries = new Map<string, { expires: number; value: T }>()
  private writes = 0

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
    private readonly sweepEvery = 10_000,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expires <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    // Seen again, so it is hot: move it away from the eviction end.
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  remember(key: string, value: T = true as unknown as T): void {
    this.entries.delete(key)
    this.entries.set(key, { expires: Date.now() + this.windowMs, value })

    if (++this.writes % this.sweepEvery === 0) this.sweep()
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }

  forget(key: string): void {
    this.entries.delete(key)
  }

  get size(): number {
    return this.entries.size
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(key)
    }
  }
}
