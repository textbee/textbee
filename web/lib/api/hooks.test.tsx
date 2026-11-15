import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { TestProviders } from '@/test/render'
import { API_BASE_URL, mockDevices, mockSubscription, mockUser } from '@/test/fixtures'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import {
  useCurrentUser,
  useDevices,
  useRevokeApiKey,
  useSubscription,
  useWebhookNotifications,
} from './hooks'
import { queryKeys } from './query-keys'

// Verifies the typed hooks talk to the mocked API and unwrap the various
// response envelopes correctly. No real backend is contacted (MSW).
const wrapper = TestProviders

describe('data hooks', () => {
  it('useCurrentUser unwraps res.data.data', async () => {
    const { result } = renderHook(() => useCurrentUser(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.email).toBe(mockUser.email)
  })

  it('useSubscription returns the raw body', async () => {
    const { result } = renderHook(() => useSubscription(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.plan?.name).toBe(mockSubscription.plan.name)
  })

  it('useDevices unwraps to the device array', async () => {
    const { result } = renderHook(() => useDevices(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(mockDevices.length)
    expect(result.current.data?.[0]._id).toBe(mockDevices[0]._id)
  })

  // Regression for #256: start/end were query params but not query-key
  // members, so changing the date filter reused a cached response.
  it('useWebhookNotifications refetches when the date range changes', async () => {
    const startsSeen: string[] = []
    server.use(
      http.get(
        `${API_BASE_URL}${ApiEndpoints.gateway.getWebhookNotifications().split('?')[0]}`,
        ({ request }) => {
          const start = new URL(request.url).searchParams.get('start') ?? ''
          startsSeen.push(start)
          return HttpResponse.json({
            data: { data: [], meta: { totalPages: 1, total: 0 } },
          })
        }
      )
    )

    const { result, rerender } = renderHook(
      ({ start }) => useWebhookNotifications({ start, page: 1, limit: 10 }),
      {
        wrapper,
        initialProps: { start: '2026-08-01T00:00:00.000Z' },
      }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(startsSeen).toEqual(['2026-08-01T00:00:00.000Z'])

    rerender({ start: '2026-07-01T00:00:00.000Z' })

    await waitFor(() =>
      expect(startsSeen).toEqual([
        '2026-08-01T00:00:00.000Z',
        '2026-07-01T00:00:00.000Z',
      ])
    )
  })

  // A device that used the revoked key must show it without a reload.
  it('useRevokeApiKey refreshes the device list', async () => {
    server.use(
      http.post(`${API_BASE_URL}${ApiEndpoints.auth.revokeApiKey('key_1')}`, () =>
        HttpResponse.json({ message: 'API Key Revoked' })
      )
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(queryKeys.devices, { data: mockDevices })

    const { result } = renderHook(() => useRevokeApiKey(), {
      wrapper: ({ children }) => (
        <TestProviders queryClient={queryClient}>{children}</TestProviders>
      ),
    })
    await act(() => result.current.mutateAsync('key_1'))

    expect(queryClient.getQueryState(queryKeys.devices)?.isInvalidated).toBe(true)
  })
})
