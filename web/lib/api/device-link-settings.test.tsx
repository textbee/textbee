import { describe, expect, it } from 'vitest'
import { http, HttpResponse } from 'msw'
import type { Session } from 'next-auth'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import {
  TestProviders,
  makeTestQueryClient,
  mockSession,
  render,
  screen,
} from '@/test/render'
import { useDeviceLinkSettings } from './hooks'
import { queryKeys } from './query-keys'

function Probe() {
  const { data } = useDeviceLinkSettings()
  return <p>{data ? `enabled ${data.enabled}` : 'no answer'}</p>
}

const sessionFor = (id: string): Session => ({
  ...mockSession,
  user: { ...mockSession.user, id },
})

describe('phone sign-in settings cache', () => {
  it('keeps one answer per account and asks again for another account', async () => {
    let asked = 0
    server.use(
      http.get(`${API_BASE_URL}/auth/device-link-settings`, () => {
        asked++
        return HttpResponse.json({
          data: { enabled: asked === 1, defaultTab: 'code' },
        })
      })
    )
    // One client for the whole tab, as in the app
    const client = makeTestQueryClient()
    const mount = (id: string) =>
      render(
        <TestProviders session={sessionFor(id)} queryClient={client}>
          <Probe />
        </TestProviders>
      )

    const first = mount('account_a')
    expect(await screen.findByText('enabled true')).toBeInTheDocument()
    first.unmount()

    // The same account again: the answer of this page session, no new call
    const again = mount('account_a')
    expect(screen.getByText('enabled true')).toBeInTheDocument()
    again.unmount()
    expect(asked).toBe(1)

    // Signed out, then signed in as another account in the same tab
    mount('account_b')
    expect(await screen.findByText('enabled false')).toBeInTheDocument()
    expect(asked).toBe(2)
    expect(client.getQueryData(queryKeys.deviceLinkSettings('account_a'))).toEqual({
      enabled: true,
      defaultTab: 'code',
    })
  })

  it('asks nothing without a signed-in account', async () => {
    let asked = 0
    server.use(
      http.get(`${API_BASE_URL}/auth/device-link-settings`, () => {
        asked++
        return HttpResponse.json({ data: { enabled: true } })
      })
    )
    render(
      <TestProviders session={null}>
        <Probe />
      </TestProviders>
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText('no answer')).toBeInTheDocument()
    expect(asked).toBe(0)
  })
})
