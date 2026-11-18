'use client'

import Link from 'next/link'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Check, ExternalLink } from 'lucide-react'
import { Routes } from '@/config/routes'
import { useBillingPlans, useSubscription } from '@/lib/api'
import {
  MONEY_BACK_DAYS,
  checkoutPath,
  defaultIntervalFor,
  formatPlanPrice,
  formatPriceCaption,
  isFreeTier,
  monthlyEquivalent,
  monthsFreeSuffix,
  priceTiers,
  promotionChip,
  promotionDurationNote,
  promotionEndNote,
  salePriceFor,
  yearlySavingPercent,
  type BillingInterval,
  type PricedPlanTier,
} from '@/lib/plans'
import { promotionEligible } from '@/lib/billing'
import { cn } from '@/lib/utils'

type PlanPickerProps = {
  isLoading: boolean
  isSaving: boolean
  isDone?: boolean
  onSkip: () => void
}

function PlanCard({
  tier,
  isCurrent,
  isSaving,
  showPromotion,
  onSkip,
}: {
  tier: PricedPlanTier
  isCurrent: boolean
  isSaving: boolean
  showPromotion: boolean
  onSkip: () => void
}) {
  const free = isFreeTier(tier)
  // Monthly when there is no yearly price to quote but a monthly one exists,
  // so the headline never names a price the CTA does not charge.
  const interval: BillingInterval =
    defaultIntervalFor(tier.id) === 'yearly' &&
    !(tier.yearlyPrice === undefined && tier.monthlyPrice !== undefined)
      ? 'yearly'
      : 'monthly'
  const perMonth = monthlyEquivalent(tier)
  const yearly = interval === 'yearly' && tier.yearlyPrice !== undefined
  const headline = yearly ? tier.yearlyPrice : tier.monthlyPrice
  const promotion = showPromotion && !isCurrent ? tier.promotion : undefined
  const sale =
    promotion && headline !== undefined
      ? salePriceFor(tier, yearly ? 'yearly' : 'monthly')
      : undefined
  const onSale =
    promotion && sale !== undefined ? { promotion, price: sale } : undefined
  const caption = onSale
    ? yearly
      ? `${formatPlanPrice(onSale.price / 12)}/month, billed yearly. ${promotionDurationNote(onSale.promotion)}`
      : `Billed monthly. ${promotionDurationNote(onSale.promotion)}`
    : yearly && perMonth !== undefined
      ? `${formatPlanPrice(perMonth)}/month, billed yearly`
      : formatPriceCaption(tier)
  const highlight = tier.isPopular && !isCurrent
  const saving = yearlySavingPercent(tier)

  return (
    <Card
      className={cn(
        'flex h-full flex-col',
        // the accent marks one card only, so it still means something
        highlight
          ? 'border-primary shadow-md ring-1 ring-primary'
          : 'border-border shadow-none',
        isCurrent && 'border-primary/40'
      )}
    >
      <CardHeader className='pb-3 pt-5'>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='text-base'>{tier.name}</CardTitle>
          {(highlight || isCurrent) && (
            <Badge
              variant={isCurrent ? 'secondary' : 'default'}
              className='text-[11px]'
            >
              {isCurrent ? 'Current' : 'Most popular'}
            </Badge>
          )}
        </div>

        <div className='pt-2'>
          {headline !== undefined ? (
            <div className='flex items-baseline gap-1'>
              {/* The headline is what the CTA charges, not the yearly
                  per-month equivalent. */}
              {onSale && (
                <s className='text-base text-muted-foreground tabular-nums'>
                  {formatPlanPrice(headline)}
                </s>
              )}
              <span className='text-3xl font-semibold tabular-nums'>
                {formatPlanPrice(onSale ? onSale.price : headline)}
              </span>
              <span className='text-sm text-muted-foreground'>
                {yearly ? '/year' : '/month'}
              </span>
            </div>
          ) : (
            <a
              href={`${Routes.landingPage}/pricing`}
              target='_blank'
              rel='noreferrer'
              className='inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline'
            >
              See pricing
              <ExternalLink className='ml-1 h-3 w-3' aria-hidden />
            </a>
          )}
          {caption && (
            <CardDescription className='mt-1 tabular-nums'>
              {caption}
            </CardDescription>
          )}
          {onSale ? (
            <Badge variant='secondary' className='mt-2 text-[11px]'>
              {promotionChip(onSale.promotion)}
            </Badge>
          ) : (
            saving !== undefined && (
              <Badge variant='secondary' className='mt-2 text-[11px]'>
                Save {saving}% yearly{monthsFreeSuffix(tier)}
              </Badge>
            )
          )}
        </div>
      </CardHeader>

      <CardContent className='flex-1 pb-4'>
        <ul className='space-y-1.5 text-sm'>
          {tier.features.map((feature) => (
            <li
              key={feature}
              className={cn(
                'flex gap-2',
                free ? 'text-muted-foreground' : 'text-foreground'
              )}
            >
              <Check
                className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground'
                aria-hidden
              />
              {feature}
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className='mt-auto flex-col items-stretch gap-2 pb-4 pt-3'>
        {isCurrent ? (
          <Button variant='outline' className='w-full' disabled>
            Your current plan
          </Button>
        ) : free ? (
          <Button
            variant='outline'
            className='w-full'
            disabled={isSaving}
            onClick={onSkip}
          >
            Continue with Free
          </Button>
        ) : (
          <>
            {/* above the button so every card's CTA lands on one baseline */}
            <p className='text-center text-xs text-muted-foreground'>
              Cancel anytime, keep access until the end of your billing period.
              {' '}
              {MONEY_BACK_DAYS[interval]}-day money-back
              guarantee.
            </p>
            <Button className='w-full' asChild>
              <Link href={checkoutPath(tier.id, interval, 'app_get_started')}>
                Upgrade to {tier.name}
              </Link>
            </Button>
            {onSale && (
              <p className='text-center text-xs text-muted-foreground'>
                {promotionEndNote(onSale.promotion)}
              </p>
            )}
          </>
        )}
      </CardFooter>
    </Card>
  )
}

/**
 * Plan chooser for the "Choose your plan" onboarding step.
 *
 * Tiers come from lib/plans, which mirrors the marketing pricing page, with
 * prices from /billing/plans. The previous version hardcoded Free and Pro
 * inline, so Scale never appeared here at all.
 *
 * Custom is intentionally left out: it is a talk-to-us tier with no
 * self-serve checkout, and "Compare all plans" already links to it.
 */
export default function PlanPicker({
  isLoading,
  isSaving,
  isDone = false,
  onSkip,
}: PlanPickerProps) {
  const { data: subscription } = useSubscription()
  const { data: plans, isPending: plansPending } = useBillingPlans()

  // Wait for prices so a card never flashes "See pricing" first. A failed
  // request falls through to the cards without prices.
  if (isLoading || plansPending) {
    return (
      <div className='grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        <Skeleton className='h-64 rounded-lg' />
        <Skeleton className='h-64 rounded-lg' />
        <Skeleton className='h-64 rounded-lg' />
      </div>
    )
  }

  const currentPlan = subscription?.plan?.name?.trim().toLowerCase()
  const tiers = priceTiers(plans)
  const showPromotion = promotionEligible(subscription)

  return (
    <div className='w-full space-y-3'>
      {/* Stacked on a phone, two up on a tablet, all three from lg. */}
      <div className='grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {tiers.map((tier) => (
          <PlanCard
            key={tier.id}
            tier={tier}
            isCurrent={currentPlan === tier.id}
            isSaving={isSaving}
            showPromotion={showPromotion}
            onSkip={onSkip}
          />
        ))}
      </div>

      <div className='flex flex-wrap items-center gap-4'>
        <Button
          variant='link'
          size='sm'
          className='h-auto px-0 text-xs text-muted-foreground'
          asChild
        >
          <a
            href={`${Routes.landingPage}/pricing`}
            target='_blank'
            rel='noreferrer'
          >
            Compare all plans
            <ExternalLink className='ml-1 h-3 w-3' />
          </a>
        </Button>
        {/* Skipping a step that is already settled would mean nothing. */}
        {!isDone && (
          <Button
            variant='link'
            size='sm'
            className='h-auto px-0 text-muted-foreground'
            disabled={isSaving}
            onClick={onSkip}
          >
            Skip for now →
          </Button>
        )}
      </div>
    </div>
  )
}
