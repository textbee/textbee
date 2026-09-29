import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiEndpoints } from '@/config/api'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/api/query-keys'
import Link from 'next/link'
import { useMemo } from 'react'
import { Mail, ShieldAlert } from 'lucide-react'

export default function VerifyEmailAlert() {
  const {
    data: userData,
    isLoading: isLoadingUserData,
    error: userDataError,
  } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.auth.whoAmI())
        .then((res) => res.data.data),
  })

  const ctaMessages = useMemo(
    () => [
      'Hey there! Verify your email to keep your service running smoothly.',
      'Quick heads up - we need to verify your email to prevent any interruptions.',
      'Just a friendly reminder to verify your email and avoid service disruptions.',
      'Your account needs email verification to ensure uninterrupted service.',
      'One small step to go - verify your email to keep your account active and running.',
    ],
    []
  )

  const buttonTexts = useMemo(
    () => [
      'Verify Email',
      "Let's Do This",
      'Verify Now',
      'Complete Verification',
    ],
    []
  )

  const randomCta = useMemo(() => {
    const randomIndex = Math.floor(Math.random() * ctaMessages.length)
    return ctaMessages[randomIndex]
  }, [ctaMessages])

  const randomButtonText = useMemo(() => {
    const randomIndex = Math.floor(Math.random() * buttonTexts.length)
    return buttonTexts[randomIndex]
  }, [buttonTexts])

  if (isLoadingUserData || !userData || userDataError) {
    return null
  }

  // If email is already verified, don't show the alert
  if (userData.emailVerifiedAt) {
    return null
  }

  return (
    <Alert className='border-destructive/30 bg-destructive/[0.07] text-foreground'>
      <AlertDescription className='flex flex-col sm:flex-row flex-wrap items-center gap-2 md:gap-4'>
        <span className='w-full sm:flex-1 text-center sm:text-left text-sm md:text-base font-medium flex items-center justify-center sm:justify-start gap-2'>
          <ShieldAlert className='h-5 w-5 text-destructive' />
          {randomCta}
        </span>
        <div className='w-full sm:w-auto mt-2 sm:mt-0 flex justify-center sm:justify-end flex-wrap gap-1 md:gap-2'>
          <Button
            variant='outline'
            size='sm'
            asChild
            className='border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground text-xs md:text-sm'
          >
            <Link href={'/verify-email'}>
              <Mail className='mr-2 h-4 w-4' />
              {randomButtonText}
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
