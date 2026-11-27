'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import axios from 'axios'
import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toRelativeLabel } from '@/components/shared/relative-time'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'
import { toast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { signOutTo } from '@/lib/sign-out'
import CodeInput, { incompleteCodeButtonClass } from '@/components/shared/code-input'
import {
  BAD_CODE_TEXT,
  CODE_LENGTH,
  displayCode,
  isFramed,
  linkPageReturnPath,
  normalizeCode,
  takeTypedCode,
  useIsFramed,
} from '@/lib/device-link'
import type {
  DeviceLinkDeviceOption,
  DeviceLinkLookup,
  DeviceLinkNewOption,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'
import {
  authButtonClass,
  authFieldClass,
} from '@/app/(app)/(auth)/(components)/auth-styles'

export const TEXT = {
  title: 'Connect a phone',
  enterLine:
    'Open the textbee app on your phone, tap Sign in with textbee, and enter the code it shows.',
  doneTitle: 'Phone approved',
  done: 'The phone connects in a few seconds. If it does not, open the textbee app on the phone.',
  alreadyTitle: 'Already approved',
  already: 'This phone is being connected. You can close this page.',
  cancelledTitle: 'Request cancelled',
  cancelled: 'Nothing was changed.',
  notFound: 'This code is not valid or has expired. Check the code in the app.',
  tooMany: 'Too many wrong codes. Try again later.',
  tooManyTitle: 'Too many tries',
  expiredTitle: 'Code expired',
  expired:
    'Codes work for 10 minutes. Tap Sign in with textbee in the app to get a new one.',
  offTitle: 'Sign-in not available',
  notAvailable: 'Sign-in is not available right now. Use an API key instead.',
  unreachableTitle: 'Could not reach textbee',
  failed: 'Check your internet connection and try again.',
  framed: 'Open this page in its own browser tab to connect a phone.',
  approveTitle: 'Connect this phone?',
  safety:
    'Only continue if you started this on a phone you have with you. If someone sent you this link or code, cancel.',
  linkNoCode: 'The link did not hold a valid code. Enter the code shown in the app.',
  typeCode:
    'This request came from a different network than this browser. Type the code shown in the textbee app to continue.',
  unverified:
    'Your email is not verified yet. You can connect the phone now. Sending and receiving start after you verify.',
}

// A request can be approved for 10 minutes; a countdown never shows more
const APPROVE_WINDOW_MS = 10 * 60 * 1000

// A request with no answer by then counts as a lost connection, so no
// state waits forever
const REQUEST_LIMIT_MS = 15_000
const REQUEST_TIMEOUT = { timeout: REQUEST_LIMIT_MS }

// The limit for the whole call, also the session lookup the API client
// waits for before it sends the request
function inTime<T>(request: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The request took too long')),
      REQUEST_LIMIT_MS
    )
    request.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

type Source = { code: string; typed: boolean; fromDashboard: boolean }

// The code field as it opens: empty, or with a code and the error it got.
// A note is a hint, not an error.
type Entry = { id: number; chars: string; error: string | null; note?: string }

type View =
  | { kind: 'starting' }
  | { kind: 'enter'; entry: Entry }
  | { kind: 'loading' }
  | { kind: 'ready'; data: DeviceLinkLookup; clock: AnswerClock }
  | { kind: 'done' }
  | { kind: 'cancelled' }
  | { kind: 'already' }
  | { kind: 'expired' }
  // retry repeats the lookup that failed
  | {
      kind: 'message'
      title: string
      text?: string
      retry?: Retry
    }

type Retry = { kind: 'lookup'; next: Source } | { kind: 'settle'; code: string }

// The page address without a code that turned out wrong, so a reload or a
// shared address does not bring it back
function clearAddressCode() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('code')) return
  url.searchParams.delete('code')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function responseOf(error: unknown) {
  return axios.isAxiosError(error) ? error.response : undefined
}

// Our routes answer { error }; a framework error also carries statusCode
function serverText(error: unknown): string | null {
  const body = responseOf(error)?.data as
    | { error?: unknown; statusCode?: unknown }
    | undefined
  if (body && typeof body.error === 'string' && body.statusCode === undefined) {
    return body.error
  }
  return null
}

function errorText(error: unknown): string {
  const status = responseOf(error)?.status
  const fallback =
    status === 404
      ? TEXT.notFound
      : status === 429
        ? TEXT.tooMany
        : status === 503
          ? TEXT.notAvailable
          : TEXT.failed
  return serverText(error) ?? fallback
}

// The API client already sends the user to log in again
function sessionEnded(error: unknown): boolean {
  const response = responseOf(error)
  return (
    response?.status === 401 &&
    (response.data as { code?: unknown } | undefined)?.code === 'AUTH_INVALID'
  )
}

function lastActive(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const label = toRelativeLabel(date)
  return label === 'Just now' ? 'just now' : label
}

function deviceTitle(option: DeviceLinkDeviceOption): string {
  return (
    option.name?.trim() ||
    [option.brand, option.model].filter(Boolean).join(' ') ||
    option.deviceId
  )
}

function deviceLine(option: DeviceLinkDeviceOption): string {
  const model = [option.brand, option.model].filter(Boolean).join(' ')
  const seen = lastActive(option.lastSeenAt)
  // A device that never reported in says so; the warning no longer does
  return [model && `${model}.`, seen ? `Last active ${seen}.` : 'Not seen yet.']
    .filter(Boolean)
    .join(' ')
}

function remainingLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

// The code and the email read left to right in right-to-left languages too
function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir='ltr'>{children}</bdi>
}

function Warning({ id, text }: { id: string; text: string }) {
  return (
    <p id={id} className='mt-1 flex items-start gap-1.5 text-xs leading-5 text-warning'>
      <AlertTriangle aria-hidden className='mt-[3px] h-3 w-3 shrink-0' />
      <span>{text}</span>
    </p>
  )
}

// The first letter of the name, or of the email
function initialOf(name: string, email: string): string {
  const first = Array.from((name || email).trim())[0]
  return first ? first.toUpperCase() : '?'
}

function AccountRow({
  name,
  email,
  onSwitch,
}: {
  name: string
  email: string
  onSwitch: () => void
}) {
  const who = name || email
  return (
    <div className='flex items-center gap-3 border-b pb-4'>
      <span
        aria-hidden
        className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground'
      >
        {initialOf(name, email)}
      </span>
      <div className='min-w-0 flex-1'>
        {name ? (
          <>
            <p className='truncate text-sm font-medium' title={name}>
              {name}
            </p>
            <p className='truncate text-xs text-muted-foreground' title={email}>
              <Ltr>{email}</Ltr>
            </p>
          </>
        ) : (
          <p className='truncate text-sm font-medium' title={email}>
            <Ltr>{email}</Ltr>
          </p>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type='button'
            className='shrink-0 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            Switch account
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className='max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch account?</AlertDialogTitle>
            <AlertDialogDescription className='break-words [overflow-wrap:anywhere]'>
              You will be logged out of {who}. Log in with the other account to
              come back to this page. The code keeps working until it expires.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSwitch}>
              Log out and switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// The time left when the lookup answered, and when that was on a clock that
// only moves forward. The browser's own clock never decides expiry.
type AnswerClock = { leftMs: number | null; at: number }

const monotonicNow = () => performance.now()

// Prefers the seconds the server counts; otherwise expiresAt against the
// server's time from the Date header when the browser can read it, and the
// browser's time only when it cannot
export function timeLeftAtAnswer(
  data: DeviceLinkLookup,
  dateHeader: unknown
): number | null {
  if (typeof data.secondsLeft === 'number' && Number.isFinite(data.secondsLeft)) {
    return Math.max(0, data.secondsLeft * 1000)
  }
  const serverNow =
    typeof dateHeader === 'string' ? Date.parse(dateHeader) : Number.NaN
  const now = Number.isFinite(serverNow) ? serverNow : Date.now()
  const left = Date.parse(data.expiresAt) - now
  return Number.isFinite(left) ? left : null
}

// No countdown when the time left is unknown or already over while the server
// still says pending: then the server decides
function deadlineOf(clock: AnswerClock): number | null {
  return clock.leftMs !== null && clock.leftMs > 0
    ? clock.at + Math.min(clock.leftMs, APPROVE_WINDOW_MS)
    : null
}

function useCountdown(clock: AnswerClock) {
  const [deadline] = useState(() => deadlineOf(clock))
  const [now, setNow] = useState(monotonicNow)

  useEffect(() => {
    if (deadline === null) return
    const timer = setInterval(() => setNow(monotonicNow()), 1000)
    return () => clearInterval(timer)
  }, [deadline])

  return {
    remaining: deadline === null ? null : Math.max(0, deadline - now),
    expired: deadline !== null && now >= deadline,
  }
}

export default function LinkDevicePanel({
  addressCode,
  sessionEmail,
  sessionName = '',
}: {
  addressCode?: string
  sessionEmail: string
  // The name of the signed-in session; may be empty
  sessionName?: string
}) {
  const [view, setView] = useState<View>({ kind: 'starting' })
  const [source, setSource] = useState<Source | null>(null)
  const [email, setEmail] = useState(sessionEmail)
  // A lookup started from the code field runs with the field still shown
  const [checking, setChecking] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)
  const firstView = useRef(true)
  const entryCount = useRef(0)
  // Counts the requests whose answer may change the view; the answer of an
  // older one is dropped
  const latest = useRef(0)
  const framed = useIsFramed()

  const enter = useCallback(
    (chars = '', error: string | null = null, note?: string) => {
      entryCount.current += 1
      latest.current += 1
      setView({
        kind: 'enter',
        entry: { id: entryCount.current, chars, error, note },
      })
    },
    []
  )

  const lookup = useCallback(
    async (next: Source, fromField = false) => {
      setSource(next)
      if (fromField) setChecking(true)
      else setView({ kind: 'loading' })
      const again: Retry = { kind: 'lookup', next }
      try {
        const response = await inTime(
          httpBrowserClient.get(
            ApiEndpoints.auth.deviceLink(next.code),
            REQUEST_TIMEOUT
          )
        )
        const at = monotonicNow()
        const data = response.data?.data as DeviceLinkLookup | undefined
        if (!data || typeof data !== 'object') {
          setView({
            kind: 'message',
            title: TEXT.unreachableTitle,
            text: TEXT.failed,
            retry: again,
          })
          return
        }
        if (data.accountEmail) setEmail(data.accountEmail)
        if (data.status === 'approved') setView({ kind: 'already' })
        else if (data.status === 'denied') setView({ kind: 'cancelled' })
        else {
          const leftMs = timeLeftAtAnswer(data, response.headers?.date)
          setView({ kind: 'ready', data, clock: { leftMs, at } })
        }
      } catch (error) {
        if (sessionEnded(error)) return
        const status = responseOf(error)?.status
        if (status === 404 || status === 429) {
          // A wrong, expired or used code, or too many tries: back to the
          // field. A typed code stays to be fixed; a code from the address
          // is never put in the field, so it can never pass as typed.
          clearAddressCode()
          enter(next.typed ? next.code : '', errorText(error))
        } else {
          setView({
            kind: 'message',
            title: status === 503 ? TEXT.offTitle : TEXT.unreachableTitle,
            text: errorText(error),
            retry: again,
          })
        }
      } finally {
        setChecking(false)
      }
    },
    [enter]
  )

  // An approve or cancel answered 404: the request ended. A fresh lookup
  // tells whether this user approved it in another tab, or cancelled it
  const settle = useCallback(async (code: string) => {
    const mine = ++latest.current
    try {
      const response = await inTime(
        httpBrowserClient.get(ApiEndpoints.auth.deviceLink(code), REQUEST_TIMEOUT)
      )
      if (mine !== latest.current) return
      const status = (response.data?.data as DeviceLinkLookup | undefined)?.status
      if (status === 'approved') setView({ kind: 'already' })
      else if (status === 'denied') setView({ kind: 'cancelled' })
      // Still pending, or an answer it cannot read: not known how it ended
      else {
        setView({
          kind: 'message',
          title: TEXT.unreachableTitle,
          text: TEXT.failed,
          retry: { kind: 'settle', code },
        })
      }
    } catch (error) {
      if (sessionEnded(error) || mine !== latest.current) return
      const status = responseOf(error)?.status
      if (status === 404) {
        setView({ kind: 'expired' })
        return
      }
      // Not known how the request ended: say so and check again on a press
      setView({
        kind: 'message',
        title:
          status === 503
            ? TEXT.offTitle
            : status === 429
              ? TEXT.tooManyTitle
              : TEXT.unreachableTitle,
        text: errorText(error),
        retry: { kind: 'settle', code },
      })
    }
  }, [])

  // Only the approval can expire; a newer view stays
  const markExpired = useCallback(
    () =>
      setView((current) =>
        current.kind === 'ready' ? { kind: 'expired' } : current
      ),
    []
  )

  // Runs once: the stored code is taken only when the address has none, and
  // it is removed on every load
  useEffect(() => {
    if (started.current) return
    started.current = true
    const stored = takeTypedCode()
    // Inside another site's frame the page offers nothing to approve. Read
    // directly: the hook still says null while the page hydrates
    if (isFramed()) return
    if (addressCode !== undefined) {
      const code = normalizeCode(addressCode)
      if (code) {
        void lookup({ code, typed: false, fromDashboard: false })
      } else {
        clearAddressCode()
        // The user typed nothing yet, so this is no error of theirs
        enter('', null, TEXT.linkNoCode)
      }
    } else if (stored) {
      void lookup({ code: stored, typed: true, fromDashboard: true })
    } else {
      enter()
    }
  }, [addressCode, lookup, enter])

  // A new state moves focus to its heading, so screen readers announce it.
  // The code field takes focus itself.
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    if (view.kind !== 'enter') headingRef.current?.focus()
  }, [view])

  // Another code, from an empty field and an address without a code
  const startOver = () => {
    clearAddressCode()
    setSource(null)
    enter()
  }

  // The login library would build the address from its own site setting,
  // which can be another site; this page builds it from its own origin
  const switchAccount = () => {
    // The address as it is now: a refused code is no longer in it
    const { pathname, search, hash, origin } = window.location
    // The link page cannot loop, so it loads again even after a failure
    return signOutTo(linkPageReturnPath(`${pathname}${search}${hash}`, origin), {
      loadOnFailure: true,
    })
  }

  // The card of the login page, with the account on top and the page title
  const shell = (children: ReactNode, line?: string, withTitle = true) => (
    <Card className='w-full max-w-[560px] rounded-2xl shadow-[0_16px_40px_-20px_rgb(28_27_26/0.18)]'>
      <CardContent className='flex flex-col gap-5 rounded-xl px-5 py-6 sm:px-7 sm:py-8'>
        <AccountRow
          name={sessionName.trim()}
          email={email}
          onSwitch={() => void switchAccount()}
        />
        {withTitle && (
          <div className='space-y-1.5'>
            <h1 className='text-[26px] font-semibold leading-8 tracking-tight sm:text-2xl'>
              {TEXT.title}
            </h1>
            {line && (
              <p
                ref={headingRef}
                tabIndex={-1}
                className='text-[15px] leading-[22px] text-muted-foreground focus:outline-none sm:text-sm'
              >
                {line}
              </p>
            )}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  )

  // The title of a state other than the code field; it takes focus when
  // the state appears, so screen readers announce it
  const titleHeading = (text: ReactNode) => (
    <h1
      ref={headingRef}
      tabIndex={-1}
      className='text-[26px] font-semibold leading-8 tracking-tight focus:outline-none sm:text-2xl'
    >
      {text}
    </h1>
  )

  // A state that ends the request: its own title, a short text and the
  // next steps
  const endState = (title: string, text: string | undefined, actions: ReactNode) =>
    shell(
      <>
        <div className='space-y-1.5'>
          {titleHeading(title)}
          {text && (
            <p className='text-[15px] leading-[22px] text-muted-foreground sm:text-sm'>
              {text}
            </p>
          )}
        </div>
        {/* The main button comes first: on top on a phone, on the right on
            a wider screen, as on the approval */}
        <div className='flex flex-col gap-2 sm:flex-row-reverse'>{actions}</div>
      </>,
      undefined,
      false
    )

  const backToDashboard = (
    <Button asChild variant='outline' className={cn(authButtonClass, 'sm:flex-1')}>
      <a href={Routes.dashboard}>Back to dashboard</a>
    </Button>
  )

  const anotherCode = (label: string) => (
    <Button type='button' className={cn(authButtonClass, 'sm:flex-1')} onClick={startOver}>
      {label}
    </Button>
  )

  if (framed === true) return <FramedNotice />

  switch (view.kind) {
    case 'starting':
    case 'loading':
      return shell(
        <div className='flex justify-center py-6'>
          <Spinner size='md' color='muted' />
        </div>
      )
    case 'enter':
      return shell(
        <EnterCode
          key={view.entry.id}
          entry={view.entry}
          busy={checking}
          onCode={(code) =>
            void lookup({ code, typed: true, fromDashboard: false }, true)
          }
        />,
        TEXT.enterLine
      )
    case 'done':
      return endState(
        TEXT.doneTitle,
        TEXT.done,
        <>
          {anotherCode('Connect another phone')}
          {source?.fromDashboard ? (
            <Button asChild variant='outline' className={cn(authButtonClass, 'sm:flex-1')}>
              <a href={Routes.dashboard}>Back to devices</a>
            </Button>
          ) : (
            backToDashboard
          )}
        </>
      )
    case 'already':
      return endState(
        TEXT.alreadyTitle,
        TEXT.already,
        <>
          {anotherCode('Enter another code')}
          {backToDashboard}
        </>
      )
    case 'cancelled':
      return endState(
        TEXT.cancelledTitle,
        TEXT.cancelled,
        <>
          {anotherCode('Enter another code')}
          {backToDashboard}
        </>
      )
    case 'expired':
      return endState(
        TEXT.expiredTitle,
        TEXT.expired,
        <>
          {anotherCode('Enter a new code')}
          {backToDashboard}
        </>
      )
    case 'message': {
      const retry = view.retry
      return endState(
        view.title,
        view.text,
        <>
          {retry ? (
            <Button
              type='button'
              className={cn(authButtonClass, 'sm:flex-1')}
              // The loading card replaces this one, so it cannot send twice
              onClick={() => {
                if (retry.kind === 'lookup') {
                  void lookup(retry.next)
                } else {
                  setView({ kind: 'loading' })
                  void settle(retry.code)
                }
              }}
            >
              Try again
            </Button>
          ) : (
            anotherCode('Enter another code')
          )}
          {backToDashboard}
        </>
      )
    }
    case 'ready':
      return shell(
        <Approval
          data={view.data}
          clock={view.clock}
          source={source as Source}
          heading={titleHeading}
          onDone={() => setView({ kind: 'done' })}
          onCancelled={() => setView({ kind: 'cancelled' })}
          onGone={() => settle((source as Source).code)}
          onExpired={markExpired}
          onStop={(text) => setView({ kind: 'message', title: text })}
        />,
        undefined,
        false
      )
  }
}

export function FramedNotice() {
  return (
    <Card className='w-full max-w-[560px] rounded-2xl'>
      <CardContent className='px-5 py-6 sm:px-7 sm:py-8'>
        <p className='text-sm'>{TEXT.framed}</p>
      </CardContent>
    </Card>
  )
}

function EnterCode({
  entry,
  busy,
  onCode,
}: {
  entry: Entry
  busy: boolean
  onCode: (code: string) => void
}) {
  const [chars, setChars] = useState(entry.chars)
  const [error, setError] = useState<string | null>(entry.error)
  const [note, setNote] = useState(entry.note)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const errorId = useId()
  const noteId = useId()
  const complete = chars.length === CODE_LENGTH

  // A code that came back with an error is selected, ready to fix or retype
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    if (entry.error) input.select()
  }, [entry])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!complete) {
      setNote(undefined)
      setError(BAD_CODE_TEXT)
      return
    }
    onCode(chars)
  }

  return (
    <form
      onSubmit={submit}
      // Continue is off until the code is complete, so Enter would do
      // nothing; it explains instead
      onKeyDown={(event) => {
        // An Enter that picks a keyboard suggestion is not a submit
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter' && !complete && !busy) {
          event.preventDefault()
          setNote(undefined)
          setError(BAD_CODE_TEXT)
        }
      }}
      noValidate
      className='flex flex-col gap-2'
    >
      <Label htmlFor={inputId}>Enter the code shown in the app</Label>
      <CodeInput
        ref={inputRef}
        id={inputId}
        chars={chars}
        onChars={(next) => {
          setChars(next)
          setError(null)
          setNote(undefined)
        }}
        invalid={!!error}
        describedBy={error ? errorId : note ? noteId : undefined}
        readOnly={busy}
        // No example code beside the note, where it would read as the
        // code from the link
        placeholder={note ? '' : undefined}
      />
      {note && !error && (
        <p id={noteId} className='text-xs text-muted-foreground'>
          {note}
        </p>
      )}
      {error && (
        <p id={errorId} role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      )}
      <Button
        type='submit'
        className={cn(authButtonClass, 'mt-2', !complete && incompleteCodeButtonClass)}
        disabled={!complete || busy}
        aria-busy={busy}
      >
        {busy && <Spinner size='sm' color='white' />}
        Continue
      </Button>
    </form>
  )
}

function Approval({
  data,
  clock,
  source,
  heading,
  onDone,
  onCancelled,
  onGone,
  onExpired,
  onStop,
}: {
  data: DeviceLinkLookup
  clock: AnswerClock
  source: Source
  heading: (text: ReactNode) => ReactNode
  onDone: () => void
  onCancelled: () => void
  // The request ended on the server (approve or cancel answered 404); the
  // buttons stay off until the check of how it ended answers
  onGone: () => Promise<void>
  // The countdown reached zero
  onExpired: () => void
  onStop: (text: string) => void
}) {
  const options = Array.isArray(data.options) ? data.options : []
  const devices = options.filter(
    (option): option is DeviceLinkDeviceOption => option.type === 'reconnect'
  )
  const newOption = options.find(
    (option): option is DeviceLinkNewOption => option.type === 'new'
  )
  const mainDevices = devices.filter((option) => option.group !== 'replace')
  const replaceDevices = devices.filter((option) => option.group === 'replace')
  const blocked = data.mode === 'blocked'
  const onlyNew = !!newOption && devices.length === 0

  const initialChoice = (() => {
    // A list of one new device is that choice
    if (onlyNew) return newOption?.allowed ? 'new' : null
    const suggested = data.suggested
    if (suggested === 'new') return newOption?.allowed ? 'new' : null
    const match = devices.find((option) => option.deviceId === suggested)
    return match?.allowed ? match.deviceId : null
  })()

  const [choice, setChoice] = useState<string | null>(initialChoice)
  const [name, setName] = useState(data.defaultName ?? '')
  const [makeDefault, setMakeDefault] = useState(false)
  // Offered only when the server sends it; an older server sends nothing
  const defaultChoice =
    data.defaultChoice && typeof data.defaultChoice === 'object'
      ? data.defaultChoice
      : null
  const currentDefaultName =
    typeof defaultChoice?.currentDefaultName === 'string' &&
    defaultChoice.currentDefaultName.trim()
      ? defaultChoice.currentDefaultName
      : null
  const [groupOpen, setGroupOpen] = useState(
    replaceDevices.some((option) => option.deviceId === initialChoice) ||
      (data.suggested === null && newOption?.allowed !== true)
  )
  const [typed, setTyped] = useState('')
  const [typedBad, setTypedBad] = useState(false)
  // The server asked for the typed code after the lookup, for example because
  // the browser changed networks; its text shows under the field
  const [forceAsk, setForceAsk] = useState(false)
  const [typedError, setTypedError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // A failure the same action may get past, such as a lost connection
  const [failedAction, setFailedAction] = useState<'approve' | 'deny' | null>(
    null
  )
  const { remaining, expired } = useCountdown(clock)

  useEffect(() => {
    // An approve, cancel or check that runs decides first
    if (expired && busy === null) onExpired()
  }, [expired, busy, onExpired])

  const idBase = useId()
  const typedId = `${idBase}-typed`
  const typedErrorId = `${idBase}-typed-error`
  const typedServerErrorId = `${idBase}-typed-server-error`
  const nameId = `${idBase}-name`
  const groupName = `${idBase}-choice`

  const askCode = (data.mustTypeCode === true && !source.typed) || forceAsk
  const showCode = !askCode
  const countries =
    data.requestedFrom && data.browserFrom && data.requestedFrom !== data.browserFrom

  // Place, code and time left on one quiet line. With two places the line
  // below names both, so the place is left out here.
  const facts: Array<{ key: string; node: ReactNode; wrap: boolean }> = []
  if (data.requestedFrom && !countries) {
    facts.push({ key: 'from', node: data.requestedFrom, wrap: true })
  }
  if (showCode) {
    facts.push({
      key: 'code',
      node: (
        <>
          Code{' '}
          <span className='font-mono text-foreground'>
            <Ltr>{displayCode(source.code)}</Ltr>
          </span>
        </>
      ),
      wrap: false,
    })
  }
  if (remaining !== null && !expired) {
    facts.push({
      key: 'left',
      node: (
        <>
          <span role='timer'>{remainingLabel(remaining)}</span> left
        </>
      ),
      wrap: false,
    })
  }

  const resend = async () => {
    try {
      await httpBrowserClient.post(
        ApiEndpoints.auth.sendEmailVerificationEmail()
      )
      toast({ title: 'Verification email sent', description: data.accountEmail })
    } catch (error) {
      if (sessionEnded(error)) return
      toast({
        variant: 'destructive',
        title: 'Could not send the email',
        description: 'Please try again in a moment.',
      })
    }
  }

  // Errors an action may get past by trying again; the rest stop the page
  const failed = async (error: unknown, action: 'approve' | 'deny') => {
    const status = responseOf(error)?.status
    if (status === 404) {
      await onGone()
    } else if (status === 403) {
      onStop(errorText(error))
    } else {
      setActionError(errorText(error))
      setFailedAction(action)
    }
  }

  const approve = async () => {
    if (!choice || busy || expired || isFramed()) return
    let typedCode: string | undefined = source.typed ? source.code : undefined
    if (askCode) {
      const code = normalizeCode(typed)
      if (!code) {
        setTypedBad(true)
        document.getElementById(typedId)?.focus()
        return
      }
      typedCode = code
    }
    const trimmed = name.trim()
    const body: Record<string, string | boolean> =
      choice === 'new'
        ? { action: 'new', ...(trimmed && { name: trimmed }) }
        : { action: 'reconnect', deviceId: choice }
    if (typedCode) body.typedCode = typedCode
    if (choice === 'new' && defaultChoice && makeDefault) body.makeDefault = true

    setBusy('approve')
    setActionError(null)
    setFailedAction(null)
    setTypedError(null)
    try {
      await inTime(
        httpBrowserClient.post(
          ApiEndpoints.auth.approveDeviceLink(source.code),
          body,
          REQUEST_TIMEOUT
        )
      )
      onDone()
    } catch (error) {
      if (sessionEnded(error)) return
      const status = responseOf(error)?.status
      const reason = (responseOf(error)?.data as { code?: unknown } | undefined)
        ?.code
      if (status === 400 && reason === 'TYPED_CODE') {
        // The code must be typed, or the typed one does not match
        setForceAsk(true)
        setTypedError(errorText(error))
        setTimeout(() => document.getElementById(typedId)?.focus(), 0)
      } else if (status === 400 || status === 409) {
        // A choice that is no longer there, or the plan limit: choose again
        setActionError(errorText(error))
      } else {
        await failed(error, 'approve')
      }
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (busy || isFramed()) return
    setBusy('deny')
    setActionError(null)
    setFailedAction(null)
    try {
      await inTime(
        httpBrowserClient.post(
          ApiEndpoints.auth.denyDeviceLink(source.code),
          undefined,
          REQUEST_TIMEOUT
        )
      )
      onCancelled()
    } catch (error) {
      if (sessionEnded(error)) return
      await failed(error, 'deny')
    } finally {
      setBusy(null)
    }
  }

  const deviceRow = (option: DeviceLinkDeviceOption) => {
    const warningId = `${idBase}-w-${option.deviceId}`
    const line = deviceLine(option)
    return (
      <div key={option.deviceId} className='py-3'>
        <label
          className={cn(
            'flex gap-3',
            option.allowed ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
          )}
        >
          <input
            type='radio'
            name={groupName}
            value={option.deviceId}
            checked={choice === option.deviceId}
            disabled={!option.allowed}
            onChange={() => setChoice(option.deviceId)}
            aria-describedby={option.warning ? warningId : undefined}
            className='mt-0.5 h-4 w-4 shrink-0 accent-primary'
          />
          <span className='min-w-0 flex-1'>
            <span className='block break-words text-sm font-medium [overflow-wrap:anywhere]'>
              Reconnect {deviceTitle(option)}
            </span>
            {line && (
              <span className='mt-0.5 block text-xs text-muted-foreground'>
                {line}
              </span>
            )}
          </span>
        </label>
        {option.warning?.text && (
          <div className='pl-7'>
            <Warning id={warningId} text={option.warning.text} />
          </div>
        )}
      </div>
    )
  }

  const defaultFullText =
    currentDefaultName !== null
      ? `Sends without a device ID go to the default device. Now: ${currentDefaultName}.`
      : 'Sends without a device ID go to the phone that was active last. Tick this to always use this phone.'

  const defaultId = `${idBase}-default`
  const defaultHelpId = `${idBase}-default-help`

  const nameField = (
    <div className='flex flex-col gap-3'>
      <div className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
        <Label htmlFor={nameId} className='font-normal text-muted-foreground'>
          Name
        </Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete='off'
          className='h-11 text-base sm:h-9 sm:text-sm'
        />
      </div>
      {defaultChoice && (
        <div className='flex items-start gap-2.5'>
          <Checkbox
            id={defaultId}
            checked={makeDefault}
            onCheckedChange={(checked) => setMakeDefault(checked === true)}
            aria-describedby={defaultHelpId}
            className='mt-0.5'
          />
          <Label
            htmlFor={defaultId}
            className='min-w-0 break-words font-normal leading-5 [overflow-wrap:anywhere]'
          >
            Make it the default device
            {currentDefaultName !== null && (
              <>
                {' '}
                <span className='text-muted-foreground'>
                  (now: {currentDefaultName})
                </span>
              </>
            )}
          </Label>
          <span id={defaultHelpId} className='sr-only'>
            {defaultFullText}
          </span>
        </div>
      )}
    </div>
  )

  const newRow = (option: DeviceLinkNewOption) => {
    const warningId = `${idBase}-w-new`
    return (
      <div key='new' className='py-3'>
        <label
          className={cn(
            'flex gap-3',
            option.allowed ? 'cursor-pointer' : 'cursor-not-allowed'
          )}
        >
          <input
            type='radio'
            name={groupName}
            value='new'
            checked={choice === 'new'}
            disabled={!option.allowed}
            onChange={() => setChoice('new')}
            aria-describedby={option.warning ? warningId : undefined}
            className='mt-0.5 h-4 w-4 shrink-0 accent-primary'
          />
          <span
            className={cn(
              'min-w-0 flex-1 text-sm font-medium',
              !option.allowed && 'opacity-60'
            )}
          >
            Add as a new device
          </span>
        </label>
        {option.warning?.text && (
          <div className='pl-7'>
            <Warning id={warningId} text={option.warning.text} />
          </div>
        )}
        {choice === 'new' && <div className='mt-3 pl-7'>{nameField}</div>}
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void approve()
      }}
      noValidate
      className='flex flex-col gap-5'
    >
      <div className='space-y-2'>
        {heading(TEXT.approveTitle)}
        <div className='space-y-0.5 text-sm text-muted-foreground'>
          <p className='break-words text-foreground [overflow-wrap:anywhere]'>
            {data.phone?.name}{' '}
            <span className='text-muted-foreground/70'>
              (name sent by the phone)
            </span>
          </p>
          {facts.length > 0 && (
            <p className='break-words [overflow-wrap:anywhere]'>
              {facts.map((fact, index) => (
                <Fragment key={fact.key}>
                  {index > 0 && ' '}
                  {/* The place may wrap; the code and the time stay whole. A
                      no-break space keeps each dot with its fact. */}
                  <span className={fact.wrap ? undefined : 'whitespace-nowrap'}>
                    {fact.node}
                    {index < facts.length - 1 && (
                      <span aria-hidden className='text-muted-foreground/60'>
                        {'\u00a0·'}
                      </span>
                    )}
                  </span>
                </Fragment>
              ))}
            </p>
          )}
          {countries && (
            <p>
              The phone: {data.requestedFrom}. This browser: {data.browserFrom}.
            </p>
          )}
        </div>
      </div>

      {data.emailVerified === false && (
        <p className='text-sm text-muted-foreground'>
          {TEXT.unverified}{' '}
          <button
            type='button'
            onClick={() => void resend()}
            className='rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            Resend verification email
          </button>
        </p>
      )}

      {data.message && (
        <Alert variant='warning'>
          <AlertTriangle className='h-4 w-4 text-warning' />
          <AlertDescription>{data.message}</AlertDescription>
        </Alert>
      )}

      {askCode && !blocked && (
        <div className='flex flex-col gap-1.5'>
          <p className='text-sm'>{TEXT.typeCode}</p>
          <Label htmlFor={typedId} className='mt-1.5'>
            Code from the app
          </Label>
          <CodeInput
            id={typedId}
            chars={typed}
            onChars={(next) => {
              setTyped(next)
              setTypedBad(false)
              setTypedError(null)
            }}
            readOnly={busy !== null}
            invalid={typedBad || !!typedError}
            describedBy={
              typedBad
                ? typedErrorId
                : typedError
                  ? typedServerErrorId
                  : undefined
            }
          />
          {typedBad && (
            <p id={typedErrorId} role='alert' className='text-sm text-destructive'>
              {BAD_CODE_TEXT}
            </p>
          )}
          {typedError && !typedBad && (
            <p
              id={typedServerErrorId}
              role='alert'
              className='text-sm text-destructive'
            >
              {typedError}
            </p>
          )}
        </div>
      )}

      {!blocked && options.length > 0 && (
        <fieldset className='flex flex-col'>
          <legend className='sr-only'>Choose a device</legend>
          <div className='divide-y border-y'>
            {mainDevices.map(deviceRow)}
            {newOption && newRow(newOption)}
          </div>
          {replaceDevices.length > 0 && (
            <details
              open={groupOpen}
              onToggle={(event) => setGroupOpen(event.currentTarget.open)}
              className='mt-3'
            >
              <summary className='cursor-pointer rounded-sm py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                Use this phone in place of another device
              </summary>
              <div className='mt-1 divide-y border-y'>
                {replaceDevices.map(deviceRow)}
              </div>
            </details>
          )}
        </fieldset>
      )}

      {!blocked && (
        <p className='flex items-start gap-2 text-sm'>
          <Info aria-hidden className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
          <span>{TEXT.safety}</span>
        </p>
      )}

      {actionError && (
        <Alert variant='destructive'>
          <AlertDescription className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
            <span>{actionError}</span>
            {failedAction && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='shrink-0'
                disabled={busy !== null}
                onClick={() =>
                  void (failedAction === 'approve' ? approve() : cancel())
                }
              >
                Try again
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-2 sm:flex-row-reverse'>
        {!blocked && (
          <Button
            type='submit'
            className='h-12 text-base sm:h-10 sm:flex-1 sm:text-sm'
            disabled={!choice || expired || busy !== null}
          >
            {busy === 'approve' && <Spinner size='sm' color='white' />}
            Connect phone
          </Button>
        )}
        <Button
          type='button'
          variant='outline'
          className='h-12 text-base sm:h-10 sm:flex-1 sm:text-sm'
          disabled={busy !== null}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
