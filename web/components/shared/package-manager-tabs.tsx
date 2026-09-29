'use client'

// Install command with a package manager picker.
//
// Kept in sync by hand with the copy in the textbee marketing site. The two live
// in separate repos, so a shared package would be more machinery than one small
// widget is worth. This copy uses theme tokens because the dashboard renders in
// light and dark, while the marketing snippet block is always dark.

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const MANAGERS = [
  { id: 'pnpm', label: 'pnpm', install: 'pnpm add' },
  { id: 'npm', label: 'npm', install: 'npm install' },
  { id: 'yarn', label: 'yarn', install: 'yarn add' },
  { id: 'bun', label: 'bun', install: 'bun add' },
] as const

type ManagerId = (typeof MANAGERS)[number]['id']

const DEFAULT_MANAGER: ManagerId = 'pnpm'
const STORAGE_KEY = 'textbee:package-manager'

function isManagerId(value: string | null): value is ManagerId {
  return MANAGERS.some((manager) => manager.id === value)
}

interface PackageManagerTabsProps {
  /** Package to install, for example "@textbee/sdk". */
  pkg: string
  className?: string
}

export default function PackageManagerTabs({
  pkg,
  className,
}: PackageManagerTabsProps) {
  const [manager, setManager] = useState<ManagerId>(DEFAULT_MANAGER)
  const [copied, setCopied] = useState(false)

  // Read after mount rather than during render: reading localStorage while
  // rendering would make the server and client markup disagree.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isManagerId(stored)) {
      setManager(stored)
    }
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const command = `${MANAGERS.find((m) => m.id === manager)!.install} ${pkg}`

  function selectManager(value: string) {
    if (!isManagerId(value)) return
    setManager(value)
    // Remembered so the choice carries across the dashboard.
    window.localStorage.setItem(STORAGE_KEY, value)
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
    } catch {
      // Clipboard is blocked in some browsers and insecure contexts. The
      // command is on screen either way, so there is nothing to recover.
    }
  }

  return (
    // Each trigger needs its own panel: Radix points aria-controls at one, and
    // a trigger without a matching TabsContent is an invalid ARIA reference.
    <Tabs
      value={manager}
      onValueChange={selectManager}
      className={cn('overflow-hidden rounded-lg border border-border', className)}
    >
      <div className='flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-2 py-1.5'>
        <TabsList aria-label='Package manager' className='h-auto border-0 bg-transparent p-0'>
          {MANAGERS.map((m) => (
            <TabsTrigger key={m.id} value={m.id} className='px-2.5 py-1 text-xs'>
              {m.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <Button
          type='button'
          variant='ghost'
          size='icon'
          onClick={copyCommand}
          aria-label='Copy install command'
          className='h-7 w-7'
        >
          {copied ? (
            <Check className='h-3.5 w-3.5 text-success' />
          ) : (
            <Copy className='h-3.5 w-3.5' />
          )}
        </Button>
      </div>

      {MANAGERS.map((m) => (
        <TabsContent key={m.id} value={m.id} className='mt-0'>
          <pre className='overflow-x-auto bg-muted/20 px-3 py-2.5 text-sm'>
            <code className='font-mono text-foreground'>{`${m.install} ${pkg}`}</code>
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  )
}
