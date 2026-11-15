'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Download, MailCheck, Send } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { Routes } from '@/config/routes'
import GenerateApiKey from '../api-keys/generate-api-key'
import PlanPicker from './plan-picker'
import InlineRegisterPanel from './inline-register-panel'

const RESEND_COOLDOWN_SECONDS = 60

// Inline "we sent a link to x@y.com" + resend with cooldown, so users don't
// have to leave the checklist to nudge the verification email.
function VerifyEmailActions({ email }: { email?: string }) {
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown])

  const { mutate: resend, isPending } = useMutation({
    mutationFn: () =>
      httpBrowserClient.post(ApiEndpoints.auth.sendEmailVerificationEmail()),
    onSuccess: () => {
      setCooldown(RESEND_COOLDOWN_SECONDS)
      toast({ title: 'Verification email sent', description: email })
    },
    onError: () => {
      toast({
        variant: 'destructive',
        title: 'Could not send the email',
        description: 'Please try again in a moment.',
      })
    },
  })

  return (
    <div className='w-full space-y-2'>
      {email && (
        <p className='text-xs text-muted-foreground'>
          We sent a verification link to{' '}
          <span className='font-medium text-foreground'>{email}</span>. Check
          your inbox (and spam).{' '}
          <Link
            href={`${Routes.verifyEmail}?change=1`}
            className='font-medium text-foreground underline-offset-4 hover:underline'
          >
            Wrong address? Change it
          </Link>
        </p>
      )}
      <div className='flex flex-wrap items-center gap-2'>
        <Button size='sm' asChild>
          <Link href={Routes.verifyEmail}>
            <MailCheck className='h-4 w-4' />
            Open verification page
          </Link>
        </Button>
        <Button
          variant='outline'
          size='sm'
          disabled={isPending || cooldown > 0}
          onClick={() => resend()}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'}
        </Button>
      </div>
    </div>
  )
}

type StepActionsProps = {
  stepId: string
  // A completed step can still be reopened. Its actions stay available (you
  // may want a second device or a replacement key), but anything that only
  // makes sense for an unfinished step, like Skip, is dropped.
  isDone?: boolean
  isSaving: boolean
  subLoading: boolean
  userEmail?: string
  onSkipStep: (stepId: string) => void
}

// Call-to-action block for the currently selected onboarding step.
export default function StepActions({
  stepId,
  isDone = false,
  isSaving,
  subLoading,
  userEmail,
  onSkipStep,
}: StepActionsProps) {
  switch (stepId) {
    case 'verify_email':
      return <VerifyEmailActions email={userEmail} />
    case 'download_app':
      return (
        <>
          <Button
            variant='outline'
            size='sm'
            onClick={() => window.open(Routes.downloadAndroidApp, '_blank', 'noopener,noreferrer')}
          >
            <Download className='h-4 w-4' />
            Download APK
          </Button>
          {!isDone && (
            <Button
              variant='link'
              size='sm'
              className='h-auto px-2 text-muted-foreground'
              disabled={isSaving}
              onClick={() => onSkipStep('download_app')}
            >
              Skip →
            </Button>
          )}
        </>
      )
    case 'api_key':
      return (
        <GenerateApiKey
          triggerLabel={isDone ? 'Generate another API key' : 'Generate API Key'}
          triggerVariant={isDone ? 'outline' : 'default'}
        />
      )
    case 'register_device':
      return <InlineRegisterPanel />
    case 'choose_plan':
      return (
        <PlanPicker
          isLoading={subLoading}
          isSaving={isSaving}
          isDone={isDone}
          onSkip={() => onSkipStep('choose_plan')}
        />
      )
    case 'first_message':
      return (
        <Button size='sm' asChild>
          <Link href='/dashboard/messaging'>
            <Send className='h-4 w-4' />
            Go to messaging
          </Link>
        </Button>
      )
    default:
      return null
  }
}
