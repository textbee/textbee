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
  'text-xs text-muted-foreground transition-colors hover:text-foreground'

// A page of its own: no dashboard menu, no support widget, no upgrade links.
// Signed in, the logo and a plain link lead back to the dashboard; signed
// out, the logo leads to the login page. Plain links: the next page loads as
// a fresh document.
export default async function LinkLayout({ children }: PropsWithChildren) {
  const session: Session | null = await getServerSession(authOptions as any)
  const signedIn = !!session?.user

  return (
    <Providers session={session}>
      <div className='flex min-h-svh flex-col bg-background'>
        <header className='flex h-14 items-center justify-between gap-4 px-4 sm:h-auto sm:px-8 sm:py-5'>
          <a
            href={signedIn ? Routes.dashboard : Routes.login}
            className='flex items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
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
          </a>
          {signedIn && (
            <a
              href={Routes.dashboard}
              className='rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            >
              Back to dashboard
            </a>
          )}
        </header>
        <main className='flex flex-1 flex-col items-center px-4 pb-10 pt-3 sm:justify-center sm:pt-4'>
          {children}
        </main>
        <footer className='border-t border-border'>
          <nav
            aria-label='Footer'
            className='mx-auto flex max-w-md items-center justify-center gap-5 px-4 py-4'
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
