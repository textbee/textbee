import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/render'
import SignedOutPanel from './signed-out-panel'

describe('link page while signed out', () => {
  it('offers login and sign-up, both returning to the page', () => {
    window.sessionStorage.setItem('textbee.linkDevice.typedCode', 'K7QX2M9P')
    render(<SignedOutPanel returnTo='/link-device?code=K7QX-2M9P' />)

    expect(
      screen.getByRole('heading', {
        name: 'Log in or create a free account to connect this phone',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Flink-device%3Fcode%3DK7QX-2M9P'
    )
    expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register?redirect=%2Flink-device%3Fcode%3DK7QX-2M9P'
    )
    // The stored code is removed on every load
    expect(window.sessionStorage.getItem('textbee.linkDevice.typedCode')).toBeNull()
  })
})
