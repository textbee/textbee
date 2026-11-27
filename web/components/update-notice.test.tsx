import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import Link from 'next/link'
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime'
import type { VersionWatchEnv } from '@/lib/new-version'
import UpdateNotice, { LATER_KEY, hasTypedInput } from './update-notice'

const watch = vi.hoisted(() => ({
  buildId: 'build-a' as string | null,
  env: null as VersionWatchEnv | null,
  stop: vi.fn(),
}))
vi.mock('@/lib/new-version', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/new-version')>()),
  runningBuildId: () => watch.buildId,
  startVersionWatch: (env: VersionWatchEnv) => {
    watch.env = env
    return watch.stop
  },
}))

// jsdom does not navigate: a stand-in location records reloads and loads
const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!
let assign: ReturnType<typeof vi.fn>
let reload: ReturnType<typeof vi.fn>
function browserAt(pathAndQuery: string) {
  const url = new URL(pathAndQuery, 'https://app.textbee.dev')
  assign = vi.fn()
  reload = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign,
      reload,
    },
  })
}

beforeEach(() => {
  watch.buildId = 'build-a'
  watch.env = null
  browserAt('/dashboard/messaging?tab=send')
})

afterEach(() => {
  Object.defineProperty(window, 'location', realLocation)
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

function newVersion(id = 'build-b') {
  act(() => watch.env!.onNewVersion(id))
}

const card = () => screen.getByTestId('update-notice-card')
const strip = () => screen.getByTestId('update-notice-strip')

describe('UpdateNotice', () => {
  it('is hidden by default, with an empty polite status region', () => {
    render(<UpdateNotice />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })

  it('does not watch on a build without an id', () => {
    watch.buildId = null
    render(<UpdateNotice />)
    expect(watch.env).toBeNull()
  })

  it('shows the card and the phone strip when the watch reports a new version', () => {
    render(<UpdateNotice />)
    newVersion()
    expect(within(card()).getByText('Update available')).toBeInTheDocument()
    expect(
      within(card()).getByText(
        'A new version of the dashboard is ready. Reload to use it.'
      )
    ).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(within(card()).getByRole('button', { name: 'Later' })).toBeInTheDocument()
    expect(within(strip()).getByText('Update available')).toBeInTheDocument()
    expect(within(strip()).getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(within(strip()).getByRole('button', { name: 'Later' })).toBeInTheDocument()
  })

  it('does not take keyboard focus when it appears', () => {
    render(
      <>
        <input aria-label='Message' />
        <UpdateNotice />
      </>
    )
    const field = screen.getByLabelText('Message')
    field.focus()
    newVersion()
    expect(field).toHaveFocus()
  })

  it('reloads at once when nothing is typed', () => {
    render(<UpdateNotice />)
    newVersion()
    fireEvent.click(within(card()).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('Later hides it in this tab and stores the deployed id', () => {
    render(<UpdateNotice />)
    newVersion('build-b')
    fireEvent.click(within(card()).getByRole('button', { name: 'Later' }))
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(LATER_KEY)).toBe('build-b')
  })

  it('stays hidden for an id the person said Later to, and shows for the next one', () => {
    window.sessionStorage.setItem(LATER_KEY, 'build-b')
    const { unmount } = render(<UpdateNotice />)
    newVersion('build-b')
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    unmount()
    render(<UpdateNotice />)
    newVersion('build-c')
    expect(within(card()).getByText('Update available')).toBeInTheDocument()
  })

  it('shows again in the same tab when a later deploy follows Later', () => {
    render(<UpdateNotice />)
    newVersion('build-b')
    fireEvent.click(within(card()).getByRole('button', { name: 'Later' }))
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
    newVersion('build-c')
    expect(within(card()).getByText('Update available')).toBeInTheDocument()
    expect(within(strip()).getByText('Update available')).toBeInTheDocument()
  })

  it('stays hidden after Later when the same id is reported again', () => {
    render(<UpdateNotice />)
    newVersion('build-b')
    fireEvent.click(within(card()).getByRole('button', { name: 'Later' }))
    newVersion('build-b')
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })

  it('works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<UpdateNotice />)
    newVersion()
    fireEvent.click(within(card()).getByRole('button', { name: 'Later' }))
    expect(screen.queryByText('Update available')).not.toBeInTheDocument()
  })

  describe('unsaved input guard', () => {
    function renderWithForm() {
      render(
        <>
          <main id='main-content'>
            <textarea aria-label='Message' />
          </main>
          <UpdateNotice />
        </>
      )
      newVersion()
      return screen.getByLabelText('Message')
    }

    it('asks before a reload would lose a typed message, and Reload then reloads', () => {
      const field = renderWithForm()
      fireEvent.input(field, { target: { value: 'Your code is 4821' } })
      const reloadButton = within(card()).getByRole('button', { name: 'Reload' })
      fireEvent.click(reloadButton)
      expect(reload).not.toHaveBeenCalled()
      expect(
        within(card()).getByText('Reload and lose what you typed?')
      ).toBeInTheDocument()
      expect(within(card()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      expect(
        within(strip()).getByText('Reload and lose what you typed?')
      ).toBeInTheDocument()
      expect(within(strip()).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
      // The same button stays, so focus does not jump
      expect(within(card()).getByRole('button', { name: 'Reload' })).toBe(reloadButton)
      fireEvent.click(reloadButton)
      expect(reload).toHaveBeenCalledTimes(1)
    })

    it('Cancel goes back to the notice without reloading', () => {
      const field = renderWithForm()
      fireEvent.input(field, { target: { value: 'Hello' } })
      fireEvent.click(within(strip()).getByRole('button', { name: 'Reload' }))
      fireEvent.click(within(strip()).getByRole('button', { name: 'Cancel' }))
      expect(reload).not.toHaveBeenCalled()
      expect(within(strip()).getByText('Update available')).toBeInTheDocument()
      expect(window.sessionStorage.getItem(LATER_KEY)).toBeNull()
    })

    it('does not ask when the typed field was emptied again', () => {
      const field = renderWithForm()
      fireEvent.input(field, { target: { value: 'Hello' } })
      fireEvent.input(field, { target: { value: '' } })
      fireEvent.click(within(card()).getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
    })
  })

  describe('links after a new version is found', () => {
    // Vitest resolves next/link to its pages-router build. Its click handler
    // matches the app router one: the link's own onClick runs, then a
    // default-prevented click is left alone.
    const router = {
      asPath: '/dashboard/messaging',
      pathname: '/dashboard/messaging',
      query: {},
      isLocaleDomain: false,
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(async () => {}),
    }

    function renderPage() {
      const onNavigate = vi.fn()
      const onClick = vi.fn()
      const navigate = (e: { preventDefault: () => void }) => {
        onNavigate()
        e.preventDefault()
      }
      render(
        <RouterContext.Provider value={router as never}>
          <Link href='/dashboard/account' prefetch={false} onClick={onClick} onNavigate={navigate}>
            Account
          </Link>
          <Link href='/dashboard/account' prefetch={false} target='_blank'>
            New tab
          </Link>
          <Link href='/dashboard/account' prefetch={false} download>
            Download
          </Link>
          <a href='https://textbee.dev/quickstart'>Quick start</a>
          <a href='mailto:support@example.com'>Email</a>
          <a href='tel:+15555550100'>Call</a>
          <a href='#details'>Hash</a>
          <a href='/dashboard/messaging?tab=send#details'>Same page hash</a>
          <UpdateNotice />
        </RouterContext.Provider>
      )
      return { onNavigate, onClick }
    }

    // jsdom has no navigation: stop the default after the listener ran
    function clickWithoutNavigation(link: HTMLElement, init?: MouseEventInit) {
      link.addEventListener('click', (e) => e.preventDefault(), { once: true })
      fireEvent.click(link, init)
    }

    it('leaves links to next/link while the tab is current', () => {
      const { onNavigate } = renderPage()
      fireEvent.click(screen.getByRole('link', { name: 'Account' }))
      expect(assign).not.toHaveBeenCalled()
      expect(onNavigate).toHaveBeenCalledTimes(1)
    })

    it('turns a same-origin link click into a full page load; the link\'s own handler still runs', () => {
      const { onNavigate, onClick } = renderPage()
      newVersion()
      const link = screen.getByRole('link', { name: 'Account' })
      expect(fireEvent.click(link)).toBe(false)
      expect(assign).toHaveBeenCalledWith('https://app.textbee.dev/dashboard/account')
      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onNavigate).not.toHaveBeenCalled()
      expect(link).toHaveAttribute('href', '/dashboard/account')
    })

    it('installs the click listener once, however many deploys follow', () => {
      const add = vi.spyOn(document, 'addEventListener')
      renderPage()
      newVersion('build-b')
      newVersion('build-c')
      expect(add.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1)
      fireEvent.click(screen.getByRole('link', { name: 'Account' }))
      expect(assign).toHaveBeenCalledTimes(1)
    })

    it('keeps loading in full after Later', () => {
      renderPage()
      newVersion()
      fireEvent.click(within(card()).getByRole('button', { name: 'Later' }))
      fireEvent.click(screen.getByRole('link', { name: 'Account' }))
      expect(assign).toHaveBeenCalledTimes(1)
    })

    it('leaves modified and non-primary clicks alone', () => {
      const { onNavigate } = renderPage()
      newVersion()
      const link = screen.getByRole('link', { name: 'Account' })
      for (const init of [
        { metaKey: true },
        { ctrlKey: true },
        { shiftKey: true },
        { altKey: true },
        { button: 1 },
      ]) {
        clickWithoutNavigation(link, init)
      }
      expect(assign).not.toHaveBeenCalled()
      expect(onNavigate).not.toHaveBeenCalled()
    })

    it('leaves new-tab, download, external, mailto, tel and hash links alone', () => {
      renderPage()
      newVersion()
      for (const name of [
        'New tab',
        'Download',
        'Quick start',
        'Email',
        'Call',
        'Hash',
        'Same page hash',
      ]) {
        clickWithoutNavigation(screen.getByRole('link', { name }))
      }
      expect(assign).not.toHaveBeenCalled()
    })

    it('leaves a click that was already prevented alone', () => {
      renderPage()
      newVersion()
      const prevent = (e: Event) => e.preventDefault()
      window.addEventListener('click', prevent, true)
      fireEvent.click(screen.getByRole('link', { name: 'Account' }))
      window.removeEventListener('click', prevent, true)
      expect(assign).not.toHaveBeenCalled()
    })

    it('removes its listener when unmounted', () => {
      const { unmount } = render(<UpdateNotice />)
      newVersion()
      unmount()
      render(<a href='/dashboard/account'>Account</a>)
      clickWithoutNavigation(screen.getByRole('link', { name: 'Account' }))
      expect(assign).not.toHaveBeenCalled()
      expect(watch.stop).toHaveBeenCalled()
    })
  })
})

describe('hasTypedInput', () => {
  function form(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    return root
  }

  it('finds a field whose value differs from its default', () => {
    const root = form('<input type="text" value="" />')
    root.querySelector('input')!.value = 'hello'
    expect(hasTypedInput(root)).toBe(true)
  })

  it('finds a typed field even when its default follows its value', () => {
    const root = form('<input type="email" />')
    const input = root.querySelector('input')!
    input.defaultValue = 'jane@example.com'
    input.value = 'jane@example.com'
    expect(hasTypedInput(root)).toBe(false)
    expect(hasTypedInput(root, new WeakSet([input]))).toBe(true)
  })

  it('skips empty fields, prefilled fields and non-text inputs', () => {
    const root = form(
      '<input type="text" value="Prefilled" /><textarea></textarea><input type="checkbox" /><input type="date" />'
    )
    root.querySelector<HTMLInputElement>('input[type="date"]')!.value = '2026-01-01'
    expect(hasTypedInput(root)).toBe(false)
  })

  it('finds text typed in a contenteditable region', () => {
    const root = form('<div contenteditable="true">Draft</div>')
    expect(hasTypedInput(root)).toBe(false)
    expect(hasTypedInput(root, new WeakSet([root.firstElementChild!]))).toBe(true)
  })

  it('is false without a root', () => {
    expect(hasTypedInput(null)).toBe(false)
  })
})

describe('where it is mounted', () => {
  const appDir = path.resolve(__dirname, '../app')
  function layouts(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return layouts(full)
      return entry.name === 'layout.tsx' ? [full] : []
    })
  }

  it('is in the dashboard layout only, not on login, register or the phone sign-in pages', () => {
    const mounting = layouts(appDir)
      .filter((file) =>
        readFileSync(file, 'utf8').includes('@/components/update-notice')
      )
      .map((file) => path.relative(appDir, file))
    expect(mounting).toEqual([path.join('(app)', 'dashboard', 'layout.tsx')])
  })
})
