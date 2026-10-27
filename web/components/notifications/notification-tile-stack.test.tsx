import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { makeTestQueryClient, renderWithProviders } from '@/test/render'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import {
  mockNotificationFeed,
  mockNotificationFeedDisabled,
} from '@/test/fixtures'
import { NotificationProvider } from './notification-provider'
import { NotificationTileStack } from './notification-tile-stack'
import { MIGRATION_MARKER } from './dismissal-migration'

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? ''
const feedUrl = `${API}${ApiEndpoints.notifications.feed()}`

// The legacy stack reaches for subscription and account data of its own, so it
// is stubbed out here: these tests are about which branch mounts, not about what
// the old banners render.
vi.mock('./legacy-alert-stack', () => ({
  LegacyAlertStack: () => <div data-testid='legacy-stack'>legacy</div>,
}))

// The Toaster is mounted by the app shell, not by renderWithProviders, so the
// call is asserted instead of the rendered toast.
const toastSpy = vi.fn()
vi.mock('@/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => toastSpy(...args),
  useToast: () => ({ toast: toastSpy, toasts: [], dismiss: () => undefined }),
}))

const renderStack = () =>
  renderWithProviders(
    <NotificationProvider>
      <NotificationTileStack />
    </NotificationProvider>,
  )

beforeEach(() => {
  window.localStorage.clear()
  toastSpy.mockClear()
})

describe('which implementation mounts', () => {
  it('renders the engine and not the legacy stack when the flag is on', async () => {
    renderStack()

    expect(await screen.findByText('Example campaign')).toBeInTheDocument()
    // Absent from the tree, not merely hidden: each legacy alert runs its own
    // queries, so a hidden mount would still cost them.
    expect(screen.queryByTestId('legacy-stack')).not.toBeInTheDocument()
  })

  it('renders the legacy stack and no engine tiles when the flag is off', async () => {
    server.use(
      http.get(feedUrl, () => HttpResponse.json(mockNotificationFeedDisabled)),
    )

    renderStack()

    expect(await screen.findByTestId('legacy-stack')).toBeInTheDocument()
    expect(screen.queryByText('Example campaign')).not.toBeInTheDocument()
  })

  it('falls back to the legacy stack when the feed errors', async () => {
    server.use(http.get(feedUrl, () => HttpResponse.error()))

    renderStack()

    // The case that matters: an API problem must degrade to the older messages,
    // not silently remove every past-due and verification warning.
    //
    // Allowed longer than the default: the feed retries once before giving up,
    // so the slot stays empty for about a second first. That is deliberate, and
    // it is the same empty slot the built-in alerts already show while their own
    // queries resolve.
    expect(
      await screen.findByTestId('legacy-stack', {}, { timeout: 5000 }),
    ).toBeInTheDocument()
  })

  it('renders neither while the feed is in flight', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(feedUrl, async () => {
        await gate
        return HttpResponse.json(mockNotificationFeed)
      }),
    )

    renderStack()

    expect(screen.queryByTestId('legacy-stack')).not.toBeInTheDocument()
    expect(screen.queryByText('Example campaign')).not.toBeInTheDocument()

    release?.()
    expect(await screen.findByText('Example campaign')).toBeInTheDocument()
  })

  it('renders nothing when the engine is on but has nothing to say', async () => {
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({ ...mockNotificationFeed, notifications: [] }),
      ),
    )

    const { container } = renderStack()

    await waitFor(() => {
      expect(screen.queryByTestId('legacy-stack')).not.toBeInTheDocument()
    })
    expect(container.textContent).toBe('')
  })
})

describe('the tile itself', () => {
  it('shows the title, body and actions it was given', async () => {
    renderStack()

    expect(await screen.findByText('Example campaign')).toBeInTheDocument()
    expect(screen.getByText('An example body.')).toBeInTheDocument()
    const action = screen.getByRole('link', { name: 'Example action' })
    expect(action).toHaveAttribute('href', '/dashboard')
  })

  it('reports one impression even across a rerender', async () => {
    const seen: unknown[] = []
    server.use(
      http.post(`${API}${ApiEndpoints.notifications.events()}`, async ({ request }) => {
        seen.push(await request.json())
        return HttpResponse.json({ recorded: 1 })
      }),
    )

    const { rerender } = renderStack()
    await screen.findByText('Example campaign')

    rerender(
      <NotificationProvider>
        <NotificationTileStack />
      </NotificationProvider>,
    )

    await waitFor(() => expect(seen.length).toBe(1))
  })

  it('posts a dismissal when the close control is used', async () => {
    let dismissed = false
    server.use(
      http.post(
        `${API}${ApiEndpoints.notifications.dismiss(mockNotificationFeed.notifications[0].id)}`,
        () => {
          dismissed = true
          return HttpResponse.json({ success: true })
        },
      ),
    )

    renderStack()
    await screen.findByText('Example campaign')

    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Example campaign/ }),
    )

    await waitFor(() => expect(dismissed).toBe(true))
  })

  it('offers no close control on a message that cannot be dismissed', async () => {
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            {
              ...mockNotificationFeed.notifications[0],
              key: 'example-alert',
              kind: 'system',
              tone: 'critical',
              dismissible: false,
            },
          ],
        }),
      ),
    )

    renderStack()
    await screen.findByText('Example campaign')

    expect(screen.queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument()
  })

  it('falls back to the standard tile for a renderer it does not know', async () => {
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            {
              ...mockNotificationFeed.notifications[0],
              renderer: 'something-invented-later',
            },
          ],
        }),
      ),
    )

    renderStack()

    // A record can be authored at any time; the dashboard must not break.
    expect(await screen.findByText('Example campaign')).toBeInTheDocument()
  })
})

describe('carrying over dismissals already made in this browser', () => {
  const eventsUrl = `${API}${ApiEndpoints.notifications.events()}`
  // One of the keys a built-in message wrote. The pairing to a record is the
  // server's to decide, so the test only has to stand a value in it.
  const LEGACY_KEY = 'discord_banner_dismissed'
  const servedTile = mockNotificationFeed.notifications[0]

  const feedWith = (
    migrations: Array<{ notificationId: string; storageKey: string }>,
    notifications: unknown[] = mockNotificationFeed.notifications,
  ) =>
    http.get(feedUrl, () =>
      HttpResponse.json({
        ...mockNotificationFeed,
        notifications,
        dismissalMigrations: migrations,
      }),
    )

  const collectPosts = () => {
    const posted: any[] = []
    server.use(
      http.post(eventsUrl, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ recorded: 1 })
      }),
    )
    return posted
  }

  const dismissalsIn = (posted: any[]) =>
    posted.flatMap((body) =>
      body.events.filter((e: any) => e.type === 'dismiss'),
    )

  it('sends a dismissal for a message this browser had cleared', async () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
    )
    const posted = collectPosts()

    renderStack()
    await screen.findByText('Example campaign')

    await waitFor(() => {
      expect(dismissalsIn(posted)).toHaveLength(1)
    })
    expect(dismissalsIn(posted)[0].notificationId).toBe(servedTile.id)
  })

  it('sends a dismissal for a record the feed held back', async () => {
    // The whole point of taking the pairings from the feed. This id is not in
    // the served list, because the ranker had no slot left for it, and the
    // dismissal must still reach the server rather than being dropped and the
    // one-shot marker written anyway.
    const heldBackId = '6700000000000000000000b7'
    window.localStorage.setItem(LEGACY_KEY, '1')
    server.use(feedWith([{ notificationId: heldBackId, storageKey: LEGACY_KEY }]))
    const posted = collectPosts()

    renderStack()
    await screen.findByText('Example campaign')

    await waitFor(() => {
      expect(dismissalsIn(posted)).toHaveLength(1)
    })
    expect(dismissalsIn(posted)[0].notificationId).toBe(heldBackId)
    await waitFor(() =>
      expect(window.localStorage.getItem(MIGRATION_MARKER)).toBe('1'),
    )
  })

  // The built-in components wrote one or the other, so both have to count.
  it.each(['1', 'true'])('treats %s as a dismissal', async (value) => {
    window.localStorage.setItem(LEGACY_KEY, value)
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
    )
    const posted = collectPosts()

    renderStack()
    await screen.findByText('Example campaign')

    await waitFor(() => expect(dismissalsIn(posted)).toHaveLength(1))
  })

  // An unset flag is not a dismissal. Reading one as one would silently clear a
  // message the reader has never seen.
  it.each(['0', 'false', ''])('does not treat %j as a dismissal', async (value) => {
    window.localStorage.setItem(LEGACY_KEY, value)
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
    )
    const posted = collectPosts()

    renderStack()
    await screen.findByText('Example campaign')

    // The impression lands, so there is a post to wait for before asserting
    // that no dismissal is in it.
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))
    expect(dismissalsIn(posted)).toHaveLength(0)
  })

  it('leaves the legacy keys in place, so turning the engine off still honours them', async () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
    )

    renderStack()
    await screen.findByText('Example campaign')
    await waitFor(() =>
      expect(window.localStorage.getItem(MIGRATION_MARKER)).toBe('1'),
    )

    // Clearing it here would resurrect dismissed banners on rollback. They are
    // removed with the legacy components, not before.
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('1')
  })

  it('does not mark itself done when the post fails, so the dismissals are not lost', async () => {
    window.localStorage.setItem(LEGACY_KEY, '1')
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
      http.post(eventsUrl, () => HttpResponse.error()),
    )

    renderStack()
    await screen.findByText('Example campaign')

    // Marking it done here would lose the dismissal for good, and the engine
    // would then show messages this reader had already cleared.
    await waitFor(() =>
      expect(window.localStorage.getItem(MIGRATION_MARKER)).toBeNull(),
    )
  })

  it('only runs once', async () => {
    window.localStorage.setItem(MIGRATION_MARKER, '1')
    window.localStorage.setItem(LEGACY_KEY, '1')
    server.use(
      feedWith([{ notificationId: servedTile.id, storageKey: LEGACY_KEY }]),
    )
    const posted = collectPosts()

    renderStack()
    await screen.findByText('Example campaign')
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))

    expect(dismissalsIn(posted)).toHaveLength(0)
  })
})

describe('dismissing a message', () => {
  const tile = mockNotificationFeed.notifications[0]
  const dismissUrl = `${API}${ApiEndpoints.notifications.dismiss(tile.id)}`

  it('removes the message on the click, before the post has landed', async () => {
    let releasePost: (() => void) | undefined
    const posted = new Promise<void>((resolve) => {
      releasePost = resolve
    })
    server.use(
      http.post(dismissUrl, async () => {
        await posted
        return HttpResponse.json({ success: true })
      }),
    )

    renderStack()
    await screen.findByText('Example campaign')

    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Example campaign/ }),
    )

    // The point of the optimistic update: gone now, not two round trips later.
    await waitFor(() =>
      expect(screen.queryByText('Example campaign')).not.toBeInTheDocument(),
    )
    releasePost?.()
  })

  it('puts the message back and reports the failure when the post fails', async () => {
    let feedCalls = 0
    server.use(
      // The refetch after the failure is held open, so the only thing that can
      // bring the message back is the rollback.
      http.get(feedUrl, async () => {
        feedCalls += 1
        if (feedCalls > 1) await new Promise(() => undefined)
        return HttpResponse.json(mockNotificationFeed)
      }),
      http.post(dismissUrl, () => HttpResponse.error()),
    )

    renderStack()
    await screen.findByText('Example campaign')

    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Example campaign/ }),
    )

    await waitFor(() => expect(toastSpy).toHaveBeenCalled())
    expect(toastSpy.mock.calls[0][0]).toMatchObject({
      variant: 'destructive',
    })
    expect(screen.getByText('Example campaign')).toBeInTheDocument()
  })
})

describe('messages held back by the cap', () => {
  const overflowFeed = {
    ...mockNotificationFeed,
    notifications: [
      mockNotificationFeed.notifications[0],
      {
        ...mockNotificationFeed.notifications[0],
        id: '6700000000000000000000a2',
        key: 'held-one',
        title: 'Held one',
        overflow: true,
      },
      {
        ...mockNotificationFeed.notifications[0],
        id: '6700000000000000000000a3',
        key: 'held-two',
        title: 'Held two',
        overflow: true,
      },
    ],
  }

  it('collapses them behind a count and reveals them without a refetch', async () => {
    let feedCalls = 0
    server.use(
      http.get(feedUrl, () => {
        feedCalls += 1
        return HttpResponse.json(overflowFeed)
      }),
    )

    renderStack()
    await screen.findByText('Example campaign')

    expect(screen.queryByText('Held one')).not.toBeInTheDocument()
    const expander = screen.getByRole('button', {
      name: '2 more notifications',
    })

    const callsBefore = feedCalls
    await userEvent.click(expander)

    expect(await screen.findByText('Held one')).toBeInTheDocument()
    expect(screen.getByText('Held two')).toBeInTheDocument()
    expect(feedCalls).toBe(callsBefore)

    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(screen.queryByText('Held one')).not.toBeInTheDocument()
  })

  it('says nothing when the feed held nothing back', async () => {
    renderStack()
    await screen.findByText('Example campaign')

    expect(screen.queryByText(/more notification/)).not.toBeInTheDocument()
  })
})

describe('a message that cannot be dismissed', () => {
  it('says why there is no close control', async () => {
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            {
              ...mockNotificationFeed.notifications[0],
              kind: 'system',
              tone: 'critical',
              dismissible: false,
            },
          ],
        }),
      ),
    )

    renderStack()
    await screen.findByText('Example campaign')

    // A blank where the control would be is what reads as a broken button.
    expect(
      screen.getByLabelText('Stays until resolved'),
    ).toBeInTheDocument()
  })
})

describe('acting on a message', () => {
  const tile = mockNotificationFeed.notifications[0]

  const feedWith = (overrides: Record<string, unknown>) =>
    http.get(feedUrl, () =>
      HttpResponse.json({
        ...mockNotificationFeed,
        notifications: [{ ...tile, ...overrides }],
      }),
    )

  const trackDismiss = () => {
    const calls: string[] = []
    server.use(
      http.post(
        `${API}${ApiEndpoints.notifications.dismiss(tile.id)}`,
        () => {
          calls.push(tile.id)
          return HttpResponse.json({ success: true })
        },
      ),
    )
    return calls
  }

  // A hash href so jsdom resolves the click without an unimplemented navigation.
  const action = { actions: [{ label: 'Example action', href: '#pro' }] }

  it('clears a campaign the reader acted on', async () => {
    server.use(feedWith({ kind: 'campaign', ...action }))
    const dismissed = trackDismiss()

    renderStack()
    await screen.findByText('Example campaign')
    await userEvent.click(screen.getByRole('link', { name: 'Example action' }))

    // Otherwise the reader acts on it, comes back, and it is still sitting there.
    await waitFor(() => expect(dismissed).toHaveLength(1))
  })

  it('leaves standing status in place when the reader acts on it', async () => {
    server.use(feedWith({ kind: 'system', tone: 'warning', ...action }))
    const dismissed = trackDismiss()

    renderStack()
    await screen.findByText('Example campaign')
    await userEvent.click(screen.getByRole('link', { name: 'Example action' }))

    // Status stands until what it reports is actually resolved.
    await waitFor(() => expect(screen.getByText('Example campaign')).toBeInTheDocument())
    expect(dismissed).toHaveLength(0)
  })
})

describe('how the slot announces itself', () => {
  it('uses one polite region for the slot, not an assertive one per message', async () => {
    renderStack()
    const title = await screen.findByText('Example campaign')

    // role="alert" per message interrupted a screen reader on every load.
    expect(title.closest('[role="alert"]')).toBeNull()

    const slot = screen.getByRole('region', { name: 'Notifications' })
    expect(slot.querySelectorAll('[aria-live]')).toHaveLength(1)
    expect(slot.querySelector('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    )
  })
})

describe('two posts in the air at once', () => {
  const eventsUrl = `${API}${ApiEndpoints.notifications.events()}`
  const first = mockNotificationFeed.notifications[0]
  const second = {
    ...first,
    id: '6700000000000000000000c2',
    key: 'example-promo',
    title: 'Second message',
  }
  const twoTileFeed = { ...mockNotificationFeed, notifications: [first, second] }

  // The stack is mounted through a switch so it can be taken down and put back
  // while the provider, and the in-flight bookkeeping it holds, stays mounted.
  const Harness = ({ show }: { show: boolean }) => (
    <NotificationProvider>
      {show ? <NotificationTileStack /> : null}
    </NotificationProvider>
  )

  it('clears the in-flight entry for both impressions, so both can be retried', async () => {
    const attempted: string[] = []
    const recorded: string[] = []
    let failing = true
    server.use(
      http.get(feedUrl, () => HttpResponse.json(twoTileFeed)),
      http.post(eventsUrl, async ({ request }) => {
        const body = (await request.json()) as any
        const ids = body.events
          .filter((e: any) => e.type === 'impression')
          .map((e: any) => e.notificationId)
        attempted.push(...ids)
        if (failing) return HttpResponse.error()
        recorded.push(...ids)
        return HttpResponse.json({ recorded: ids.length })
      }),
    )

    const { rerender } = renderWithProviders(<Harness show />, {
      queryClient: makeTestQueryClient(),
    })
    await screen.findByText('Example campaign')
    await screen.findByText('Second message')

    // Both tiles report in the same commit, so the second post starts before
    // the first has settled.
    await waitFor(() => expect(attempted).toHaveLength(2))
    expect(new Set(attempted)).toEqual(new Set([first.id, second.id]))

    failing = false
    rerender(<Harness show={false} />)
    rerender(<Harness show />)

    // Only possible if each post kept its own completion. When the earlier call
    // loses it, its id stays in flight for the life of the page and that
    // impression is never counted.
    await waitFor(() =>
      expect(new Set(recorded)).toEqual(new Set([first.id, second.id])),
    )
  })

  it('re-enables both close controls when two dismissals overlap and fail', async () => {
    let releaseFirst: (() => void) | undefined
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    server.use(
      http.get(feedUrl, () => HttpResponse.json(twoTileFeed)),
      http.post(
        `${API}${ApiEndpoints.notifications.dismiss(first.id)}`,
        async () => {
          await firstInFlight
          return HttpResponse.error()
        },
      ),
      http.post(`${API}${ApiEndpoints.notifications.dismiss(second.id)}`, () =>
        HttpResponse.error(),
      ),
    )

    renderStack()
    await screen.findByText('Example campaign')

    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Example campaign/ }),
    )
    // Started while the first is still in the air.
    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Second message/ }),
    )

    await waitFor(() => expect(toastSpy).toHaveBeenCalled())
    releaseFirst?.()

    // Both rolled back, so neither close control may stay shut. When the
    // earlier dismissal loses its completion its id is never cleared, and its
    // close button stays disabled until the page is reloaded.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Dismiss: Example campaign/ }),
      ).not.toBeDisabled(),
    )
    expect(
      screen.getByRole('button', { name: /Dismiss: Second message/ }),
    ).not.toBeDisabled()
  })
})
