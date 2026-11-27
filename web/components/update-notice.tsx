'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isSupportChatEnabled } from '@/components/shared/support-hq-widget'
import {
  fetchDeployedVersion,
  runningBuildId,
  startVersionWatch,
} from '@/lib/new-version'
import { cn } from '@/lib/utils'

/** sessionStorage: the deployed id the person said Later to. */
export const LATER_KEY = 'textbee-update-later'

function readLater(): string | null {
  try {
    return window.sessionStorage.getItem(LATER_KEY)
  } catch {
    return null
  }
}

function rememberLater(id: string) {
  try {
    window.sessionStorage.setItem(LATER_KEY, id)
  } catch {
    // Storage blocked: the notice stays hidden until this page unloads
  }
}

const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'tel',
  'url',
  'number',
  'password',
])
const FIELD_SELECTOR = 'input, textarea, [contenteditable="true"]'

/**
 * Whether a field in `root` holds something the person typed. Generic on
 * purpose: it reads the page, so every form, today's and future ones, is
 * covered with no wiring per form. A field counts when it is not empty and
 * differs from its default, or was typed in since the page loaded (React
 * keeps a controlled field's default equal to its value, so the default
 * alone misses those).
 */
export function hasTypedInput(
  root: ParentNode | null,
  typedIn: WeakSet<EventTarget> = new WeakSet()
): boolean {
  if (!root) return false
  for (const el of root.querySelectorAll(FIELD_SELECTOR)) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(el.type)) {
        continue
      }
      if (el.value === '') continue
      if (el.value !== el.defaultValue || typedIn.has(el)) return true
    } else if (typedIn.has(el) && el.textContent?.trim()) {
      return true
    }
  }
  return false
}

/**
 * Turns a plain in-app link click into a full page load of the same URL, so
 * a tab on an old build arrives on the new one. One capture listener on the
 * document, so no link component changes. Returns a function that removes it.
 */
export function loadLinksInFull(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    if (anchor.target && anchor.target !== '_self') return
    if (anchor.hasAttribute('download')) return
    const href = anchor.getAttribute('href') ?? ''
    let url: URL
    try {
      url = new URL(href, window.location.href)
    } catch {
      return
    }
    // mailto:, tel: and other sites have another origin
    if (url.origin !== window.location.origin) return
    const here = new URL(window.location.href)
    // A jump within this page, or a "#" link that a script handles
    if (
      href.includes('#') &&
      url.pathname === here.pathname &&
      url.search === here.search
    ) {
      return
    }
    // next/link skips a default-prevented click; its own onClick still runs
    event.preventDefault()
    window.location.assign(url.href)
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/**
 * "Update available" once a different build of the dashboard is live: a card
 * in the bottom-right corner on desktop, a strip above the tab bar on a
 * phone. From then on, an in-app link click loads its page in full, so most
 * people get the new build without pressing anything. Mounted once, in the
 * dashboard layout.
 */
export default function UpdateNotice() {
  const [deployed, setDeployed] = useState<string | null>(null)
  const [later, setLater] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [typedIn] = useState(() => new WeakSet<EventTarget>())

  useEffect(() => {
    const buildId = runningBuildId()
    if (buildId === null) return
    const onInput = (event: Event) => {
      if (event.target) typedIn.add(event.target)
    }
    document.addEventListener('input', onInput, true)
    const stop = startVersionWatch({
      buildId,
      fetchVersion: () => fetchDeployedVersion((input, init) => fetch(input, init)),
      doc: document,
      win: window,
      now: Date.now,
      onNewVersion: (id) => {
        setLater(readLater() === id)
        setDeployed(id)
      },
    })
    return () => {
      stop()
      document.removeEventListener('input', onInput, true)
    }
  }, [typedIn])

  // Later hides the notice only; links still load in full. Installed once,
  // however many deploys follow.
  const stale = deployed !== null
  useEffect(() => (stale ? loadLinksInFull() : undefined), [stale])

  const show = deployed !== null && !later

  const reload = () => {
    if (
      !confirming &&
      hasTypedInput(document.getElementById('main-content'), typedIn)
    ) {
      setConfirming(true)
      return
    }
    window.location.reload()
  }
  const dismiss = () => {
    if (confirming) {
      setConfirming(false)
      return
    }
    if (deployed) rememberLater(deployed)
    setLater(true)
  }
  const title = confirming
    ? 'Reload and lose what you typed?'
    : 'Update available'
  const dismissLabel = confirming ? 'Cancel' : 'Later'
  const enter =
    'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300'

  return (
    // Always in the page, so a screen reader hears the text when it appears
    <div role='status' aria-live='polite'>
      {show && (
        <>
          <div
            data-testid='update-notice-card'
            className={cn(
              'fixed right-6 z-40 hidden w-[340px] items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-lg md:flex',
              // Clear of the support chat button in the same corner
              isSupportChatEnabled() ? 'bottom-24' : 'bottom-6',
              enter
            )}
          >
            <span
              aria-hidden='true'
              className='mt-[7px] h-2 w-2 shrink-0 rounded-full bg-primary'
            />
            <div className='min-w-0 flex-1'>
              <p className='text-sm font-semibold text-foreground'>{title}</p>
              {!confirming && (
                <p className='mt-0.5 text-[13px] leading-snug text-muted-foreground'>
                  A new version of the dashboard is ready. Reload to use it.
                </p>
              )}
              <div className='mt-3 flex gap-2'>
                <Button size='sm' onClick={reload}>
                  Reload
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-muted-foreground'
                  onClick={dismiss}
                >
                  {dismissLabel}
                </Button>
              </div>
            </div>
          </div>

          <div
            data-testid='update-notice-strip'
            className={cn(
              'fixed bottom-[4.5rem] left-2 right-2 z-40 flex items-center gap-2 rounded-lg border border-border bg-card py-1.5 pl-3 pr-1.5 text-sm shadow-lg md:hidden',
              enter
            )}
          >
            <span
              aria-hidden='true'
              className='h-2 w-2 shrink-0 rounded-full bg-primary'
            />
            <p className='min-w-0 flex-1 font-medium text-foreground'>{title}</p>
            <Button
              size='sm'
              variant='ghost'
              className='px-2 font-semibold text-primary hover:text-primary'
              onClick={reload}
            >
              Reload
            </Button>
            {/* One button in both states, so keyboard focus stays on it */}
            <Button
              size='sm'
              variant='ghost'
              className={cn(
                'text-muted-foreground',
                confirming ? 'px-2' : 'w-8 px-0'
              )}
              aria-label={confirming ? undefined : 'Later'}
              onClick={dismiss}
            >
              {confirming ? 'Cancel' : <X aria-hidden='true' />}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
