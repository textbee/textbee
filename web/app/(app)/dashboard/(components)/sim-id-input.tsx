'use client'

import { forwardRef, useEffect, useRef, useState } from 'react'
import { isValid } from 'date-fns'
import { AlertTriangle, CardSim } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toRelativeLabel } from '@/components/shared/relative-time'
import { cn } from '@/lib/utils'
import {
  SIM_ID_ERROR,
  parseSimId,
  reportedSims,
  type ReportedSim,
} from '@/lib/sim-id'

type SimIdInputProps = {
  id: string
  // NaN while the text is not a valid ID, so the form can block the send
  value?: number
  onChange: (value: number | undefined) => void
  simInfo?: { lastUpdated?: string; sims?: unknown[] }
  error?: string
}

// Off by default, so most sends never see it. A typed ID rather than a
// dropdown: the SIM list is the phone's last report, and an ID that changed
// since then sends from the default SIM. Reported IDs are fill-in suggestions.
// Give it a key per device so the toggle does not carry over.
export const SimIdInput = forwardRef<HTMLInputElement, SimIdInputProps>(
  function SimIdInput({ id, value, onChange, simInfo, error }, ref) {
    const sims = reportedSims(simInfo)
    const [enabled, setEnabled] = useState(value !== undefined)
    const [text, setText] = useState(
      value === undefined || Number.isNaN(value) ? '' : String(value)
    )
    const inputRef = useRef<HTMLInputElement | null>(null)
    const focusOnOpen = useRef(false)

    // A set ID always shows, so an invalid one can never be hidden
    const on = enabled || value !== undefined

    // Follow resets from outside, without reformatting what is being typed
    useEffect(() => {
      if (value === undefined && text.trim() !== '') setText('')
      else if (value !== undefined && !Number.isNaN(value) && parseSimId(text) !== value) {
        setText(String(value))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    useEffect(() => {
      if (on && focusOnOpen.current) {
        focusOnOpen.current = false
        inputRef.current?.focus()
      }
    }, [on])

    const set = (next: string) => {
      setText(next)
      onChange(parseSimId(next))
    }

    const toggle = (checked: boolean) => {
      setEnabled(checked)
      if (checked) {
        focusOnOpen.current = true
      } else {
        setText('')
        onChange(undefined)
      }
    }

    const reportedAt = simInfo?.lastUpdated ? new Date(simInfo.lastUpdated) : null
    const age =
      reportedAt && isValid(reportedAt) ? toRelativeLabel(reportedAt).toLowerCase() : null
    const typed = value !== undefined && !Number.isNaN(value)
    const matched = typed ? sims.find((s) => s.subscriptionId === value) : undefined
    // Shown while typing, not only after a submit attempt
    const shownError =
      error ?? (value !== undefined && Number.isNaN(value) ? SIM_ID_ERROR : undefined)
    const describedBy = shownError ? `${id}-help ${id}-error` : `${id}-help`

    return (
      <div className='space-y-3'>
        <div className='flex items-center gap-2.5'>
          <Switch
            id={`${id}-toggle`}
            checked={on}
            onCheckedChange={toggle}
            aria-controls={on ? `${id}-editor` : undefined}
          />
          <Label htmlFor={`${id}-toggle`} className='cursor-pointer'>
            Send from a specific SIM
          </Label>
        </div>

        {on && (
          <div id={`${id}-editor`} className='space-y-2 pl-[2.875rem]'>
            <div className='flex flex-wrap items-center gap-2'>
              <Input
                ref={(el) => {
                  inputRef.current = el
                  if (typeof ref === 'function') ref(el)
                  else if (ref) ref.current = el
                }}
                id={id}
                type='text'
                inputMode='numeric'
                autoComplete='off'
                placeholder='SIM subscription ID'
                aria-label='SIM subscription ID'
                className='h-8 w-48 font-mono placeholder:font-sans'
                value={text}
                onChange={(e) => set(e.target.value)}
                aria-invalid={!!shownError || undefined}
                aria-describedby={describedBy}
              />
              {sims.map((sim) => (
                <SimSuggestion
                  key={sim.subscriptionId}
                  sim={sim}
                  selected={matched?.subscriptionId === sim.subscriptionId}
                  onPick={() => set(String(sim.subscriptionId))}
                />
              ))}
            </div>

            {shownError && (
              <p id={`${id}-error`} role='alert' className='text-sm text-destructive'>
                {shownError}
              </p>
            )}

            <div id={`${id}-help`} className='space-y-1'>
              {typed && !matched && sims.length > 0 && (
                <p className='text-xs text-warning'>
                  No SIM with subscription ID {value} in the phone&apos;s last
                  report. If the phone has no SIM with this ID, it sends from
                  the SIM set as default in the textbee app, or the
                  phone&apos;s default SIM.
                </p>
              )}
              <p className='flex gap-1.5 text-xs text-muted-foreground'>
                <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-warning' aria-hidden />
                <span>
                  Enter the SIM subscription ID, not the slot number (SIM 1 or
                  SIM 2).{' '}
                  {sims.length > 0 && age
                    ? `The IDs above were reported ${age} and can change after a SIM swap,`
                    : 'Subscription IDs can change after a SIM swap,'}{' '}
                  so confirm the ID in the SIM Cards section of the textbee
                  app.
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }
)

function SimSuggestion({
  sim,
  selected,
  onPick,
}: {
  sim: ReportedSim
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onPick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
        selected
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted'
      )}
    >
      <CardSim className='h-3 w-3 shrink-0' aria-hidden />
      <span>{sim.label}</span>
      <span className='font-mono font-medium text-foreground'>{sim.subscriptionId}</span>
    </button>
  )
}
