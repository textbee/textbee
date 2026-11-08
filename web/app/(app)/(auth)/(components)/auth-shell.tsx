import Image from 'next/image'
import Link, { type LinkProps } from 'next/link'

import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Routes } from '@/config/routes'
import { cn } from '@/lib/utils'

import LoginWithGoogle from './login-with-google'

type AuthShellProps = {
  title: string
  description: string
  switchPrompt: string
  switchLabel: string
  switchHref: LinkProps['href']
  showLastUsed?: boolean
  className?: string
  children: React.ReactNode
}

const legalLinkClass =
  'text-foreground underline underline-offset-2 hover:text-primary'

// Login and register frame; the app header is hidden on these routes.
export default function AuthShell({
  title,
  description,
  switchPrompt,
  switchLabel,
  switchHref,
  showLastUsed,
  className,
  children,
}: AuthShellProps) {
  const googleEnabled = Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)

  const switchLink = (
    <Link
      href={switchHref}
      className='font-medium text-primary underline-offset-4 hover:underline'
    >
      {switchLabel}
    </Link>
  )

  return (
    <div className='flex min-h-svh flex-col bg-background sm:bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] sm:[background-size:22px_22px]'>
      <header className='flex h-14 items-center justify-between gap-4 px-4 sm:h-auto sm:px-8 sm:py-5'>
        <Link href={Routes.landingPage} className='flex items-center gap-2'>
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
        </Link>
        <p className='hidden text-sm text-muted-foreground sm:block'>
          {switchPrompt} {switchLink}
        </p>
      </header>

      <div className='flex flex-1 flex-col items-center px-4 pb-10 pt-3 sm:justify-center sm:pt-4'>
        <Card
          className={cn(
            'w-full max-w-[420px] rounded-2xl shadow-[0_16px_40px_-20px_rgb(28_27_26/0.18)]',
            className
          )}
        >
          <CardContent className='flex flex-col gap-5 rounded-xl px-5 py-6 sm:px-7 sm:py-8'>
            <div className='space-y-1.5'>
              <h1 className='text-[26px] font-semibold leading-8 tracking-tight sm:text-2xl'>
                {title}
              </h1>
              <p className='text-[15px] leading-[22px] text-muted-foreground sm:text-sm'>
                {description}
              </p>
            </div>

            {googleEnabled && (
              <>
                <LoginWithGoogle showLastUsed={showLastUsed} />
                <div className='flex items-center gap-3'>
                  <span className='h-px flex-1 bg-border' />
                  <span className='font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground'>
                    or
                  </span>
                  <span className='h-px flex-1 bg-border' />
                </div>
              </>
            )}

            {children}
          </CardContent>
          <CardFooter className='justify-center px-4 pb-2.5 pt-3'>
            <p className='text-center text-[13px] leading-[19px] text-muted-foreground sm:text-xs sm:leading-[18px]'>
              By continuing, you agree to our{' '}
              <a
                href={Routes.termsOfService}
                target='_blank'
                rel='noopener noreferrer'
                className={legalLinkClass}
              >
                Terms of Service
                <span className='sr-only'> (opens in new tab)</span>
              </a>{' '}
              and acknowledge our{' '}
              <a
                href={Routes.privacyPolicy}
                target='_blank'
                rel='noopener noreferrer'
                className={legalLinkClass}
              >
                Privacy Policy
                <span className='sr-only'> (opens in new tab)</span>
              </a>
              .
            </p>
          </CardFooter>
        </Card>

        <p className='mt-5 flex min-h-11 items-center gap-1.5 text-[15px] text-muted-foreground sm:hidden'>
          {switchPrompt} {switchLink}
        </p>
      </div>
    </div>
  )
}
