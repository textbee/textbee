'use client'

import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

// Split out from the palette itself so the same open-state can be triggered
// from the sidebar (desktop) and the header (mobile). Previously the trigger
// and dialog were one component living inside the `hidden md:flex` sidebar,
// which meant mobile had no way to search at all.
export default function SearchTrigger({
  onOpen,
  variant = 'full',
  className,
}: {
  onOpen: () => void
  variant?: 'full' | 'icon'
  className?: string
}) {
  if (variant === 'icon') {
    return (
      <button
        type='button'
        onClick={onOpen}
        aria-label='Search'
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
          className
        )}
      >
        <Search className='h-5 w-5' />
      </button>
    )
  }

  return (
    <button
      type='button'
      onClick={onOpen}
      className={cn(
        'inline-flex w-full items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted',
        className
      )}
    >
      <Search className='h-4 w-4' />
      <span className='flex-1 text-left'>Search…</span>
      <kbd className='pointer-events-none hidden select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground sm:inline-flex'>
        ⌘K
      </kbd>
    </button>
  )
}
