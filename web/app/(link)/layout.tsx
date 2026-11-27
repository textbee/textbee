import { PropsWithChildren } from 'react'
import type { Metadata } from 'next'
import { getServerSession, Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { Routes } from '@/config/routes'
import { Toaster } from '@/components/ui/toaster'
import Providers from '../(app)/providers'
import LinkHeader from './link-header'

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

const footerLinkClass =
  'text-xs text-muted-foreground transition-colors hover:text-foreground'

// A page of its own: no dashboard menu, no support widget, no upgrade links.
// Signed in, the logo and a plain link lead back to the dashboard; signed
// out, the logo leads to the login page. Plain links: the next page loads as
// a fresh document. Inside another site's frame the header has no links.
export default async function LinkLayout({ children }: PropsWithChildren) {
  const session: Session | null = await getServerSession(authOptions as any)
  const signedIn = !!session?.user

  return (
    <Providers session={session}>
      <div className='flex min-h-svh flex-col bg-background'>
        <LinkHeader signedIn={signedIn} />
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
