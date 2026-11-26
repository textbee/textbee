import { PropsWithChildren } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { getServerSession, Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Routes } from '@/config/routes'
import { Toaster } from '@/components/ui/toaster'
import Providers from '../(app)/providers'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const footerLinkClass =
  'text-sm text-muted-foreground transition-colors hover:text-foreground'

// A page of its own: no dashboard menu, no support widget, no upgrade links.
export default async function LinkLayout({ children }: PropsWithChildren) {
  const session: Session | null = await getServerSession(authOptions as any)

  return (
    <Providers session={session}>
      <div className='flex min-h-svh flex-col bg-background'>
        <header className='flex h-14 items-center px-4 sm:h-auto sm:px-8 sm:py-5'>
          <div className='flex items-center gap-2'>
            <Image
              src='/images/logo.png'
              alt=''
              width={28}
              height={28}
              className='h-7 w-7 rounded-full bg-white'
            />
            <span className='font-semibold tracking-tight'>
              text<span className='text-primary'>bee</span>
              <span className='text-xs font-normal text-muted-foreground'>
                .dev
              </span>
            </span>
          </div>
        </header>
        <main className='flex flex-1 flex-col items-center px-4 pb-10 pt-3 sm:pt-8'>
          {children}
        </main>
        <footer className='border-t border-border'>
          <nav
            aria-label='Footer'
            className='mx-auto flex max-w-md items-center justify-center gap-5 px-4 py-5'
          >
            <a
              href={Routes.privacyPolicy}
              target='_blank'
              rel='noopener noreferrer'
              className={footerLinkClass}
            >
              Privacy
            </a>
            <a
              href={Routes.termsOfService}
              target='_blank'
              rel='noopener noreferrer'
              className={footerLinkClass}
            >
              Terms
            </a>
          </nav>
        </footer>
      </div>
      <Toaster />
    </Providers>
  )
}
