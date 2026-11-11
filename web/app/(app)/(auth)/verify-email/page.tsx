'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, CheckCircle, XCircle, Mail, ArrowRight } from 'lucide-react'
import {
  useCurrentUser,
  useSendEmailVerification,
  useVerifyEmail,
} from '@/lib/api'
import { Routes } from '@/config/routes'
import { apiErrorText } from '@/lib/utils/errorHandler'
import EmailAddressSection from './email-address-section'

// Reusable components
const ErrorAlert = ({ message }: { message: string }) => (
  <Alert
    variant='destructive'
    className='bg-destructive/10 text-destructive border-destructive/30'
  >
    <XCircle className='h-5 w-5 text-destructive' />
    <AlertTitle className='text-lg font-semibold'>Error</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
  </Alert>
)

const SuccessAlert = ({ title, message }: { title: string; message: string }) => (
  <Alert className='bg-success/10 text-success border-success/30 [&>svg]:text-success'>
    <CheckCircle className='h-5 w-5 text-success' />
    <AlertTitle className='text-lg font-semibold'>{title}</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
  </Alert>
)

const InfoAlert = ({ title, message }: { title: string; message: string }) => (
  <Alert className='border-primary/25 bg-primary/[0.06] text-foreground [&>svg]:text-primary'>
    <Mail className='h-5 w-5 text-primary' />
    <AlertTitle className='text-lg font-semibold'>{title}</AlertTitle>
    <AlertDescription>{message}</AlertDescription>
  </Alert>
)

const LoadingSpinner = () => (
  <div className='flex justify-center py-6'>
    <Loader2 className='h-10 w-10 animate-spin text-primary' />
  </div>
)

const DashboardButton = () => (
  <Button className='w-full py-5 mt-2' asChild>
    <Link href={Routes.dashboard}>
      Go to Dashboard
      <ArrowRight className='ml-2 h-5 w-5' />
    </Link>
  </Button>
)

const LoginButton = () => (
  <Button className='w-full py-5 mt-2' asChild>
    <Link href='/login'>
      Go to Login
      <ArrowRight className='ml-2 h-5 w-5' />
    </Link>
  </Button>
)

export default function VerifyEmailPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const userId = searchParams.get('userId')
  const verificationCode = searchParams.get('verificationCode')
  const verificationEmailSent = searchParams.get('verificationEmailSent')
  const changeRequested = searchParams.get('change') === '1'
  
  const [successMessage, setSuccessMessage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  // Without a session, who-am-i answers 401 and the client would send the visitor to logout.
  const { status: sessionStatus } = useSession()
  const hasSession = sessionStatus === 'authenticated'
  const {
    data: user,
    isPending: isUserPending,
    isError: isAuthError
  } = useCurrentUser({ enabled: hasSession })
  const isCheckingAuth =
    sessionStatus === 'loading' || (hasSession && isUserPending)

  const isEmailVerified = !!user?.emailVerifiedAt
  const isLoggedIn = !isAuthError && !!user
  const showAddress = isLoggedIn && !isEmailVerified && !!user?.email

  const { mutate: verifyEmailMutation, isPending: isVerifying } =
    useVerifyEmail()
  const { mutate: sendVerificationEmailMutation, isPending: isSending } =
    useSendEmailVerification()

  const verifyEmail = useCallback(() => {
    if (!userId || !verificationCode) return
    verifyEmailMutation(
      { userId, verificationCode },
      {
        onSuccess: () => {
          setSuccessMessage('Your email has been successfully verified')
          setErrorMessage('')
        },
        onError: (error) => {
          setErrorMessage(apiErrorText(error, 'Failed to verify email'))
        },
      }
    )
  }, [userId, verificationCode, verifyEmailMutation])

  const sendVerificationEmail = () =>
    sendVerificationEmailMutation(undefined, {
      onSuccess: () => {
        if (!verificationEmailSent) {
          router.push('/verify-email?verificationEmailSent=true')
        } else {
          setSuccessMessage('Verification email has been sent to your inbox')
          setErrorMessage('')
        }
      },
      onError: (error) => {
        setErrorMessage(
          apiErrorText(error, 'Failed to send verification email')
        )
      },
    })

  const handleEmailChanged = () => {
    setSuccessMessage('')
    setErrorMessage('')
    if (!verificationEmailSent || changeRequested) {
      router.replace('/verify-email?verificationEmailSent=true')
    }
  }

  // Handle verification when code is provided
  useEffect(() => {
    if (userId && verificationCode && !isVerifying && !successMessage && !errorMessage) {
      if (isEmailVerified) {
        setSuccessMessage('Your email has already been verified')
      } else if (!isCheckingAuth) {
        verifyEmail()
      }
    }
  }, [userId, verificationCode, isCheckingAuth, isEmailVerified, isVerifying, successMessage, errorMessage, verifyEmail])

  // Render content based on current state
  const renderContent = () => {
    // Show loading state
    if (isCheckingAuth) {
      return (
        <>
          <CardHeader>
            <CardTitle className='text-2xl font-semibold'>Email Verification</CardTitle>
            <CardDescription>Checking verification status...</CardDescription>
          </CardHeader>
          <CardContent>
            <LoadingSpinner />
          </CardContent>
        </>
      )
    }

    // Handle verification process
    if (userId && verificationCode) {
      return (
        <>
          <CardHeader>
            <CardTitle className='text-2xl font-semibold'>Email Verification</CardTitle>
            <CardDescription>
              {isVerifying ? 'Verifying your email address...' : 'Email Verification Status'}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {isVerifying ? (
              <LoadingSpinner />
            ) : successMessage ? (
              <SuccessAlert title="Success" message={successMessage} />
            ) : errorMessage ? (
              <ErrorAlert message={errorMessage} />
            ) : null}
          </CardContent>
          <CardFooter>
            {successMessage && <DashboardButton />}
          </CardFooter>
        </>
      )
    }

    // Handle "check your email" state
    if (verificationEmailSent) {
      return (
        <>
          <CardHeader>
            <CardTitle className='text-2xl font-semibold'>Check Your Email</CardTitle>
            {!showAddress && (
              <CardDescription>
                We've sent you a verification email. Please check your inbox and click
                the link to verify your account.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className='space-y-4'>
            {showAddress && (
              <EmailAddressSection
                email={user?.email ?? ''}
                startOpen={changeRequested}
                onChanged={handleEmailChanged}
              />
            )}
            {successMessage && (
              <InfoAlert title="Email Sent" message={successMessage} />
            )}
            {errorMessage && (
              <ErrorAlert message={errorMessage} />
            )}
            {isEmailVerified && (
              <SuccessAlert 
                title="Already Verified" 
                message="Your email has already been verified" 
              />
            )}
          </CardContent>
          <CardFooter className='flex flex-col gap-3'>
            {isEmailVerified ? (
              <DashboardButton />
            ) : (
              <div className='flex items-center gap-2 justify-center w-full'>
                <span className='text-sm text-muted-foreground'>
                  Didn't receive the email?
                </span>
                <Button
                  variant='link'
                  onClick={() => sendVerificationEmail()}
                  disabled={isSending}
                  className='text-sm p-0 h-auto font-semibold'
                >
                  {isSending ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Sending...
                    </>
                  ) : (
                    'Click to resend'
                  )}
                </Button>
              </div>
            )}
          </CardFooter>
        </>
      )
    }

    // Handle "send verification email" state
    return (
      <>
        <CardHeader>
          <CardTitle className='text-2xl font-semibold'>Email Verification</CardTitle>
          <CardDescription>
            {isLoggedIn 
              ? isEmailVerified
                ? 'Your email is already verified'
                : 'Verify your email address to access all features'
              : 'You need to be logged in to verify your email'
            }
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {showAddress && (
            <EmailAddressSection
              email={user?.email ?? ''}
              startOpen={changeRequested}
              onChanged={handleEmailChanged}
            />
          )}
          {successMessage && (
            <InfoAlert title="Email Sent" message={successMessage} />
          )}
          {errorMessage && (
            <ErrorAlert message={errorMessage} />
          )}
          {isEmailVerified && (
            <SuccessAlert 
              title="Already Verified" 
              message="Your email has already been verified" 
            />
          )}
          {!isLoggedIn && (
            <Alert
              variant='destructive'
              className='bg-destructive/10 text-destructive border-destructive/30'
            >
              <XCircle className='h-5 w-5 text-destructive' />
              <AlertTitle className='text-lg font-semibold'>Not Logged In</AlertTitle>
              <AlertDescription>
                You need to be logged in to verify your email
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          {isLoggedIn ? (
            isEmailVerified ? (
              <DashboardButton />
            ) : (
              <Button
                className='w-full py-5'
                onClick={() => sendVerificationEmail()}
                disabled={isSending}
              >
                {isSending ? (
                  <Loader2 className='mr-2 h-5 w-5 animate-spin' />
                ) : (
                  <Mail className='mr-2 h-5 w-5' />
                )}
                Send Verification Email
              </Button>
            )
          ) : (
            <LoginButton />
          )}
        </CardFooter>
      </>
    )
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-background p-4'>
      <Card className='w-full max-w-md'>
        {renderContent()}
      </Card>
    </div>
  )
}
