import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_INTERVAL_MS,
  MIN_CHECK_GAP_MS,
  VERSION_PATH,
  fetchDeployedVersion,
  isNewVersion,
  readVersionId,
  runningBuildId,
  startVersionWatch,
  type VersionWatchEnv,
} from './new-version'

describe('runningBuildId', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is the baked id, or null for a build without one', () => {
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', 'abc.123')
    expect(runningBuildId()).toBe('abc.123')
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '')
    expect(runningBuildId()).toBeNull()
  })
})

describe('readVersionId', () => {
  it('reads a non-empty string id', () => {
    expect(readVersionId({ id: 'b2' })).toBe('b2')
  })

  it('rejects anything else', () => {
    expect(readVersionId(null)).toBeNull()
    expect(readVersionId('abc')).toBeNull()
    expect(readVersionId({})).toBeNull()
    expect(readVersionId({ id: 42 })).toBeNull()
    expect(readVersionId({ id: '' })).toBeNull()
  })
})

describe('fetchDeployedVersion', () => {
  const answer = (body: string, status = 200) =>
    vi.fn(async () => new Response(body, { status }))

  it('reads the id, bypassing every cache', async () => {
    const request = answer('{"id":"b2"}')
    await expect(fetchDeployedVersion(request)).resolves.toBe('b2')
    expect(request).toHaveBeenCalledWith(VERSION_PATH, { cache: 'no-store' })
  })

  it('is null on an error status', async () => {
    await expect(
      fetchDeployedVersion(answer('{"id":"b2"}', 500))
    ).resolves.toBeNull()
    await expect(
      fetchDeployedVersion(answer('Not found', 404))
    ).resolves.toBeNull()
  })

  it('is null for a body that is not JSON', async () => {
    await expect(
      fetchDeployedVersion(answer('<!doctype html><html></html>'))
    ).resolves.toBeNull()
  })

  it('is null for JSON without an id', async () => {
    await expect(fetchDeployedVersion(answer('{"ok":true}'))).resolves.toBeNull()
  })

  it('is null with no connection', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(fetchDeployedVersion(request)).resolves.toBeNull()
  })
})

describe('isNewVersion', () => {
  it('is true only for two known, different ids', () => {
    expect(isNewVersion('a', 'b')).toBe(true)
    expect(isNewVersion('a', 'a')).toBe(false)
    expect(isNewVersion('a', null)).toBe(false)
    expect(isNewVersion(null, 'b')).toBe(false)
  })

  it('counts an older build (a rollback) as new', () => {
    expect(isNewVersion('def.m3', 'abc.m1')).toBe(true)
  })
})

describe('startVersionWatch', () => {
  type Listener = () => void

  function target() {
    const listeners = new Map<string, Set<Listener>>()
    return {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (type: string, fn: Listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set())
        listeners.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: Listener) =>
        void listeners.get(type)?.delete(fn),
      fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
      count: () =>
        [...listeners.values()].reduce((n, set) => n + set.size, 0),
    }
  }

  function setup(deployed: string | null, buildId: string | null = 'a') {
    const doc = target()
    const win = target()
    const fetchVersion = vi.fn(async () => deployed)
    const onNewVersion = vi.fn()
    const env = {
      buildId,
      fetchVersion,
      doc: doc as unknown as VersionWatchEnv['doc'],
      win: win as unknown as VersionWatchEnv['win'],
      now: () => Date.now(),
      onNewVersion,
    } satisfies VersionWatchEnv
    const stop = startVersionWatch(env)
    return { doc, win, fetchVersion, onNewVersion, stop }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks every 5 minutes while visible, and finds nothing on the same build', async () => {
    const w = setup('a')
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(w.fetchVersion).toHaveBeenCalledTimes(2)
    expect(w.onNewVersion).not.toHaveBeenCalled()
    w.stop()
  })

  it('reports a different build once with its id, then stops checking', async () => {
    const w = setup('b')
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(w.onNewVersion).toHaveBeenCalledTimes(1)
    expect(w.onNewVersion).toHaveBeenCalledWith('b')
    expect(w.doc.count() + w.win.count()).toBe(0)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3)
    expect(w.fetchVersion).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the version cannot be read', async () => {
    const w = setup(null)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(w.fetchVersion).toHaveBeenCalledTimes(1)
    expect(w.onNewVersion).not.toHaveBeenCalled()
    w.stop()
  })

  it('never checks on a build without an id', async () => {
    const w = setup('b', null)
    w.doc.fire('visibilitychange')
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2)
    expect(w.fetchVersion).not.toHaveBeenCalled()
    expect(w.doc.count() + w.win.count()).toBe(0)
  })

  it('makes no request while the tab is hidden', async () => {
    const w = setup('b')
    w.doc.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2)
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fetchVersion).not.toHaveBeenCalled()
    w.stop()
  })

  it('checks when the tab comes back into view', async () => {
    const w = setup('b')
    w.doc.visibilityState = 'hidden'
    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS)
    w.doc.visibilityState = 'visible'
    w.doc.fire('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fetchVersion).toHaveBeenCalledTimes(1)
    expect(w.onNewVersion).toHaveBeenCalledTimes(1)
  })

  it('checks when the window gets focus', async () => {
    const w = setup('b')
    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS)
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fetchVersion).toHaveBeenCalledTimes(1)
    expect(w.onNewVersion).toHaveBeenCalledTimes(1)
  })

  it('makes one request for a burst of focus and visibility events', async () => {
    const w = setup('a')
    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS)
    w.doc.fire('visibilitychange')
    w.win.fire('focus')
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS - 1)
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fetchVersion).toHaveBeenCalledTimes(1)
    w.stop()
  })

  it('does not check right after the page loads', async () => {
    const w = setup('b')
    w.win.fire('focus')
    await vi.advanceTimersByTimeAsync(0)
    expect(w.fetchVersion).not.toHaveBeenCalled()
    w.stop()
  })

  it('stop removes every listener and the timer', async () => {
    const w = setup('b')
    w.stop()
    expect(w.doc.count() + w.win.count()).toBe(0)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2)
    expect(w.fetchVersion).not.toHaveBeenCalled()
  })

  it('ignores an answer that arrives after stop', async () => {
    const doc = target()
    const win = target()
    let resolve: (id: string) => void = () => {}
    const onNewVersion = vi.fn()
    const stop = startVersionWatch({
      buildId: 'a',
      fetchVersion: () => new Promise((r) => (resolve = r)),
      doc: doc as unknown as VersionWatchEnv['doc'],
      win: win as unknown as VersionWatchEnv['win'],
      now: () => Date.now(),
      onNewVersion,
    })
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    stop()
    resolve('b')
    await vi.advanceTimersByTimeAsync(0)
    expect(onNewVersion).not.toHaveBeenCalled()
  })
})
