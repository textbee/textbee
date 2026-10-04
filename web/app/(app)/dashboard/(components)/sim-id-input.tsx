'use client'

import { forwardRef, useEffect, useState } from 'react'
import { isValid } from 'date-fns'
import { AlertTriangle, CardSim } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

// A typed ID rather than a dropdown: the SIM list is the phone's last report,
// and an ID that changed since then sends from the default SIM. The reported
// IDs are offered as fill-in suggestions, with that caveat next to them.
// Give it a key per device so the expanded state does not carry over.
export const SimIdInput = forwardRef<HTMLInputElement, SimIdInputProps>(
  function SimIdInput({ id, value, onChange, simInfo, error }, ref) {
    const sims = reportedSims(simInfo)
    const [text, setText] = useState(
      value === undefined || Number.isNaN(value) ? '' : String(value)
    )
    const [expanded, setExpanded] = useState(false)

    // Follow resets from outside, without reformatting what is being typed
    useEffect(() => {
      if (value === undefined && text.trim() !== '') setText('')
      else if (value !== undefined && !Number.isNaN(value) && parseSimId(text) !== value) {
        setText(String(value))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const set = (next: string) => {
      setText(next)
      onChange(parseSimId(next))
    }

    if (sims.length <= 1 && !expanded && value === undefined) {
      return (
        <button
          type='button'
          className='self-start text-xs font-medium text-primary underline-offset-2 hover:underline'
          onClick={() => setExpanded(true)}
        >
          Send from a specific SIM
        </button>
      )
    }

    const reportedAt = simInfo?.lastUpdated ? new Date(simInfo.lastUpdated) : null
    const typed = value !== undefined && !Number.isNaN(value)
    const matched = typed ? sims.find((s) => s.subscriptionId === value) : undefined
    // Shown while typing, not only after a submit attempt
    const shownError =
      error ?? (value !== undefined && Number.isNaN(value) ? SIM_ID_ERROR : undefined)
    const describedBy = shownError ? `${id}-help ${id}-error` : `${id}-help`

    return (
      <div className='space-y-2'>
        <div className='space-y-1.5'>
          <Label htmlFor={id}>SIM subscription ID (optional)</Label>
          <Input
            ref={ref}
            id={id}
            type='text'
            inputMode='numeric'
            autoComplete='off'
            autoFocus={expanded}
            placeholder='Leave empty for the default SIM'
            value={text}
            onChange={(e) => set(e.target.value)}
            aria-invalid={!!shownError || undefined}
            aria-describedby={describedBy}
          />
          {shownError && (
            <p id={`${id}-error`} role='alert' className='text-sm text-destructive'>
              {shownError}
            </p>
          )}
        </div>

        <div id={`${id}-help`} className='space-y-2'>
          {sims.length > 0 && (
            <div className='space-y-1.5'>
              <p className='text-xs text-muted-foreground'>
                Last reported by this phone
                {reportedAt && isValid(reportedAt) &&
                  ` ${toRelativeLabel(reportedAt).toLowerCase()}`}
                . Select one to fill in:
              </p>
              <div className='flex flex-wrap gap-1.5'>
                {sims.map((sim) => (
                  <SimSuggestion
                    key={sim.subscriptionId}
                    sim={sim}
                    selected={matched?.subscriptionId === sim.subscriptionId}
                    onPick={() => set(String(sim.subscriptionId))}
                  />
                ))}
              </div>
            </div>
          )}

          {typed && !matched && sims.length > 0 && (
            <p className='text-xs text-warning'>
              No SIM with ID {value} in the phone&apos;s last report. If the
              phone has no SIM with this ID, it sends from the SIM set as
              default in the textbee app, or the phone&apos;s default SIM.
            </p>
          )}

          <p className='flex gap-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-foreground'>
            <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0 text-warning' aria-hidden />
            <span>
              SIM IDs can change when a SIM is removed, reinserted or swapped.
              {sims.length > 0 &&
                " These suggestions are only as current as the phone's last report."}{' '}
              Before you send, check the ID in the SIM Cards section of the
              textbee app.
            </span>
          </p>
        </div>
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
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
