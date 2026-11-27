/**
 * Tells an open dashboard tab that a different build of the app is live.
 *
 * Each production build bakes an id into its code (`NEXT_PUBLIC_BUILD_ID`,
 * next.config.js), and the server answers `/version` with the id of the build
 * it runs. When the two differ, the tab runs old code. The app never reloads
 * in place by itself: an open form would lose what the person typed.
 *
 * Plain functions with no React and no globals at import, so the rules are
 * tested without a browser.
 */

/** The route that answers with the id of the running build. */
export const VERSION_PATH = '/version'

/** How often a visible tab checks for a new deploy. */
export const CHECK_INTERVAL_MS = 5 * 60 * 1000

/**
 * Focus and visibility events come in pairs (switching back to a tab fires
 * both), and focus fires on every click back from another window. One request
 * per this window is enough.
 */
export const MIN_CHECK_GAP_MS = 15 * 1000

/** The id baked into this build, or null when the build has none. */
export function runningBuildId(): string | null {
  return process.env.NEXT_PUBLIC_BUILD_ID || null
}

/** The id in a parsed `/version` body, or null for anything else. */
export function readVersionId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const id = (body as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : null
}

/**
 * The id of the build the server runs now, or null when it cannot be told.
 * Every failure is null: no connection, an error status, and a body that is
 * not JSON (a proxy or error page answering in its place).
 */
export async function fetchDeployedVersion(
  request: typeof fetch
): Promise<string | null> {
  try {
    const res = await request(VERSION_PATH, { cache: 'no-store' })
    if (!res.ok) return null
    return readVersionId(await res.json())
  } catch {
    return null
  }
}

/**
 * Whether the server runs a different build from this one. Different, not
 * newer: a rollback is a different build too. A null on either side is never
 * a new version.
 */
export function isNewVersion(
  running: string | null,
  deployed: string | null
): boolean {
  return running !== null && deployed !== null && running !== deployed
}

export interface VersionWatchEnv {
  /** The id baked into the running build. Null means never check. */
  buildId: string | null
  fetchVersion: () => Promise<string | null>
  /** The page's document: its visibility and its `visibilitychange` event. */
  doc: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  >
  /** The window, for `focus`. */
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>
  now: () => number
  /** Called once with the deployed id, when it differs. Checking stops then. */
  onNewVersion: (deployed: string) => void
}

/**
 * Checks for a new deploy when the tab comes back into view or gets focus, and
 * every `CHECK_INTERVAL_MS` while it is visible. A hidden tab makes no
 * requests. Returns a function that stops all of it.
 */
export function startVersionWatch(env: VersionWatchEnv): () => void {
  if (env.buildId === null) return () => {}

  let stopped = false
  let inFlight = false
  let lastCheck = env.now()

  const check = async () => {
    if (stopped || inFlight || env.doc.visibilityState !== 'visible') return
    if (env.now() - lastCheck < MIN_CHECK_GAP_MS) return
    inFlight = true
    lastCheck = env.now()
    try {
      const deployed = await env.fetchVersion()
      if (!stopped && deployed !== null && isNewVersion(env.buildId, deployed)) {
        stop()
        env.onNewVersion(deployed)
      }
    } finally {
      inFlight = false
    }
  }
  const onEvent = () => void check()

  const timer = setInterval(onEvent, CHECK_INTERVAL_MS)
  env.doc.addEventListener('visibilitychange', onEvent)
  env.win.addEventListener('focus', onEvent)

  function stop() {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    env.doc.removeEventListener('visibilitychange', onEvent)
    env.win.removeEventListener('focus', onEvent)
  }
  return stop
}
