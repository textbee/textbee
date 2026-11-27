'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import axios from 'axios'
import { AlertTriangle } from 'lucide-react'
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
import {
  BAD_CODE_TEXT,
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
  done: 'Done. The phone connects in a few seconds. If it does not, open the textbee app on the phone. You can close this page.',
  already: 'Already approved. You can close this page.',
  cancelled: 'Request cancelled. Nothing was changed.',
  notFound: 'This code is not valid or has expired. Start again in the app.',
  expired: 'This code has expired. Start again in the app.',
  notAvailable: 'Sign-in is not available right now. Use an API key instead.',
  failed: 'Something went wrong. Try again.',
  framed: 'Open this page in its own browser tab to connect a phone.',
  safety:
    'Continue only if you started this in the textbee app on a phone you have with you. If someone sent you this link or code, tap Cancel. A connected phone sends SMS for this account and uploads the texts it receives.',
  typeCode:
    'This request came from a different network than this browser. Type the code shown in the textbee app to continue.',
  unverified:
    'Your email is not verified yet. You can connect the phone now. Sending and receiving start after you verify.',
}

// A request can be approved for 10 minutes; a countdown never shows more
const APPROVE_WINDOW_MS = 10 * 60 * 1000

type Source = { code: string; typed: boolean; fromDashboard: boolean }

type View =
  | { kind: 'starting' }
  | { kind: 'enter' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: DeviceLinkLookup; clock: AnswerClock }
  | { kind: 'done' }
  | { kind: 'cancelled' }
  | { kind: 'already' }
  | { kind: 'message'; text: string }

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
  return [model && `${model}.`, seen && `Last active ${seen}.`]
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
    <p
      id={id}
      className='mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/[0.08] px-2.5 py-1.5 text-xs leading-5 text-warning'
    >
      <AlertTriangle aria-hidden className='mt-[3px] h-3.5 w-3.5 shrink-0' />
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
  returnTo,
}: {
  addressCode?: string
  sessionEmail: string
  // The name of the signed-in session; may be empty
  sessionName?: string
  returnTo: string
}) {
  const [view, setView] = useState<View>({ kind: 'starting' })
  const [source, setSource] = useState<Source | null>(null)
  const [email, setEmail] = useState(sessionEmail)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)
  const firstView = useRef(true)
  const framed = useIsFramed()

  const lookup = useCallback(async (next: Source) => {
    setSource(next)
    setView({ kind: 'loading' })
    try {
      const response = await httpBrowserClient.get(
        ApiEndpoints.auth.deviceLink(next.code)
      )
      const at = monotonicNow()
      const data = response.data?.data as DeviceLinkLookup | undefined
      if (!data || typeof data !== 'object') {
        setView({ kind: 'message', text: TEXT.failed })
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
      setView({ kind: 'message', text: errorText(error) })
    }
  }, [])

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
      if (code) void lookup({ code, typed: false, fromDashboard: false })
      else setView({ kind: 'enter' })
    } else if (stored) {
      void lookup({ code: stored, typed: true, fromDashboard: true })
    } else {
      setView({ kind: 'enter' })
    }
  }, [addressCode, lookup])

  // A new state moves focus to its heading, so screen readers announce it
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false
      return
    }
    headingRef.current?.focus()
  }, [view.kind])

  // The login library would build the address from its own site setting,
  // which can be another site; this page builds it from its own origin
  const switchAccount = () =>
    // The link page cannot loop, so it loads again even after a failure
    signOutTo(linkPageReturnPath(returnTo, window.location.origin), {
      loadOnFailure: true,
    })

  // The card of the login page, with the account on top and the page title
  const shell = (children: ReactNode, line?: string) => (
    <Card className='w-full max-w-[420px] rounded-2xl shadow-[0_16px_40px_-20px_rgb(28_27_26/0.18)]'>
      <CardContent className='flex flex-col gap-5 rounded-xl px-5 py-6 sm:px-7 sm:py-8'>
        <AccountRow
          name={sessionName.trim()}
          email={email}
          onSwitch={() => void switchAccount()}
        />
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
        {children}
      </CardContent>
    </Card>
  )

  // The heading of a state, which takes focus when the state appears
  const heading = (text: ReactNode) => (
    <h2
      ref={headingRef}
      tabIndex={-1}
      className='text-base font-medium leading-6 focus:outline-none'
    >
      {text}
    </h2>
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
          onCode={(code) =>
            void lookup({ code, typed: true, fromDashboard: false })
          }
        />,
        TEXT.enterLine
      )
    case 'done':
      return shell(
        <>
          {heading(TEXT.done)}
          {source?.fromDashboard && (
            <Button asChild className={authButtonClass}>
              <a href={Routes.dashboard}>Back to devices</a>
            </Button>
          )}
        </>
      )
    case 'already':
      return shell(heading(TEXT.already))
    case 'cancelled':
      return shell(heading(TEXT.cancelled))
    case 'message':
      return shell(heading(view.text))
    case 'ready':
      return shell(
        <Approval
          data={view.data}
          clock={view.clock}
          source={source as Source}
          heading={heading}
          onDone={() => setView({ kind: 'done' })}
          onCancelled={() => setView({ kind: 'cancelled' })}
          onStop={(text) => setView({ kind: 'message', text })}
        />
      )
  }
}

export function FramedNotice() {
  return (
    <Card className='w-full max-w-md rounded-2xl'>
      <CardContent className='px-5 py-6 sm:px-7 sm:py-8'>
        <p className='text-sm'>{TEXT.framed}</p>
      </CardContent>
    </Card>
  )
}

function EnterCode({ onCode }: { onCode: (code: string) => void }) {
  const [value, setValue] = useState('')
  const [bad, setBad] = useState(false)
  const inputId = useId()
  const errorId = useId()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const code = normalizeCode(value)
    if (!code) {
      setBad(true)
      return
    }
    onCode(code)
  }

  return (
    <form onSubmit={submit} noValidate className='flex flex-col gap-2'>
      <Label htmlFor={inputId}>Enter the code shown in the app</Label>
      <Input
        id={inputId}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setBad(false)
        }}
        placeholder='K7QX-2M9P'
        autoComplete='off'
        autoCapitalize='characters'
        spellCheck={false}
        maxLength={20}
        aria-invalid={bad}
        aria-describedby={bad ? errorId : undefined}
        className='h-14 text-center font-mono text-xl uppercase tracking-[0.2em] sm:h-12 sm:text-lg'
      />
      {bad && (
        <p id={errorId} role='alert' className='text-sm text-destructive'>
          {BAD_CODE_TEXT}
        </p>
      )}
      <Button type='submit' className={cn(authButtonClass, 'mt-2')}>
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
  onStop,
}: {
  data: DeviceLinkLookup
  clock: AnswerClock
  source: Source
  heading: (text: ReactNode) => ReactNode
  onDone: () => void
  onCancelled: () => void
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
  const { remaining, expired } = useCountdown(clock)

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

  const approve = async (event: FormEvent) => {
    event.preventDefault()
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
    setTypedError(null)
    try {
      await httpBrowserClient.post(
        ApiEndpoints.auth.approveDeviceLink(source.code),
        body
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
        onStop(errorText(error))
      }
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (busy || isFramed()) return
    setBusy('deny')
    setActionError(null)
    try {
      await httpBrowserClient.post(ApiEndpoints.auth.denyDeviceLink(source.code))
      onCancelled()
    } catch (error) {
      if (sessionEnded(error)) return
      if (responseOf(error)?.status === 404) onStop(errorText(error))
      else setActionError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const deviceRow = (option: DeviceLinkDeviceOption) => {
    const warningId = `${idBase}-w-${option.deviceId}`
    const line = deviceLine(option)
    return (
      <div
        key={option.deviceId}
        className='rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04]'
      >
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

  const defaultId = `${idBase}-default`
  const defaultHelpId = `${idBase}-default-help`

  const nameField = (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor={nameId}>Device name</Label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          autoComplete='off'
          className={authFieldClass}
        />
      </div>
      {defaultChoice && (
        <div className='flex gap-2.5'>
          <Checkbox
            id={defaultId}
            checked={makeDefault}
            onCheckedChange={(checked) => setMakeDefault(checked === true)}
            aria-describedby={defaultHelpId}
            className='mt-0.5'
          />
          <div className='min-w-0 flex-1'>
            <Label htmlFor={defaultId} className='leading-5'>
              Make this phone the default device
            </Label>
            <p
              id={defaultHelpId}
              className='mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]'
            >
              {currentDefaultName !== null
                ? `Sends without a device ID go to the default device. Now: ${currentDefaultName}.`
                : 'Sends without a device ID go to the phone that was active last. Tick this to always use this phone.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )

  const newRow = (option: DeviceLinkNewOption) => {
    const warningId = `${idBase}-w-new`
    return (
      <div
        key='new'
        className='rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04]'
      >
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
    <form onSubmit={approve} noValidate className='flex flex-col gap-5'>
      {heading(
        <>
          Connect this phone to <Ltr>{data.accountEmail}</Ltr>?
        </>
      )}

      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border px-3.5 py-3 text-sm'>
        <dt className='text-muted-foreground'>Phone</dt>
        <dd className='min-w-0'>
          <span className='break-words [overflow-wrap:anywhere]'>
            {data.phone?.name}
          </span>
          <span className='block text-xs text-muted-foreground'>
            Name sent by the phone
          </span>
        </dd>
        {countries ? (
          <>
            <dt className='text-muted-foreground'>The phone</dt>
            <dd>{data.requestedFrom}</dd>
            <dt className='text-muted-foreground'>This browser</dt>
            <dd>{data.browserFrom}</dd>
          </>
        ) : (
          <>
            <dt className='text-muted-foreground'>Requested from</dt>
            <dd>{data.requestedFrom}</dd>
          </>
        )}
        {showCode && (
          <>
            <dt className='text-muted-foreground'>Code</dt>
            <dd className='font-mono'>
              <Ltr>{displayCode(source.code)}</Ltr>
            </dd>
          </>
        )}
      </dl>

      {remaining !== null && !expired && (
        <p className='text-xs text-muted-foreground'>
          Expires in <span role='timer'>{remainingLabel(remaining)}</span>
        </p>
      )}

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
          <Input
            id={typedId}
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value)
              setTypedBad(false)
              setTypedError(null)
            }}
            placeholder='K7QX-2M9P'
            autoComplete='off'
            autoCapitalize='characters'
            spellCheck={false}
            maxLength={20}
            aria-invalid={typedBad || !!typedError}
            aria-describedby={
              typedBad
                ? typedErrorId
                : typedError
                  ? typedServerErrorId
                  : undefined
            }
            className='h-12 text-center font-mono text-lg uppercase tracking-[0.2em] sm:h-11 sm:text-base'
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
        <fieldset className='flex flex-col gap-2'>
          <legend className='sr-only'>Choose a device</legend>
          {mainDevices.map(deviceRow)}
          {newOption && newRow(newOption)}
          {replaceDevices.length > 0 && (
            <details
              open={groupOpen}
              onToggle={(event) => setGroupOpen(event.currentTarget.open)}
              className='mt-1'
            >
              <summary className='cursor-pointer rounded-sm py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                Use this phone in place of another device
              </summary>
              <div className='mt-2 flex flex-col gap-2'>
                {replaceDevices.map(deviceRow)}
              </div>
            </details>
          )}
        </fieldset>
      )}

      {!blocked && (
        <p className='rounded-lg border bg-muted/40 px-3.5 py-3 text-xs leading-5 text-muted-foreground'>
          {TEXT.safety}
        </p>
      )}

      {expired && (
        <Alert variant='destructive'>
          <AlertDescription>{TEXT.expired}</AlertDescription>
        </Alert>
      )}
      {actionError && !expired && (
        <Alert variant='destructive'>
          <AlertDescription>{actionError}</AlertDescription>
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
