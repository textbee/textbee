'use client'

import { useState } from 'react'
import { ListFilter } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  DEFAULT_EXTRA_FILTERS,
  countExtraFilters,
  isBatchId,
  isDay,
  statusesFor,
  type ExtraFilters,
  type Order,
} from './extra-filters'

type FiltersPopoverProps = {
  value: ExtraFilters
  direction: string
  onApply: (filters: ExtraFilters) => void
}

const ORDERS: { value: Order; label: string }[] = [
  { value: 'desc', label: 'Newest first' },
  { value: 'asc', label: 'Oldest first' },
]

const pillClass = (active: boolean) =>
  cn(
    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active
      ? 'border-primary bg-primary/10 text-primary'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  )

const today = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Edits a draft and applies it in one go, so a half-typed batch id or a
// half-picked range never fires a request.
export default function FiltersPopover({
  value,
  direction,
  onApply,
}: FiltersPopoverProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const count = countExtraFilters(value)

  const batchId = draft.batchId.trim()
  const batchError = batchId && !isBatchId(batchId)
  const dateError =
    (draft.from && !isDay(draft.from)) || (draft.to && !isDay(draft.to))
  const rangeError =
    !dateError && draft.from && draft.to && draft.from > draft.to
  const canApply = !batchError && !dateError && !rangeError

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(value)
    setOpen(next)
  }

  const apply = () => {
    if (!canApply) return
    onApply({ ...draft, batchId })
    setOpen(false)
  }

  const set = (patch: Partial<ExtraFilters>) =>
    setDraft((current) => ({ ...current, ...patch }))

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          size='icon'
          className={cn(
            'relative h-9 w-9 shrink-0',
            count > 0 && 'text-primary'
          )}
          aria-label={count > 0 ? `Filters, ${count} applied` : 'Filters'}
        >
          <ListFilter className='h-4 w-4' />
          {count > 0 && (
            <span
              className='absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground'
              aria-hidden
            >
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-labelledby='history-filters-title'
        align='end'
        className='max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-0'
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <div className='flex items-center justify-between border-b px-4 py-3'>
            <h2 id='history-filters-title' className='text-sm font-semibold'>
              Filters
            </h2>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-7 px-2 text-xs'
              disabled={countExtraFilters(draft) === 0}
              onClick={() => setDraft(DEFAULT_EXTRA_FILTERS)}
            >
              Reset
            </Button>
          </div>

          <div className='space-y-4 p-4'>
            <fieldset className='space-y-2'>
              <legend className='mb-2 text-xs font-medium text-muted-foreground'>
                Status
              </legend>
              <div className='flex flex-wrap gap-1.5'>
                <button
                  type='button'
                  aria-pressed={!draft.status}
                  className={pillClass(!draft.status)}
                  onClick={() => set({ status: '' })}
                >
                  Any
                </button>
                {statusesFor(direction).map((status) => (
                  <button
                    key={status.value}
                    type='button'
                    aria-pressed={draft.status === status.value}
                    className={pillClass(draft.status === status.value)}
                    onClick={() => set({ status: status.value })}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className='space-y-2'>
              <legend className='mb-2 text-xs font-medium text-muted-foreground'>
                Date
              </legend>
              <div className='grid grid-cols-2 gap-2'>
                <div className='space-y-1'>
                  <Label htmlFor='history-from' className='text-xs font-normal'>
                    From
                  </Label>
                  <Input
                    id='history-from'
                    type='date'
                    value={draft.from}
                    max={draft.to || today()}
                    onChange={(event) => set({ from: event.target.value })}
                    className='h-9 text-sm'
                  />
                </div>
                <div className='space-y-1'>
                  <Label htmlFor='history-to' className='text-xs font-normal'>
                    To
                  </Label>
                  <Input
                    id='history-to'
                    type='date'
                    value={draft.to}
                    min={draft.from || undefined}
                    max={today()}
                    onChange={(event) => set({ to: event.target.value })}
                    className='h-9 text-sm'
                  />
                </div>
              </div>
              {dateError && (
                <p className='text-xs text-destructive' role='alert'>
                  Enter a date between 1970 and 9999.
                </p>
              )}
              {rangeError && (
                <p className='text-xs text-destructive' role='alert'>
                  The start date is after the end date.
                </p>
              )}
            </fieldset>

            <fieldset className='space-y-2'>
              <legend className='mb-2 text-xs font-medium text-muted-foreground'>
                Sort
              </legend>
              <div className='flex flex-wrap gap-1.5'>
                {ORDERS.map((order) => (
                  <button
                    key={order.value}
                    type='button'
                    aria-pressed={draft.order === order.value}
                    className={pillClass(draft.order === order.value)}
                    onClick={() => set({ order: order.value })}
                  >
                    {order.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className='space-y-1'>
              <Label
                htmlFor='history-batch'
                className='text-xs font-medium text-muted-foreground'
              >
                Batch ID
              </Label>
              <Input
                id='history-batch'
                value={draft.batchId}
                onChange={(event) => set({ batchId: event.target.value })}
                placeholder='smsBatchId from a send'
                autoComplete='off'
                spellCheck={false}
                aria-invalid={Boolean(batchError)}
                aria-describedby='history-batch-hint'
                className='h-9 font-mono text-xs'
              />
              <p
                id='history-batch-hint'
                className={cn(
                  'text-xs',
                  batchError ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {batchError
                  ? 'A batch ID has 24 characters: digits 0-9 and letters a-f.'
                  : 'Shows only the messages of one send.'}
              </p>
            </div>
          </div>

          <div className='flex justify-end gap-2 border-t px-4 py-3'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type='submit' size='sm' disabled={!canApply}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
