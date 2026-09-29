'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  PartyPopper,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ExternalLinks } from '@/config/external-links'
import { markDiscordJoined } from '@/lib/discord-community'
import GetStartedCardSkeleton from './skeleton'
import StepActions from './step-actions'
import { useOnboarding } from './use-onboarding'

const MINIMIZED_KEY = 'textbee.onboarding.minimized'

function encouragement(percent: number): string {
  if (percent >= 100) return 'All steps complete!'
  if (percent <= 33) return "You're about 3 minutes away from your first SMS"
  if (percent <= 83) return 'Great progress, keep going'
  return 'Almost there, one more step'
}

// Onboarding checklist card: the activation funnel. Fail-closed states, a
// progress bar with momentum copy, one focused active step, self-serve device
// registration, a completion celebration and a minimize-to-pill escape hatch.
export default function GetStartedCard() {
  const [minimized, setMinimized] = useState(false)
  const {
    status,
    userData,
    subLoading,
    stepStates,
    doneCount,
    totalSteps,
    progressPercent,
    activeStepId,
    canNavigateToStep,
    selectStep,
    updateOnboarding,
    savingOnboarding,
    retry,
    dismissCelebration,
  } = useOnboarding()

  // localStorage is read after mount to stay SSR-safe.
  useEffect(() => {
    setMinimized(window.localStorage.getItem(MINIMIZED_KEY) === '1')
  }, [])

  const setMinimizedPersisted = (value: boolean) => {
    setMinimized(value)
    window.localStorage.setItem(MINIMIZED_KEY, value ? '1' : '0')
  }

  if (status === 'hidden') return null

  if (status === 'loading') return <GetStartedCardSkeleton />

  if (status === 'error') {
    // Never render a checklist from missing data (it would show a verified
    // user stuck on "Verify your email"); quiet retry row instead.
    return (
      <Card className='border-border'>
        <CardContent className='flex flex-wrap items-center justify-between gap-3 py-4'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <AlertCircle className='h-4 w-4 shrink-0' />
            Couldn't load your setup status.
          </div>
          <Button variant='outline' size='sm' onClick={retry}>
            <RefreshCw className='h-3.5 w-3.5' />
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (status === 'celebrate') {
    return (
      <Card className='border-primary/25 animate-fade-in-up'>
        <CardContent className='flex flex-col items-center gap-3 py-8 text-center'>
          <div className='rounded-full bg-primary/15 p-3 animate-check-pop'>
            <PartyPopper className='h-7 w-7 text-primary' />
          </div>
          <div>
            <h3 className='text-lg font-semibold'>You're all set!</h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              Your SMS gateway is up and running.
            </p>
            <p className='mt-1 text-sm text-muted-foreground'>
              Join our Discord to share what you're building and get help fast.
            </p>
          </div>
          <div className='flex flex-wrap items-center justify-center gap-2'>
            <Button size='sm' asChild>
              <Link href='/dashboard/messaging'>
                <Send className='h-4 w-4' />
                Send a message
              </Link>
            </Button>
            <Button variant='outline' size='sm' asChild>
              <Link
                href={ExternalLinks.discord}
                prefetch={false}
                target='_blank'
                rel='noopener noreferrer'
                onClick={markDiscordJoined}
              >
                <MessageSquare className='h-4 w-4' />
                Join the community
              </Link>
            </Button>
            <Button variant='ghost' size='sm' onClick={dismissCelebration}>
              Dismiss
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Minimized: a slim resumable pill instead of the full card.
  if (minimized) {
    return (
      <button
        type='button'
        onClick={() => setMinimizedPersisted(false)}
        className='flex w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10'
      >
        <Sparkles className='h-4 w-4 shrink-0 text-primary' />
        <span className='text-sm font-medium'>
          Setup: {doneCount} of {totalSteps}
        </span>
        <span className='h-1.5 max-w-40 flex-1 overflow-hidden rounded-full bg-primary/15'>
          <span
            className='block h-full rounded-full bg-primary transition-[width] duration-300'
            style={{ width: `${progressPercent}%` }}
          />
        </span>
        <span className='ml-auto flex items-center gap-1 text-xs font-medium text-primary'>
          Continue
          <ChevronDown className='h-3.5 w-3.5' />
        </span>
      </button>
    )
  }

  return (
    <Card className='border-primary/25 animate-fade-in'>
      <CardHeader className='pb-3'>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0'>
            <h3 className='text-lg font-semibold'>Get started</h3>
            <p className='mt-0.5 text-sm text-muted-foreground'>
              {encouragement(progressPercent)}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-medium text-muted-foreground'>
              {doneCount} of {totalSteps}
            </span>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={() => setMinimizedPersisted(true)}
              aria-label='Minimize setup checklist'
            >
              <ChevronUp className='h-4 w-4' />
            </Button>
          </div>
        </div>
        <div
          className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/15'
          role='progressbar'
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label='Setup progress'
        >
          <div
            className='h-full rounded-full bg-primary transition-[width] duration-300'
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-0'>
          {stepStates.map((step, index) => {
            const isActive = step.id === activeStepId
            const isLast = index === stepStates.length - 1
            const lineActive =
              step.isDone &&
              (isLast ||
                stepStates[index + 1].isDone ||
                stepStates[index + 1]?.id === activeStepId)
            const canClickStep = canNavigateToStep(step.id)

            return (
              // No staggered entrance: this card polls every 10s, so a
              // cascading per-row animation replays on any remount.
              <div key={step.id} className='flex gap-3'>
                <div className='flex w-9 shrink-0 flex-col items-center'>
                  <div
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      step.isDone &&
                        'bg-primary text-primary-foreground shadow-sm animate-check-pop',
                      !step.isDone &&
                        isActive &&
                        'border-2 border-primary bg-background text-primary',
                      !step.isDone &&
                        !isActive &&
                        'bg-muted text-muted-foreground'
                    )}
                  >
                    {step.isDone ? (
                      <Check className='h-4 w-4' strokeWidth={2.5} />
                    ) : (
                      index + 1
                    )}
                  </div>
                  {!isLast && (
                    <div
                      className={cn(
                        'mt-1 min-h-[16px] w-0.5 flex-1 rounded-full',
                        lineActive ? 'bg-primary/50' : 'bg-border'
                      )}
                    />
                  )}
                </div>
                <div
                  className={cn(
                    'min-w-0 flex-1',
                    isActive ? 'pb-6' : 'pb-4',
                    isLast && 'pb-2'
                  )}
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    {canClickStep ? (
                      <button
                        type='button'
                        className={cn(
                          'text-left text-sm font-medium underline-offset-4 transition-colors hover:text-primary hover:underline',
                          isActive || step.isDone
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        )}
                        onClick={() => {
                          selectStep(step.id)
                          updateOnboarding({ currentStepId: step.id })
                        }}
                      >
                        {step.label}
                      </button>
                    ) : (
                      <p
                        className={cn(
                          'text-sm font-medium',
                          step.isDone || isActive
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        )}
                      >
                        {step.label}
                      </p>
                    )}
                    {!step.isDone && (
                      <span className='rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground'>
                        {step.timeEstimate}
                      </span>
                    )}
                  </div>
                  {/* Rendered whenever the step is selected, done or not. It
                      used to require !isDone, so opening a completed step
                      showed an empty row: someone who wanted to generate a
                      replacement API key had no way back to that action. The
                      tick stays; only the body comes back. */}
                  {isActive && (
                    <div className='animate-fade-in'>
                      <p className='mt-1 text-sm text-muted-foreground'>
                        {step.isDone
                          ? step.doneDescription ?? step.description
                          : step.description}
                      </p>
                      <div className='mt-3 flex flex-wrap items-center gap-2'>
                        <StepActions
                          stepId={step.id}
                          isDone={step.isDone}
                          isSaving={savingOnboarding}
                          subLoading={subLoading}
                          userEmail={userData?.email}
                          onSkipStep={(id) => updateOnboarding({ skipStepId: id })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
      <CardFooter className='flex justify-end pt-3'>
        <Button
          variant='ghost'
          size='sm'
          disabled={savingOnboarding}
          onClick={() => updateOnboarding({ complete: true })}
        >
          Finish setup
        </Button>
      </CardFooter>
    </Card>
  )
}
