import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { TestProviders } from '@/test/render'
import { API_BASE_URL } from '@/test/fixtures'
import { ApiEndpoints } from '@/config/api'
import { useSmsPermissionFastPoll } from './hooks'

const OLD_FAILURE = {
  needsSmsPermission: true,
  hoursSinceFailure: 5,
  deviceId: 'd1',
  deviceName: 'Pixel 8',
  failedAt: '2026-09-27T07:00:00.000Z',
  source: 'failure',
}

const respond = (data: Record<string, unknown>) =>
  server.use(
    http.get(`${API_BASE_URL}${ApiEndpoints.gateway.smsPermissionStatus()}`, () =>
      HttpResponse.json({ data })
    )
  )

describe('useSmsPermissionFastPoll', () => {
  it('reports a new permission failure within seconds of a send', async () => {
    respond({ needsSmsPermission: false, source: null, failedAt: null })
    const { result } = renderHook(() => useSmsPermissionFastPoll(), {
      wrapper: TestProviders,
    })
    await waitFor(() => expect(result.current.status).toBeDefined())

    act(() => result.current.start())
    respond({ ...OLD_FAILURE, failedAt: '2026-09-27T12:00:00.000Z' })

    await waitFor(() => expect(result.current.sendFailedForPermission).toBe(true), {
      timeout: 5_000,
    })
  })

  it('ignores a failure that was already showing before the send', async () => {
    respond(OLD_FAILURE)
    const { result } = renderHook(() => useSmsPermissionFastPoll(), {
      wrapper: TestProviders,
    })
    await waitFor(() => expect(result.current.status?.needsSmsPermission).toBe(true))

    act(() => result.current.start())

    expect(result.current.sendFailedForPermission).toBe(false)
  })
})
