import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '@/test/render'
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

const renderStack = () =>
  renderWithProviders(
    <NotificationProvider>
      <NotificationTileStack />
    </NotificationProvider>,
  )

beforeEach(() => {
  window.localStorage.clear()
})

describe('which implementation mounts', () => {
  it('renders the engine and not the legacy stack when the flag is on', async () => {
    renderStack()

    expect(await screen.findByText('Upgrade to Pro')).toBeInTheDocument()
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
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument()
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
    expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument()

    release?.()
    expect(await screen.findByText('Upgrade to Pro')).toBeInTheDocument()
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

    expect(await screen.findByText('Upgrade to Pro')).toBeInTheDocument()
    expect(screen.getByText('More messages every month.')).toBeInTheDocument()
    const action = screen.getByRole('link', { name: 'See Pro' })
    expect(action).toHaveAttribute('href', '/checkout/pro')
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
    await screen.findByText('Upgrade to Pro')

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
    await screen.findByText('Upgrade to Pro')

    await userEvent.click(
      screen.getByRole('button', { name: /Dismiss: Upgrade to Pro/ }),
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
              key: 'past-due-billing',
              kind: 'system',
              tone: 'critical',
              dismissible: false,
            },
          ],
        }),
      ),
    )

    renderStack()
    await screen.findByText('Upgrade to Pro')

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
    expect(await screen.findByText('Upgrade to Pro')).toBeInTheDocument()
  })
})

describe('carrying over dismissals already made in this browser', () => {
  it('sends a dismissal for a message this browser had cleared', async () => {
    window.localStorage.setItem('discord_banner_dismissed', '1')
    const posted: any[] = []
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            { ...mockNotificationFeed.notifications[0], key: 'join-discord' },
          ],
        }),
      ),
      http.post(`${API}${ApiEndpoints.notifications.events()}`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ recorded: 1 })
      }),
    )

    renderStack()
    await screen.findByText('Upgrade to Pro')

    await waitFor(() => {
      const dismissals = posted.flatMap((body) =>
        body.events.filter((e: any) => e.type === 'dismiss'),
      )
      expect(dismissals).toHaveLength(1)
    })
  })

  it('leaves the legacy keys in place, so turning the engine off still honours them', async () => {
    window.localStorage.setItem('discord_banner_dismissed', '1')
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            { ...mockNotificationFeed.notifications[0], key: 'join-discord' },
          ],
        }),
      ),
    )

    renderStack()
    await screen.findByText('Upgrade to Pro')
    await waitFor(() =>
      expect(window.localStorage.getItem(MIGRATION_MARKER)).toBe('1'),
    )

    // Clearing it here would resurrect dismissed banners on rollback. They are
    // removed with the legacy components, not before.
    expect(window.localStorage.getItem('discord_banner_dismissed')).toBe('1')
  })

  it('does not mark itself done when the post fails, so the dismissals are not lost', async () => {
    window.localStorage.setItem('discord_banner_dismissed', '1')
    server.use(
      http.get(feedUrl, () =>
        HttpResponse.json({
          ...mockNotificationFeed,
          notifications: [
            { ...mockNotificationFeed.notifications[0], key: 'join-discord' },
          ],
        }),
      ),
      http.post(`${API}${ApiEndpoints.notifications.events()}`, () =>
        HttpResponse.error(),
      ),
    )

    renderStack()
    await screen.findByText('Upgrade to Pro')

    // Marking it done here would lose the dismissal for good, and the engine
    // would then show messages this reader had already cleared.
    await waitFor(() =>
      expect(window.localStorage.getItem(MIGRATION_MARKER)).toBeNull(),
    )
  })

  it('only runs once', async () => {
    window.localStorage.setItem(MIGRATION_MARKER, '1')
    window.localStorage.setItem('discord_banner_dismissed', '1')
    const posted: any[] = []
    server.use(
      http.post(`${API}${ApiEndpoints.notifications.events()}`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json({ recorded: 1 })
      }),
    )

    renderStack()
    await screen.findByText('Upgrade to Pro')
    await waitFor(() => expect(posted.length).toBeGreaterThan(0))

    const dismissals = posted.flatMap((body) =>
      body.events.filter((e: any) => e.type === 'dismiss'),
    )
    expect(dismissals).toHaveLength(0)
  })
})
