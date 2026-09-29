'use client'

import { X } from 'lucide-react'
import {
  DEFAULT_EXTRA_FILTERS,
  countExtraFilters,
  rangeLabel,
  statusLabel,
  type ExtraFilters,
} from './extra-filters'

type ActiveFiltersProps = {
  value: ExtraFilters
  onChange: (patch: Partial<ExtraFilters>) => void
}

// Every popover filter stays visible and removable without reopening it.
export default function ActiveFilters({ value, onChange }: ActiveFiltersProps) {
  const chips: { key: string; label: string; clear: Partial<ExtraFilters> }[] =
    []
  if (value.status) {
    chips.push({
      key: 'status',
      label: `Status: ${statusLabel(value.status)}`,
      clear: { status: '' },
    })
  }
  if (value.from || value.to) {
    chips.push({
      key: 'range',
      label: rangeLabel(value.from, value.to),
      clear: { from: '', to: '' },
    })
  }
  if (value.order === 'asc') {
    chips.push({
      key: 'order',
      label: 'Oldest first',
      clear: { order: 'desc' },
    })
  }
  if (value.batchId) {
    chips.push({
      key: 'batch',
      label: `Batch ${value.batchId.slice(-6)}`,
      clear: { batchId: '' },
    })
  }

  if (chips.length === 0) return null

  return (
    <ul
      className='flex flex-wrap items-center gap-1.5'
      aria-label='Applied filters'
    >
      {chips.map((chip) => (
        <li key={chip.key}>
          <button
            type='button'
            onClick={() => onChange(chip.clear)}
            className='inline-flex h-7 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 pl-2.5 pr-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            aria-label={`Remove filter: ${chip.label}`}
            title={chip.key === 'batch' ? value.batchId : undefined}
          >
            {chip.label}
            <X className='h-3 w-3' aria-hidden />
          </button>
        </li>
      ))}
      {countExtraFilters(value) > 1 && (
        <li>
          <button
            type='button'
            onClick={() => onChange(DEFAULT_EXTRA_FILTERS)}
            className='h-7 rounded-full px-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
          >
            Clear filters
          </button>
        </li>
      )}
    </ul>
  )
}
