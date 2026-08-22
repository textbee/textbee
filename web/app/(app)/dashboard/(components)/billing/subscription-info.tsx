'use client'

import { useEffect } from 'react'
import {
  ArrowRight,
  Calendar,
  ExternalLink,
  Info,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCurrentUser, useSubscription } from '@/lib/api'
import type { SubscriptionStatus } from '@/lib/api/types'
import {
  formatLimit,
  formatPrice,
  formatDate,
  getBillingInterval,
  titleCaseStatus,
} from '@/lib/format'
import {
  subscriptionStatusIcon,
  subscriptionStatusTone,
  usageMeterColor,
} from '@/lib/status'
import { deriveUsage } from '@/lib/usage'
import { billingPriceLabel, deriveBillingState } from '@/lib/billing'
import { checkoutPath, formatPlanPrice } from '@/lib/plans'
import { Routes } from '@/config/routes'
import { polarCustomerPortalRequestUrl } from '@/config/external-links'
import Link from 'next/link'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type Meter = {
  used: number
  remaining: number
  percentage: number
  usedLabel: string
  unlimited: boolean
}

// Icon arrives as a prop rather than being selected into a local, matching how
// EmptyState and the dashboard Stat take theirs. Both the icon and the tone
// come from the status, so the pill can no longer show a reassuring tick next
// to bad news the way the hardcoded check mark did.
function StatusPill({
  status,
  icon: Icon,
}: {
  status: SubscriptionStatus | null | undefined
  icon: LucideIcon
}) {
  const tone = subscriptionStatusTone(status)
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5',
        tone.bg
      )}
    >
      <Icon className={cn('h-3 w-3', tone.text)} aria-hidden />
      <span className={cn('text-xs font-medium', tone.text)}>
        {/* Never assert "Active" for a payload that carried no status. */}
        {titleCaseStatus(status) || 'Unknown'}
      </span>
    </div>
  )
}

function DateTile({ label, value }: { label: string; value?: string }) {
  return (
    <div className='flex items-center gap-2 rounded-md border bg-muted/40 p-2.5'>
      <Calendar className='h-3.5 w-3.5 flex-none text-primary' aria-hidden />
      <div className='min-w-0'>
        <p className='text-[11px] text-muted-foreground'>{label}</p>
        <p className='truncate text-xs font-medium text-foreground'>
          {formatDate(value)}
        </p>
      </div>
    </div>
  )
}

type LimitTileProps = {
  label: string
  effectiveValue: number | null | undefined
  planValue: number | null | undefined
  isOverridden: boolean
  planName?: string
  tooltipUnit: string
  unlimitedNote?: string
  /** Wording for the -1 case, when "Unlimited" would overstate what the
   *  device can actually deliver. Falls back to the shared formatter. */
  unlimitedLabel?: string
  meter?: Meter
}

function LimitTile({
  label,
  effectiveValue,
  planValue,
  isOverridden,
  planName,
  tooltipUnit,
  unlimitedNote,
  unlimitedLabel,
  meter,
}: LimitTileProps) {
  const isUnlimited = effectiveValue === -1
  const meterColor = meter ? usageMeterColor(meter.percentage) : 'bg-green-500'

  return (
    <div
      className={cn(
        'rounded-md border p-2.5',
        isOverridden
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'bg-muted/40'
      )}
    >
      <div className='flex items-center justify-between gap-1'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        {isOverridden && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex cursor-default items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400'>
                  <Sparkles className='h-2.5 w-2.5' aria-hidden />
                  Custom
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p className='max-w-[220px]'>
                  Custom limit set for your account by the textbee team.
                  {planName
                    ? ` Standard ${planName} plan limit: ${formatLimit(
                        planValue
                      )} ${tooltipUnit}.`
                    : ''}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className='mt-0.5 flex items-baseline gap-1.5'>
        <p className='text-sm font-semibold text-foreground'>
          {isUnlimited && unlimitedLabel
            ? unlimitedLabel
            : formatLimit(effectiveValue)}
        </p>
        {isOverridden && (
          <span className='text-xs text-muted-foreground line-through'>
            {formatLimit(planValue)}
          </span>
        )}
        {isUnlimited && unlimitedNote && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className='inline-flex items-center'>
                  <Info className='h-3.5 w-3.5 cursor-pointer text-muted-foreground' />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{unlimitedNote}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {meter && !meter.unlimited && (
        <div className='mt-1.5'>
          <div className='h-1.5 w-full overflow-hidden rounded-full bg-muted'>
            <div
              className={cn('h-full rounded-full transition-all', meterColor)}
              style={{
                width: `${Math.min(Math.max(meter.percentage, 0), 100)}%`,
              }}
            />
          </div>
          <div className='mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground'>
            <span>
              {meter.used.toLocaleString()} {meter.usedLabel}
            </span>
            <span className='flex-none'>
              {Math.max(meter.remaining, 0).toLocaleString()} left
            </span>
          </div>
        </div>
      )}
      {meter && meter.unlimited && (
        <p className='mt-1.5 text-[10px] text-muted-foreground'>
          {meter.used.toLocaleString()} {meter.usedLabel}
        </p>
      )}
    </div>
  )
}

export default function SubscriptionInfo() {
  const { toast } = useToast()

  // the checkout page redirects here after an in-place plan change
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get('plan-change-success')) {
      toast({
        title: 'Plan updated',
        description: 'Your subscription has been updated to the new plan.',
      })
      searchParams.delete('plan-change-success')
      const query = searchParams.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`,
      )
    }
  }, [toast])

  const {
    data: currentSubscription,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useSubscription()

  const { data: currentUser } = useCurrentUser()

  if (isLoadingSubscription)
    return (
      // Mirrors the two cards below. The old 16px spinner in an empty column
      // read as a blank page while the subscription loaded.
      <div role='status' className='space-y-4'>
        <span className='sr-only'>Loading subscription</span>
        <Skeleton className='h-44 w-full rounded-lg' />
        <Skeleton className='h-56 w-full rounded-lg' />
      </div>
    )

  if (subscriptionError)
    return (
      <p className='text-sm text-destructive'>
        Failed to load subscription information
      </p>
    )

  const plan = currentSubscription?.plan
  const usage = currentSubscription?.usage

  const billing = deriveBillingState(currentSubscription)
  const amount = billingPriceLabel(currentSubscription)

  // Shared with the dashboard usage cards. This page used to derive the same
  // numbers inline, which is exactly what deriveUsage exists to prevent: the
  // helper clamps percentage to 0-100 and the inline copy did not, so the two
  // screens could disagree about the same quota.
  const { daily, monthly } = deriveUsage(currentSubscription)

  const isOverridden = (
    custom: number | null | undefined,
    planValue: number | null | undefined
  ) => custom != null && custom !== planValue

  const limitTiles: LimitTileProps[] = [
    {
      label: 'Daily',
      effectiveValue: usage?.dailyLimit ?? plan?.dailyLimit,
      planValue: plan?.dailyLimit,
      isOverridden: isOverridden(
        currentSubscription?.customDailyLimit,
        plan?.dailyLimit
      ),
      planName: billing.planName,
      tooltipUnit: 'per day',
      unlimitedNote: 'Unlimited (within monthly limit)',
      meter: {
        used: daily.used,
        remaining: daily.remaining,
        percentage: daily.percentage,
        usedLabel: 'used today',
        unlimited: daily.unlimited,
      },
    },
    {
      // "Last 30 days", not "Monthly": the backend counts from setMonth(-1),
      // a rolling window. Calling it monthly led users who capped out late in
      // the month to wait for a reset on the 1st that never comes.
      label: 'Last 30 days',
      effectiveValue: usage?.monthlyLimit ?? plan?.monthlyLimit,
      planValue: plan?.monthlyLimit,
      isOverridden: isOverridden(
        currentSubscription?.customMonthlyLimit,
        plan?.monthlyLimit
      ),
      planName: billing.planName,
      tooltipUnit: 'per rolling 30 days',
      unlimitedNote: 'Unlimited (within fair usage)',
      meter: {
        used: monthly.used,
        remaining: monthly.remaining,
        percentage: monthly.percentage,
        usedLabel: 'used in the last 30 days',
        unlimited: monthly.unlimited,
      },
    },
    {
      label: 'Bulk send',
      effectiveValue: usage?.bulkSendLimit ?? plan?.bulkSendLimit,
      planValue: plan?.bulkSendLimit,
      isOverridden: isOverridden(
        currentSubscription?.customBulkSendLimit,
        plan?.bulkSendLimit
      ),
      planName: billing.planName,
      tooltipUnit: 'per bulk send',
      // Not "Unlimited": the phone sends one message at a time, so a very
      // large batch is delivered over hours rather than all at once.
      unlimitedLabel: 'No fixed cap',
      unlimitedNote:
        'No per-batch cap on your plan, within your monthly limit. Your phone sends one message at a time, so a large batch is delivered steadily rather than all at once.',
    },
    {
      label: 'Devices',
      effectiveValue: usage?.deviceLimit ?? plan?.deviceLimit,
      planValue: plan?.deviceLimit,
      isOverridden: isOverridden(
        currentSubscription?.customDeviceLimit,
        plan?.deviceLimit
      ),
      planName: billing.planName,
      tooltipUnit: 'devices',
      unlimitedNote: 'Unlimited devices',
    },
  ]

  const hasCustomLimits = limitTiles.some((tile) => tile.isOverridden)

  return (
    <div className='space-y-4'>
      {/* Plan and billing identity. */}
      <section className='rounded-lg border bg-card p-4 shadow-sm'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='text-lg font-bold text-foreground'>
                {billing.planName}
              </h3>
              {hasCustomLimits && (
                <Badge
                  variant='outline'
                  className='gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400'
                >
                  <Sparkles className='h-3 w-3' aria-hidden />
                  Custom limits
                </Badge>
              )}
            </div>

            <p className='mt-0.5 text-xs text-muted-foreground'>
              {billing.isFree ? (
                <>
                  <span className='font-medium text-foreground'>
                    {formatPlanPrice(0)}
                  </span>{' '}
                  / month. No subscription, nothing to pay.
                </>
              ) : amount != null ? (
                <>
                  <span className='font-medium text-foreground'>
                    {formatPrice(amount, currentSubscription?.currency)}
                  </span>
                  {currentSubscription?.recurringInterval && (
                    <>
                      {' '}
                      /{' '}
                      {getBillingInterval(
                        currentSubscription?.recurringInterval
                      )}
                    </>
                  )}
                </>
              ) : (
                'Current subscription'
              )}
            </p>
          </div>

          {/* A free account has no subscription, so it has no status. Showing
              a pill here at all was what produced "Unknown" for every free
              user. A real subscription still shows its true status, including
              Unknown when the payload genuinely omits one. */}
          {!billing.isFree && (
            <StatusPill
              status={billing.status}
              icon={subscriptionStatusIcon(billing.status)}
            />
          )}
        </div>

        {billing.hasBillingDates && (
          <div className='mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
            <DateTile
              label='Start date'
              value={currentSubscription?.subscriptionStartDate}
            />
            <DateTile
              label='Next payment'
              value={currentSubscription?.currentPeriodEnd}
            />
          </div>
        )}

        <div className='mt-4 flex flex-wrap items-center gap-2'>
          {billing.upgradeTier && (
            <Button size='sm' asChild>
              <Link href={checkoutPath(billing.upgradeTier.id)}>
                Upgrade to {billing.upgradeTier.name}
                <ArrowRight className='ml-1 h-3.5 w-3.5' aria-hidden />
              </Link>
            </Button>
          )}

          {billing.canManageBilling && (
            <Button size='sm' variant='outline' asChild>
              <Link
                href={polarCustomerPortalRequestUrl(currentUser?.email)}
                target='_blank'
                rel='noopener noreferrer'
              >
                Manage subscription
                <ExternalLink className='ml-1 h-3.5 w-3.5' aria-hidden />
              </Link>
            </Button>
          )}

          {/* Same label as the onboarding plan picker, pointing at the same
              page, so the two do not read as different destinations. */}
          <Button
            size='sm'
            variant='link'
            className='h-auto px-0 text-xs text-muted-foreground'
            asChild
          >
            <a
              href={`${Routes.landingPage}/pricing`}
              target='_blank'
              rel='noopener noreferrer'
            >
              Compare all plans
              <ExternalLink className='ml-1 h-3 w-3' aria-hidden />
            </a>
          </Button>
        </div>
      </section>

      {/* Usage against the plan's limits. */}
      <section className='rounded-lg border bg-card p-4 shadow-sm'>
        <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
          <div className='flex items-center gap-1'>
            <h4 className='text-xs font-medium text-muted-foreground'>
              Usage limits
            </h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className='inline-flex items-center'>
                    <Info className='h-3.5 w-3.5 cursor-pointer text-muted-foreground' />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className='max-w-[240px]'>
                    SMS usage is measured on a rolling window, not your billing
                    cycle. Daily usage resets at 00:00 UTC and monthly usage
                    covers a rolling 30-day window. The start and next payment
                    dates above are just your subscription start and renewal
                    dates.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {hasCustomLimits && (
            <p className='text-[10px] text-amber-600 dark:text-amber-400'>
              Custom values set for your account
            </p>
          )}
        </div>

        <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
          {limitTiles.map((tile) => (
            <LimitTile key={tile.label} {...tile} />
          ))}
        </div>
      </section>
    </div>
  )
}
