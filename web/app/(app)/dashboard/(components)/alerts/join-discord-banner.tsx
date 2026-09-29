'use client'

import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { MessageSquare, X } from 'lucide-react'
import {
  DISCORD_STORAGE_KEYS,
  dismissDiscordBanner,
  openDiscordInvite,
  safeGetDiscordFlag,
} from '@/lib/discord-community'

export default function JoinDiscordBanner() {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const dismissed =
      safeGetDiscordFlag(DISCORD_STORAGE_KEYS.BANNER_DISMISSED) === '1'
    const joined =
      safeGetDiscordFlag(DISCORD_STORAGE_KEYS.HAS_JOINED) === 'true'
    setIsVisible(!dismissed && !joined)
  }, [])

  const hide = () => {
    dismissDiscordBanner()
    setIsVisible(false)
  }

  if (!isVisible) return null

  return (
    <Alert className='bg-card text-foreground'>
      <AlertDescription className='flex flex-col items-center gap-2 sm:flex-row md:gap-4'>
        <span className='w-full text-center text-sm font-medium sm:flex-1 sm:text-left md:text-base'>
          Questions or feedback? Get quick answers from the textbee community on
          Discord.
        </span>
        <div className='mt-2 flex w-full items-center justify-center gap-2 sm:mt-0 sm:w-auto sm:justify-end'>
          <Button
            variant='outline'
            size='sm'
            className='text-xs md:text-sm'
            onClick={() => {
              openDiscordInvite()
              hide()
            }}
          >
            <MessageSquare className='mr-2 h-4 w-4' />
            Join Discord
          </Button>
          <button
            type='button'
            aria-label='Dismiss Discord invitation'
            onClick={hide}
            className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60'
          >
            <X className='h-4 w-4' />
          </button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
