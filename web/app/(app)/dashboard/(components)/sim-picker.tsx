'use client'

import { forwardRef, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { isValid } from 'date-fns'
import { AlertTriangle, CardSim, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { toRelativeLabel } from '@/components/shared/relative-time'
import { cn } from '@/lib/utils'
import type { Device } from '@/lib/api'
import {
  SIM_ID_ERROR,
  parseSimId,
  reportedSims,
  type ReportedSim,
} from '@/lib/sim-id'
import { hasSimReport, simSlots, type SimSlot } from '@/lib/sim-slots'
import { SimNumbersDialog } from './devices/sim-numbers-dialog'

// Request fields. Only one is ever set.
export type SimChoice = { simSlotIndex?: number; simSubscriptionId?: number }

type Mode = 'default' | 'id' | number

type SimPickerProps = {
  id: string
  device?: Device
  // Zero-based slot of the chosen SIM segment
  slotIndex?: number
  // NaN while the typed ID is not valid, so the form can block the send
  subscriptionId?: number
  onChange: (next: SimChoice) => void
  error?: string
}

const simName = (slotIndex: number) => `SIM ${slotIndex + 1}`

// Default · SIM 1 · SIM 2 · ID. A slot sends simSlotIndex, ID sends the
// older simSubscriptionId. Give it a key per device so the choice resets.
export const SimPicker = forwardRef<HTMLInputElement, SimPickerProps>(
  function SimPicker({ id, device, slotIndex, subscriptionId, onChange, error }, ref) {
    const slots = simSlots(device?.simInfo, device?.simNumbers, slotIndex)
    const reported = hasSimReport(device?.simInfo)
    const sims = reportedSims(device?.simInfo)
    const [idOpen, setIdOpen] = useState(subscriptionId !== undefined)
    const [text, setText] = useState(
      subscriptionId === undefined || Number.isNaN(subscriptionId) ? '' : String(subscriptionId)
    )
    const [infoOpen, setInfoOpen] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const inputRef = useRef<HTMLInputElement | null>(null)
    const radioRefs = useRef<(HTMLButtonElement | null)[]>([])
    const focusOnOpen = useRef(false)

    const mode: Mode =
      slotIndex !== undefined
        ? slotIndex
        : idOpen || subscriptionId !== undefined
          ? 'id'
          : 'default'
    const options: Mode[] = ['default', ...slots.map((s) => s.slotIndex), 'id']

    // Follow resets from outside, without reformatting what is being typed
    useEffect(() => {
      if (subscriptionId === undefined && text.trim() !== '') setText('')
      else if (
        subscriptionId !== undefined &&
        !Number.isNaN(subscriptionId) &&
        parseSimId(text) !== subscriptionId
      ) {
        setText(String(subscriptionId))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscriptionId])

    useEffect(() => {
      if (mode === 'id' && focusOnOpen.current) {
        focusOnOpen.current = false
        inputRef.current?.focus()
      }
    }, [mode])

    const choose = (next: Mode, focusField = false) => {
      if (next === mode) return
      setIdOpen(next === 'id')
      setText('')
      focusOnOpen.current = next === 'id' && focusField
      onChange({
        simSlotIndex: typeof next === 'number' ? next : undefined,
        simSubscriptionId: undefined,
      })
    }

    // Arrow keys move and select, as in a native radio group
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const focused = radioRefs.current.findIndex((el) => el === document.activeElement)
      const current = focused >= 0 ? focused : options.indexOf(mode)
      let next: number
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (current + 1) % options.length
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        next = (current - 1 + options.length) % options.length
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = options.length - 1
      else return
      e.preventDefault()
      choose(options[next])
      radioRefs.current[next]?.focus()
    }

    const setTyped = (next: string) => {
      setText(next)
      onChange({ simSlotIndex: undefined, simSubscriptionId: parseSimId(next) })
    }

    const reportedAt = device?.simInfo?.lastUpdated ? new Date(device.simInfo.lastUpdated) : null
    const age =
      reportedAt && isValid(reportedAt) ? toRelativeLabel(reportedAt).toLowerCase() : null
    const chosen = typeof mode === 'number' ? slots.find((s) => s.slotIndex === mode) : undefined
    const typed = subscriptionId !== undefined && !Number.isNaN(subscriptionId)
    const matched = typed ? sims.find((s) => s.subscriptionId === subscriptionId) : undefined
    // Shown while typing, not only after a submit attempt
    const shownError =
      error ??
      (subscriptionId !== undefined && Number.isNaN(subscriptionId) ? SIM_ID_ERROR : undefined)

    return (
      <div className='space-y-1.5'>
        <Label id={`${id}-label`}>SIM</Label>
        <div className='flex items-center gap-1'>
          <div
            role='radiogroup'
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-help`}
            onKeyDown={onKeyDown}
            className='flex min-w-0 flex-wrap items-center gap-0.5 rounded-xl border bg-shell p-0.5 sm:rounded-full'
          >
            {options.map((option, i) => {
              const checked = option === mode
              const slot = typeof option === 'number' ? slots.find((s) => s.slotIndex === option) : undefined
              // Empty in the last report: still selectable, but quieter
              const empty = Boolean(slot && reported && !slot.present)
              return (
                <button
                  key={String(option)}
                  ref={(el) => {
                    radioRefs.current[i] = el
                  }}
                  type='button'
                  role='radio'
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => choose(option, true)}
                  className={cn(
                    'inline-flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-full',
                    checked
                      ? 'bg-card text-foreground shadow-[0_0_0_1px_hsl(var(--border)),0_1px_2px_rgb(0_0_0/0.08)]'
                      : 'text-muted-foreground hover:text-foreground',
                    empty && !checked && 'opacity-60'
                  )}
                >
                  {option === 'default' ? 'Default' : option === 'id' ? 'ID' : simName(option)}
                  {/* The space keeps "SIM 1 Example Mobile" apart for screen readers */}
                  {slot?.carrier && ' '}
                  {slot?.carrier && (
                    <span className='max-w-[7rem] truncate text-xs font-normal text-muted-foreground'>
                      {slot.carrier}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <Popover open={infoOpen} onOpenChange={setInfoOpen}>
            <PopoverTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='h-8 w-8 shrink-0 text-muted-foreground'
                aria-label='SIM details'
              >
                <Info className='h-4 w-4' />
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-72 p-3 text-xs' aria-label='SIM details'>
              <div className='divide-y'>
                {slots.map((slot) => (
                  <SlotDetails key={slot.slotIndex} slot={slot} reported={reported} />
                ))}
              </div>
              <div className='mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2'>
                <p className='text-muted-foreground'>
                  {!reported
                    ? 'The phone has not reported its SIMs.'
                    : age
                      ? `Reported by the phone ${age}.`
                      : 'Reported by the phone.'}
                </p>
                {device && (
                  <Button
                    type='button'
                    variant='link'
                    size='sm'
                    className='h-auto px-0 text-xs'
                    onClick={() => {
                      setInfoOpen(false)
                      setEditOpen(true)
                    }}
                  >
                    Edit SIM numbers
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div id={`${id}-help`} className='text-xs'>
          {mode === 'default' && (
            <p className='text-muted-foreground'>
              Uses the SIM set as default in the textbee app or on the phone.
            </p>
          )}
          {typeof mode === 'number' &&
            (!reported ? (
              <p className='text-muted-foreground'>
                This phone has not reported its SIMs. Update the textbee app on the
                phone to choose a SIM.
              </p>
            ) : chosen?.present ? (
              <p className='text-muted-foreground'>
                {[`Sends from ${simName(mode)}`, chosen.carrier, chosen.phoneNumber]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            ) : (
              <p className='flex gap-1.5 text-warning'>
                <AlertTriangle className='mt-0.5 h-3.5 w-3.5 shrink-0' aria-hidden />
                <span>
                  {simName(mode)} was empty in the phone&apos;s last report
                  {age ? ` (${age})` : ''}. If it is still empty, the message fails.
                  It is never sent from another SIM.
                </span>
              </p>
            ))}
        </div>

        {mode === 'id' && (
          <div id={`${id}-editor`} className='space-y-2 border-l pl-3'>
            <div id={`${id}-note`} className='space-y-0.5 text-xs'>
              <p className='font-medium text-foreground'>Older option: subscription ID</p>
              <p className='text-muted-foreground'>
                Subscription IDs can change after a SIM swap. A changed ID sends from
                the default SIM. Prefer SIM 1 or SIM 2.
              </p>
            </div>
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
                onChange={(e) => setTyped(e.target.value)}
                aria-invalid={!!shownError || undefined}
                aria-describedby={shownError ? `${id}-note ${id}-error` : `${id}-note`}
              />
              {sims.map((sim) => (
                <SimSuggestion
                  key={sim.subscriptionId}
                  sim={sim}
                  selected={matched?.subscriptionId === sim.subscriptionId}
                  onPick={() => setTyped(String(sim.subscriptionId))}
                />
              ))}
            </div>

            {shownError && (
              <p id={`${id}-error`} role='alert' className='text-sm text-destructive'>
                {shownError}
              </p>
            )}

            {typed && !matched && sims.length > 0 && (
              <p className='text-xs text-warning'>
                No SIM with subscription ID {subscriptionId} in the phone&apos;s last
                report. If the phone has no SIM with this ID, it sends from the SIM
                set as default in the textbee app, or the phone&apos;s default SIM.
              </p>
            )}
          </div>
        )}

        {device && (
          <SimNumbersDialog device={device} open={editOpen} onOpenChange={setEditOpen} />
        )}
      </div>
    )
  }
)

function SlotDetails({ slot, reported }: { slot: SimSlot; reported: boolean }) {
  const muted = (value: string) => <span className='text-muted-foreground'>{value}</span>
  return (
    <div className='py-2 first:pt-0'>
      <p className='text-sm font-medium text-foreground'>{simName(slot.slotIndex)}</p>
      <dl className='mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5'>
        <dt className='text-muted-foreground'>Carrier</dt>
        <dd className='min-w-0 truncate'>
          {slot.carrier ??
            muted(reported && !slot.present ? 'Empty in last report' : 'Not reported')}
        </dd>
        <dt className='text-muted-foreground'>Number</dt>
        <dd className='min-w-0 truncate'>{slot.phoneNumber ?? muted('Not set')}</dd>
        <dt className='text-muted-foreground'>Subscription ID</dt>
        <dd className='min-w-0'>
          {slot.subscriptionId !== undefined ? (
            <>
              <span className='font-mono'>{slot.subscriptionId}</span>{' '}
              {muted('older option')}
            </>
          ) : (
            muted('Not reported')
          )}
        </dd>
      </dl>
    </div>
  )
}

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
