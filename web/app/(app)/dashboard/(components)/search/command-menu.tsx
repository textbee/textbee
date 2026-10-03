'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useTheme } from 'next-themes'
import { ArrowUpRight, Laptop, LogOut, Moon, Sun } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Routes } from '@/config/routes'
import { searchEntries, searchGroupOrder } from './search-registry'
import { OPEN_SEARCH_EVENT } from '@/lib/constants'

// Cmd/Ctrl+K palette. Open state is owned by the dashboard layout so the same
// dialog can be opened from the sidebar trigger (desktop) or the header
// trigger (mobile), which dispatches OPEN_SEARCH_EVENT.
export default function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const { setTheme } = useTheme()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    const onOpenEvent = () => onOpenChange(true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener(OPEN_SEARCH_EVENT, onOpenEvent)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpenEvent)
    }
  }, [open, onOpenChange])

  const go = (href: string, external?: boolean) => {
    onOpenChange(false)
    if (external) {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder='Search pages, settings and actions…' />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {searchGroupOrder.map((group) => {
          const entries = searchEntries.filter((e) => e.group === group)
          if (entries.length === 0) return null

          return (
            <CommandGroup key={group} heading={group}>
              {entries.map((entry) => (
                <CommandItem
                  key={entry.href}
                  value={entry.label}
                  keywords={entry.keywords}
                  onSelect={() => go(entry.href, entry.external)}
                >
                  <entry.icon className='mr-2 h-4 w-4 shrink-0' />
                  <span>{entry.label}</span>
                  {entry.description && (
                    <span className='ml-2 truncate text-xs text-muted-foreground'>
                      {entry.description}
                    </span>
                  )}
                  {entry.external && (
                    <ArrowUpRight className='ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}

        <CommandSeparator />

        <CommandGroup heading='Actions'>
          {/* The theme control lives in the desktop sidebar, so the palette is
              how mobile users reach it. */}
          <CommandItem
            value='Light theme'
            keywords={['theme', 'light', 'appearance', 'bright']}
            onSelect={() => {
              onOpenChange(false)
              setTheme('light')
            }}
          >
            <Sun className='mr-2 h-4 w-4' />
            Light theme
          </CommandItem>
          <CommandItem
            value='Dark theme'
            keywords={['theme', 'dark', 'appearance', 'night']}
            onSelect={() => {
              onOpenChange(false)
              setTheme('dark')
            }}
          >
            <Moon className='mr-2 h-4 w-4' />
            Dark theme
          </CommandItem>
          <CommandItem
            value='System theme'
            keywords={['theme', 'system', 'auto', 'appearance']}
            onSelect={() => {
              onOpenChange(false)
              setTheme('system')
            }}
          >
            <Laptop className='mr-2 h-4 w-4' />
            System theme
          </CommandItem>
          <CommandItem
            value='Log out'
            keywords={['logout', 'sign out', 'exit', 'leave']}
            onSelect={() => {
              onOpenChange(false)
              signOut({ callbackUrl: Routes.login })
            }}
          >
            <LogOut className='mr-2 h-4 w-4' />
            Log out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
