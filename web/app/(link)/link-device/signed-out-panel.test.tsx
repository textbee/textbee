import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@/test/render'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import SignedOutPanel from './signed-out-panel'

describe('link page while signed out', () => {
  it('offers login and sign-up, both returning to the page', () => {
    window.sessionStorage.setItem('textbee.linkDevice.typedCode', 'K7QX2M9P')
    render(<SignedOutPanel returnTo='/link-device?code=K7QX-2M9P' />)

    expect(
      screen.getByRole('heading', {
        name: 'Log in or create a free account to connect this device',
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

  it('shows only a short text inside a frame', async () => {
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    try {
      render(<SignedOutPanel returnTo='/link-device' />)
      expect(
        await screen.findByText(
          'Open this page in its own browser tab to connect a device.'
        )
      ).toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    } finally {
      top.mockRestore()
    }
  })

  it('renders no buttons on the server and while it hydrates', async () => {
    const panel = <SignedOutPanel returnTo='/link-device' />
    const html = renderToString(panel)
    expect(html).toContain('Log in or create a free account to connect this device')
    expect(html).not.toContain('href=')

    for (const inFrame of [true, false]) {
      const container = document.createElement('div')
      container.innerHTML = html
      document.body.appendChild(container)
      const top = inFrame
        ? vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
        : null
      try {
        let root: ReturnType<typeof hydrateRoot> | undefined
        await act(async () => {
          root = hydrateRoot(container, panel)
        })
        if (inFrame) {
          expect(container).toHaveTextContent(
            'Open this page in its own browser tab to connect a device.'
          )
          expect(container.querySelector('a')).toBeNull()
        } else {
          expect(container.querySelectorAll('a')).toHaveLength(2)
        }
        act(() => root?.unmount())
      } finally {
        top?.mockRestore()
        container.remove()
      }
    }
  })
})
