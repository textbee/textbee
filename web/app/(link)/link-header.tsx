'use client'

import Image from 'next/image'
import { Routes } from '@/config/routes'
import { useIsFramed } from '@/lib/device-link'

// The top bar of the link page. Its links show only once the browser has
// checked that the page is not inside another site's frame.
export default function LinkHeader({ signedIn }: { signedIn: boolean }) {
  const framed = useIsFramed()
  const links = framed === false

  const logo = (
    <>
      <Image
        src='/images/logo.png'
        alt=''
        width={28}
        height={28}
        className='h-7 w-7 rounded-full bg-white'
      />
      <span className='font-semibold tracking-tight'>
        text<span className='text-primary'>bee</span>
        <span className='text-xs font-normal text-muted-foreground'>.dev</span>
      </span>
    </>
  )

  return (
    <header className='flex h-14 items-center justify-between gap-4 px-4 sm:h-auto sm:px-8 sm:py-5'>
      {links ? (
        <a
          href={signedIn ? Routes.dashboard : Routes.login}
          className='flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          {logo}
        </a>
      ) : (
        <div className='flex items-center gap-2'>{logo}</div>
      )}
      {links && signedIn && (
        <a
          href={Routes.dashboard}
          className='rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          Back to dashboard
        </a>
      )}
    </header>
  )
}
