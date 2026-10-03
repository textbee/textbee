import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { TestProviders } from '@/test/render'
import { API_BASE_URL } from '@/test/fixtures'
import { server } from '@/test/msw/server'
import { ApiEndpoints } from '@/config/api'
import SmsPermissionAlert from './sms-permission-alert'

const respond = (data: Record<string, unknown>) =>
  server.use(
    http.get(`${API_BASE_URL}${ApiEndpoints.gateway.smsPermissionStatus()}`, () =>
      HttpResponse.json({ data })
    )
  )

describe('SmsPermissionAlert', () => {
  it('explains the fix and links the guide while sending is blocked', async () => {
    respond({
      needsSmsPermission: true,
      hoursSinceFailure: 2,
      deviceId: 'd1',
      deviceName: 'Pixel 8',
      failedAt: '2026-09-27T09:30:00.000Z',
      source: 'failure',
    })

    render(<SmsPermissionAlert />, { wrapper: TestProviders })

    expect(await screen.findByText('Your phone cannot send SMS.')).toBeTruthy()
    expect(screen.getByText(/The textbee app on Pixel 8 does not have SMS permission/)).toBeTruthy()
    const guide = screen.getByRole('link', { name: /show me how/i })
    expect(guide.getAttribute('href')).toContain(
      'textbee.dev/blog/android-15-send-sms-permission-guide?utm_source=dashboard'
    )
    expect(
      screen.getByRole('link', { name: /view messages/i }).getAttribute('href')
    ).toBe('/dashboard/messaging/history')
  })

  it('warns before any send when the phone reports the permission off', async () => {
    respond({
      needsSmsPermission: true,
      hoursSinceFailure: null,
      deviceId: 'd1',
      deviceName: 'Pixel 8',
      failedAt: null,
      source: 'heartbeat',
    })

    render(<SmsPermissionAlert />, { wrapper: TestProviders })

    expect(await screen.findByText('Your phone cannot send SMS yet.')).toBeTruthy()
    expect(
      screen.getByText(/The textbee app on Pixel 8 reports that the SMS permission is off/)
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: /show me how/i })).toBeTruthy()
  })

  it('renders nothing when sending is not blocked', async () => {
    respond({ needsSmsPermission: false })

    const { container } = render(<SmsPermissionAlert />, { wrapper: TestProviders })

    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('')
  })

  it('renders nothing for an account that never sent', async () => {
    respond({ needsSmsPermission: null })

    const { container } = render(<SmsPermissionAlert />, { wrapper: TestProviders })

    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('')
  })
})
