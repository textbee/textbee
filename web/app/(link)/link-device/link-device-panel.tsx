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
import { signOut } from 'next-auth/react'
import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { toRelativeLabel } from '@/components/shared/relative-time'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'
import { toast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import {
  BAD_CODE_TEXT,
  displayCode,
  normalizeCode,
  takeTypedCode,
} from '@/lib/device-link'
import type {
  DeviceLinkDeviceOption,
  DeviceLinkLookup,
  DeviceLinkNewOption,
} from '@/lib/api/types'
import { cn } from '@/lib/utils'

export const TEXT = {
  done: 'Done. The phone connects in a few seconds. If it does not, open the textbee app on the phone. You can close this page.',
  already: 'Already approved. You can close this page.',
  cancelled: 'Request cancelled. Nothing was changed.',
  notFound: 'This code is not valid or has expired. Start again in the app.',
  expired: 'This code has expired. Start again in the app.',
  notAvailable: 'Sign-in is not available right now. Use an API key instead.',
  failed: 'Something went wrong. Try again.',
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
  | { kind: 'ready'; data: DeviceLinkLookup }
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
    <p id={id} className='mt-1.5 flex items-start gap-1.5 text-xs text-warning'>
      <AlertTriangle aria-hidden className='mt-px h-3.5 w-3.5 shrink-0' />
      <span>{text}</span>
    </p>
  )
}

// A browser clock behind the server's would show more time than there is,
// one ahead would end a live request: then no countdown, the server decides
function deadlineOf(expiresAt: string): number | null {
  const left = Date.parse(expiresAt) - Date.now()
  return Number.isFinite(left) && left > 0
    ? Date.now() + Math.min(left, APPROVE_WINDOW_MS)
    : null
}

function useCountdown(expiresAt: string) {
  const [deadline] = useState(() => deadlineOf(expiresAt))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadline === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
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
  returnTo,
}: {
  addressCode?: string
  sessionEmail: string
  returnTo: string
}) {
  const [view, setView] = useState<View>({ kind: 'starting' })
  const [source, setSource] = useState<Source | null>(null)
  const [email, setEmail] = useState(sessionEmail)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)
  const firstView = useRef(true)

  const lookup = useCallback(async (next: Source) => {
    setSource(next)
    setView({ kind: 'loading' })
    try {
      const response = await httpBrowserClient.get(
        ApiEndpoints.auth.deviceLink(next.code)
      )
      const data = response.data?.data as DeviceLinkLookup | undefined
      if (!data || typeof data !== 'object') {
        setView({ kind: 'message', text: TEXT.failed })
        return
      }
      if (data.accountEmail) setEmail(data.accountEmail)
      if (data.status === 'approved') setView({ kind: 'already' })
      else if (data.status === 'denied') setView({ kind: 'cancelled' })
      else setView({ kind: 'ready', data })
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

  const useAnotherAccount = () => {
    void signOut({ callbackUrl: returnTo })
  }

  const topLine = (
    <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground'>
      <span className='min-w-0 break-words [overflow-wrap:anywhere]'>
        Signed in as <Ltr>{email}</Ltr>
      </span>
      <button
        type='button'
        onClick={useAnotherAccount}
        className='rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        Use another account
      </button>
    </p>
  )

  const shell = (children: ReactNode) => (
    <Card className='w-full max-w-md rounded-2xl'>
      <CardContent className='flex flex-col gap-5 px-5 py-6 sm:px-7 sm:py-8'>
        {topLine}
        {children}
      </CardContent>
    </Card>
  )

  const heading = (text: ReactNode) => (
    <h1
      ref={headingRef}
      tabIndex={-1}
      className='text-xl font-semibold leading-7 tracking-tight focus:outline-none'
    >
      {text}
    </h1>
  )

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
          heading={heading}
          onCode={(code) =>
            void lookup({ code, typed: true, fromDashboard: false })
          }
        />
      )
    case 'done':
      return shell(
        <>
          {heading(TEXT.done)}
          {source?.fromDashboard && (
            <Button asChild className='self-start'>
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
          source={source as Source}
          heading={heading}
          onDone={() => setView({ kind: 'done' })}
          onCancelled={() => setView({ kind: 'cancelled' })}
          onStop={(text) => setView({ kind: 'message', text })}
        />
      )
  }
}

function EnterCode({
  heading,
  onCode,
}: {
  heading: (text: ReactNode) => ReactNode
  onCode: (code: string) => void
}) {
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
    <form onSubmit={submit} noValidate className='flex flex-col gap-3'>
      {heading(<Label htmlFor={inputId}>Enter the code shown in the app</Label>)}
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
        className='font-mono uppercase tracking-wider'
      />
      {bad && (
        <p id={errorId} role='alert' className='text-sm text-destructive'>
          {BAD_CODE_TEXT}
        </p>
      )}
      <Button type='submit' className='self-start'>
        Continue
      </Button>
    </form>
  )
}

function Approval({
  data,
  source,
  heading,
  onDone,
  onCancelled,
  onStop,
}: {
  data: DeviceLinkLookup
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
    const suggested = data.suggested
    if (suggested === 'new') return newOption?.allowed ? 'new' : null
    const match = devices.find((option) => option.deviceId === suggested)
    return match?.allowed ? match.deviceId : null
  })()

  const [choice, setChoice] = useState<string | null>(initialChoice)
  const [name, setName] = useState(data.defaultName ?? '')
  const [groupOpen, setGroupOpen] = useState(
    replaceDevices.some((option) => option.deviceId === initialChoice) ||
      (data.suggested === null && newOption?.allowed !== true)
  )
  const [typed, setTyped] = useState('')
  const [typedBad, setTypedBad] = useState(false)
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const { remaining, expired } = useCountdown(data.expiresAt)

  const idBase = useId()
  const typedId = `${idBase}-typed`
  const typedErrorId = `${idBase}-typed-error`
  const nameId = `${idBase}-name`
  const groupName = `${idBase}-choice`

  const askCode = data.mustTypeCode === true && !source.typed
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
    if (!choice || busy || expired) return
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
    const body: Record<string, string> =
      choice === 'new'
        ? { action: 'new', ...(trimmed && { name: trimmed }) }
        : { action: 'reconnect', deviceId: choice }
    if (typedCode) body.typedCode = typedCode

    setBusy('approve')
    setActionError(null)
    try {
      await httpBrowserClient.post(
        ApiEndpoints.auth.approveDeviceLink(source.code),
        body
      )
      onDone()
    } catch (error) {
      if (sessionEnded(error)) return
      const status = responseOf(error)?.status
      // A wrong choice, a wrong typed code or the limit: the user can change it
      if (status === 400 || status === 409) setActionError(errorText(error))
      else onStop(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async () => {
    if (busy) return
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
      <label
        key={option.deviceId}
        className={cn(
          'flex gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04]',
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
          {option.warning?.text && (
            <Warning id={warningId} text={option.warning.text} />
          )}
        </span>
      </label>
    )
  }

  const nameField = (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={nameId}>Device name</Label>
      <Input
        id={nameId}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
        autoComplete='off'
      />
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

  const titleId = `${idBase}-title`

  return (
    <form onSubmit={approve} noValidate className='flex flex-col gap-5'>
      <div id={titleId}>
        {heading(
          <>
            Connect this phone to <Ltr>{data.accountEmail}</Ltr>?
          </>
        )}
      </div>

      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm'>
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
            }}
            placeholder='K7QX-2M9P'
            autoComplete='off'
            autoCapitalize='characters'
            spellCheck={false}
            maxLength={20}
            aria-invalid={typedBad}
            aria-describedby={typedBad ? typedErrorId : undefined}
            className='font-mono uppercase tracking-wider'
          />
          {typedBad && (
            <p id={typedErrorId} role='alert' className='text-sm text-destructive'>
              {BAD_CODE_TEXT}
            </p>
          )}
        </div>
      )}

      {!blocked && onlyNew && newOption && (
        <div className='flex flex-col gap-3'>
          <p className='text-sm font-medium'>Add as a new device</p>
          {newOption.warning?.text && (
            <Warning id={`${idBase}-w-new`} text={newOption.warning.text} />
          )}
          {newOption.allowed && nameField}
        </div>
      )}

      {!blocked && !onlyNew && options.length > 0 && (
        <fieldset aria-labelledby={titleId} className='flex flex-col gap-2'>
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

      {!blocked && <p className='text-sm text-muted-foreground'>{TEXT.safety}</p>}

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

      <div className='flex flex-col gap-2 sm:flex-row'>
        {!blocked && (
          <Button
            type='submit'
            className='sm:flex-1'
            disabled={!choice || expired || busy !== null}
          >
            {busy === 'approve' && <Spinner size='sm' color='white' />}
            Connect phone
          </Button>
        )}
        <Button
          type='button'
          variant='outline'
          className='sm:flex-1'
          disabled={expired || busy !== null}
          onClick={() => void cancel()}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
