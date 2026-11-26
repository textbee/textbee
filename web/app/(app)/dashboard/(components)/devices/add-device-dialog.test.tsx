import { createRef } from 'react'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL } from '@/test/fixtures'
import { renderWithProviders, screen, userEvent, waitFor } from '@/test/render'
import AddDeviceDialog, { type AddDeviceHandle } from './add-device-dialog'

const openLinkPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/device-link')>()),
  openLinkPage,
}))

const SETTINGS_URL = `${API_BASE_URL}/auth/device-link-settings`
const TAB_KEY = 'textbee.addDevice.tab'
const CODE_KEY = 'textbee.linkDevice.typedCode'
// The dialog as it was before phone sign-in, captured from that version
const TODAY = './__snapshots__/add-device-dialog-api-key-flow.html'

// The markup with sorted attributes and generated ids masked, so only what
// is shown and announced is compared
function normalize(element: Element): string {
  const tag = element.tagName.toLowerCase()
  const attributes = Array.from(element.attributes)
    .map(({ name, value }) =>
      /^(id|aria-labelledby|aria-describedby|aria-controls)$/.test(name)
        ? `${name}="x"`
        : `${name}="${value}"`
    )
    .sort()
    .join(' ')
  const children = Array.from(element.childNodes)
    .map((node) =>
      node.nodeType === Node.ELEMENT_NODE
        ? normalize(node as Element)
        : (node.textContent ?? '')
    )
    .join('')
  return `<${tag}${attributes ? ` ${attributes}` : ''}>${children}</${tag}>\n`
}

function settings(body: Record<string, unknown>) {
  server.use(http.get(SETTINGS_URL, () => HttpResponse.json({ data: body })))
}

// Any key made by the dashboard would go through this route
function watchKeyCreation() {
  const made: number[] = []
  server.use(
    http.post(`${API_BASE_URL}/auth/api-keys`, () => {
      made.push(1)
      return HttpResponse.json({ data: 'tb_new' })
    })
  )
  return made
}

async function openDialog() {
  const ref = createRef<AddDeviceHandle>()
  renderWithProviders(<AddDeviceDialog ref={ref} />)
  act(() => ref.current?.open())
  return screen.findByRole('dialog')
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  openLinkPage.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('add-device dialog while phone sign-in is off', () => {
  const offCases: Array<[string, () => void]> = [
    ['the settings route does not exist', () => undefined],
    ['the settings route says enabled: false', () => settings({ enabled: false, defaultTab: 'code' })],
    [
      'the settings route fails',
      () =>
        server.use(
          http.get(SETTINGS_URL, () =>
            HttpResponse.json({ error: 'down' }, { status: 500 })
          )
        ),
    ],
  ]

  it.each(offCases)('is the dialog of today when %s', async (_name, setup) => {
    setup()
    const made = watchKeyCreation()
    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    const dialog = await openDialog()
    await waitFor(() =>
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    )

    await expect(normalize(dialog)).toMatchFileSnapshot(TODAY)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(made).toEqual([])
    // The stored tab is neither read nor changed
    expect(getItem).not.toHaveBeenCalledWith(TAB_KEY)
  })

  it('is the dialog of today when no answer comes within 3 seconds', async () => {
    server.use(
      http.get(SETTINGS_URL, async () => {
        await delay(10_000)
        return HttpResponse.json({ data: { enabled: true, defaultTab: 'code' } })
      })
    )
    const made = watchKeyCreation()

    const dialog = await openDialog()
    // While the call runs: a loading state, no tabs
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    await waitFor(
      () => expect(screen.queryByText('Loading...')).not.toBeInTheDocument(),
      { timeout: 5000 }
    )
    await expect(normalize(dialog)).toMatchFileSnapshot(TODAY)
    expect(made).toEqual([])
  }, 10_000)

  it('still leads to key generation with Continue', async () => {
    await openDialog()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue' })
    )
    expect(
      await screen.findByRole('heading', { name: 'Create new API Key' })
    ).toBeInTheDocument()
  })
})

describe('add-device dialog while phone sign-in is on', () => {
  it('opens on the code tab and hands a valid code to the link page', async () => {
    settings({ enabled: true, defaultTab: 'code' })
    const made = watchKeyCreation()
    await openDialog()

    const codeTab = await screen.findByRole('tab', { name: 'Enter code' })
    expect(codeTab).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByText(
        'Use only a code from the textbee app on a phone you have with you. If someone sent you a code, do not enter it.'
      )
    ).toBeInTheDocument()

    const field = screen.getByLabelText('Code from the app')
    await userEvent.type(field, 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      screen.getByText('Check the code. It has 8 letters and numbers.')
    ).toBeInTheDocument()
    expect(openLinkPage).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(CODE_KEY)).toBeNull()

    await userEvent.clear(field)
    await userEvent.type(field, 'k7qx2m9p')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(window.sessionStorage.getItem(CODE_KEY)).toBe('K7QX2M9P')
    expect(openLinkPage).toHaveBeenCalledTimes(1)
    expect(made).toEqual([])
  })

  it('takes an answer without defaultTab as the code tab', async () => {
    settings({ enabled: true })
    await openDialog()
    expect(
      await screen.findByRole('tab', { name: 'Enter code' })
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('opens on the key tab with the update note when the server says so', async () => {
    settings({ enabled: true, defaultTab: 'key' })
    await openDialog()

    expect(
      await screen.findByRole('tab', { name: 'QR code or API key' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByText(/New: connect a phone without an API key/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Get the latest app' })
    ).toHaveAttribute('href', 'https://textbee.dev/download')
    // Today's content is there unchanged
    expect(screen.getByText(/allow the SMS permission/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Full guide/ })).toBeInTheDocument()
  })

  it('remembers a tab picked by hand while the server choice stays the same', async () => {
    settings({ enabled: true, defaultTab: 'code' })
    const first = await openDialog()
    await userEvent.click(
      await screen.findByRole('button', { name: 'QR code or API key' })
    )
    expect(
      screen.getByRole('tab', { name: 'QR code or API key' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(JSON.parse(window.localStorage.getItem(TAB_KEY) ?? '{}')).toEqual({
      tab: 'key',
      defaultTab: 'code',
    })
    expect(first).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await openDialog()
    expect(
      await screen.findByRole('tab', { name: 'QR code or API key' })
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('drops the stored tab when the server choice changes', async () => {
    window.localStorage.setItem(
      TAB_KEY,
      JSON.stringify({ tab: 'key', defaultTab: 'key' })
    )
    settings({ enabled: true, defaultTab: 'code' })
    await openDialog()

    expect(
      await screen.findByRole('tab', { name: 'Enter code' })
    ).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(window.localStorage.getItem(TAB_KEY)).toBeNull())
  })

  it('ignores a stored value it cannot read', async () => {
    window.localStorage.setItem(TAB_KEY, 'not json')
    settings({ enabled: true, defaultTab: 'key' })
    await openDialog()
    expect(
      await screen.findByRole('tab', { name: 'QR code or API key' })
    ).toHaveAttribute('aria-selected', 'true')
  })

  it('switches tabs with the links in each tab and stores the choice', async () => {
    settings({ enabled: true, defaultTab: 'key' })
    await openDialog()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Enter code' })
    )
    expect(screen.getByRole('tab', { name: 'Enter code' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(JSON.parse(window.localStorage.getItem(TAB_KEY) ?? '{}')).toEqual({
      tab: 'code',
      defaultTab: 'key',
    })
  })
})
