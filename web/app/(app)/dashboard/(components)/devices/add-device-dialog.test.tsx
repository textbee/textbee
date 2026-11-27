import { createRef } from 'react'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { API_BASE_URL, mockUser } from '@/test/fixtures'
import { queryKeys } from '@/lib/api/query-keys'
import { QueryClient } from '@tanstack/react-query'
import {
  makeTestQueryClient,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '@/test/render'
import AddDeviceDialog, { type AddDeviceHandle } from './add-device-dialog'

const openLinkPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/device-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/device-link')>()),
  openLinkPage,
}))

const SETTINGS_URL = `${API_BASE_URL}/auth/device-link-settings`
const SETTINGS_KEY = queryKeys.deviceLinkSettings(mockUser.id)
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

type Mounted = { ref: React.RefObject<AddDeviceHandle | null>; client: QueryClient }

// Mounts the dialog like the dashboard does; with settle, waits until the
// settings call has an answer or has failed
async function mount({ settle = true } = {}): Promise<Mounted> {
  const ref = createRef<AddDeviceHandle>()
  const client = makeTestQueryClient()
  renderWithProviders(<AddDeviceDialog ref={ref} />, { queryClient: client })
  if (settle) {
    await waitFor(
      () =>
        expect(
          client.getQueryState(SETTINGS_KEY)?.status
        ).not.toBe('pending'),
      { timeout: 5000 }
    )
  }
  return { ref, client }
}

// The dialog right after it opens, before any later answer can arrive
function openNow({ ref }: Mounted) {
  act(() => ref.current?.open())
  return screen.getByRole('dialog')
}

async function openDialog() {
  return openNow(await mount())
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
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')

    const dialog = openNow(await mount())
    await expect(normalize(dialog)).toMatchFileSnapshot(TODAY)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
    expect(made).toEqual([])
    // The stored tab is neither read nor changed
    expect(getItem).not.toHaveBeenCalledWith(TAB_KEY)
    expect(setItem).not.toHaveBeenCalledWith(TAB_KEY, expect.anything())
    expect(removeItem).not.toHaveBeenCalledWith(TAB_KEY)
  })

  it('is the dialog of today from the first render while no answer is there, and stays so', async () => {
    server.use(
      http.get(SETTINGS_URL, async () => {
        await delay(300)
        return HttpResponse.json({ data: { enabled: true, defaultTab: 'code' } })
      })
    )
    const made = watchKeyCreation()
    const mounted = await mount({ settle: false })

    const dialog = openNow(mounted)
    await expect(normalize(dialog)).toMatchFileSnapshot(TODAY)

    // The answer arrives while the dialog is open: nothing changes
    await waitFor(() =>
      expect(mounted.client.getQueryData(SETTINGS_KEY)).toEqual({
        enabled: true,
        defaultTab: 'code',
      })
    )
    await expect(normalize(screen.getByRole('dialog'))).toMatchFileSnapshot(TODAY)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

    // The next opening uses the answer that is there by then
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    openNow(mounted)
    expect(screen.getByRole('tab', { name: 'Enter code' })).toBeInTheDocument()
    expect(made).toEqual([])
  })

  it('is the dialog of today after no answer within 3 seconds, and does not ask again', async () => {
    let asked = 0
    server.use(
      http.get(SETTINGS_URL, async () => {
        asked++
        await delay(10_000)
        return HttpResponse.json({ data: { enabled: true, defaultTab: 'code' } })
      })
    )
    const made = watchKeyCreation()
    const mounted = await mount()
    expect(mounted.client.getQueryState(SETTINGS_KEY)?.status).toBe(
      'error'
    )

    await expect(normalize(openNow(mounted))).toMatchFileSnapshot(TODAY)
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    await expect(normalize(openNow(mounted))).toMatchFileSnapshot(TODAY)
    expect(asked).toBe(1)
    expect(made).toEqual([])
  }, 10_000)

  it('still leads to key generation with Continue', async () => {
    await openDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
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

    expect(
      screen.getByRole('link', { name: 'textbee.dev/download' })
    ).toHaveAttribute('href', 'https://textbee.dev/download')
    const field = screen.getByLabelText('Code from the app')
    // The same field as on the link page
    expect(field).toHaveClass('font-mono', 'text-center', 'tracking-[0.2em]')
    const continueButton = screen.getByRole('button', { name: 'Continue' })
    await userEvent.type(field, 'abc')
    expect(field).toHaveValue('ABC')
    expect(continueButton).toBeDisabled()
    await userEvent.type(field, '{Enter}')
    expect(
      screen.getByText('Check the code. It has 8 letters and numbers.')
    ).toBeInTheDocument()
    expect(openLinkPage).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(CODE_KEY)).toBeNull()

    await userEvent.clear(field)
    // The same field as the link page: too long and with a link, it keeps the code
    await userEvent.paste('https://app.textbee.dev/link-device?code=k7qx-2m9p')
    expect(field).toHaveValue('K7QX-2M9P')
    expect(continueButton).toBeEnabled()
    await userEvent.type(field, '{Enter}')
    expect(window.sessionStorage.getItem(CODE_KEY)).toBe('K7QX2M9P')
    expect(openLinkPage).toHaveBeenCalledTimes(1)
    // No second hand-off while the page loads
    await userEvent.click(continueButton)
    expect(openLinkPage).toHaveBeenCalledTimes(1)
    expect(made).toEqual([])
  })

  it('works again when the browser brings the page back from its cache', async () => {
    settings({ enabled: true, defaultTab: 'code' })
    await openDialog()
    const field = await screen.findByLabelText('Code from the app')
    await userEvent.type(field, 'k7qx2m9p{Enter}')
    expect(openLinkPage).toHaveBeenCalledTimes(1)
    expect(field).toHaveAttribute('readonly')

    // A page shown again without a reload keeps nothing busy
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    })
    expect(field).not.toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(openLinkPage).toHaveBeenCalledTimes(2)
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
    const mounted = await mount()
    openNow(mounted)
    await userEvent.click(
      screen.getByRole('button', { name: 'QR code or API key' })
    )
    expect(
      screen.getByRole('tab', { name: 'QR code or API key' })
    ).toHaveAttribute('aria-selected', 'true')
    expect(JSON.parse(window.localStorage.getItem(TAB_KEY) ?? '{}')).toEqual({
      tab: 'key',
      defaultTab: 'code',
    })

    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    openNow(mounted)
    expect(
      screen.getByRole('tab', { name: 'QR code or API key' })
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
