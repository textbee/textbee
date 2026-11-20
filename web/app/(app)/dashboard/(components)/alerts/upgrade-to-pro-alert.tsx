import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useBillingPlans, useSubscription } from '@/lib/api'
import { freePromotionEligible } from '@/lib/billing'
import {
  checkoutPath,
  formatPlanPrice,
  formatPromotionEnd,
  priceTiers,
  promotionDurationLabel,
  promotionInterval,
  promotionLine,
  type PricedPlanTier,
} from '@/lib/plans'
import { Routes } from '@/config/routes'
import Link from 'next/link'
import { useMemo } from 'react'

const CTA_MESSAGES = [
  'Upgrade to Pro for exclusive features and benefits!',
  'Unlock premium features with our Pro plan today!',
  'Take your experience to the next level with Pro!',
  'Pro users get priority support and advanced features!',
]
const CTA_BUTTONS = ['Get Pro Now!', 'Upgrade Today!', 'Go Pro!', 'Unlock Pro!']

/** Banner copy for a live promotion on Pro, built only from its data. */
function promotionBanner(tier: PricedPlanTier) {
  const promotion = tier.promotion!
  const yearly = promotion.yearlyPrice !== undefined && tier.yearlyPrice !== undefined
  const sale = yearly ? promotion.yearlyPrice : promotion.monthlyPrice
  const list = yearly ? tier.yearlyPrice : tier.monthlyPrice
  const term = promotionDurationLabel(promotion)
  const lasts = term || 'for as long as you stay subscribed'
  const end = formatPromotionEnd(promotion.endsAt)
  const price =
    sale !== undefined && list !== undefined
      ? `Pro is ${formatPlanPrice(sale)} a ${yearly ? 'year' : 'month'} instead of ${formatPlanPrice(list)}, ${lasts}. `
      : ''
  return {
    // A forever discount puts the end in the headline instead of a term.
    message: `${promotion.label}: ${promotion.percentOff}% off Pro${
      term ? `, ${term}` : end ? ` until ${end}` : ''
    }`,
    subMessage: `${price}Applied at checkout.${term && end ? ` Ends ${end}.` : ''}`,
    buttonText: `Get ${promotion.percentOff}% off`,
  }
}

export default function UpgradeToProAlert() {
  const {
    data: currentSubscription,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useSubscription()
  const { data: plans } = useBillingPlans()

  // Only accounts without a paid plan reach a new checkout, so only they see it.
  const proTier = freePromotionEligible(currentSubscription)
    ? priceTiers(plans).find((tier) => tier.id === 'pro')
    : undefined
  const promoTier = proTier?.promotion ? proTier : undefined

  const monthlyUsagePercentage = currentSubscription?.usage?.monthlyUsagePercentage || 0
  const monthlyLimit = currentSubscription?.usage?.monthlyLimit || 0
  const processedSmsLastMonth = currentSubscription?.usage?.processedSmsLastMonth || 0

  const alertConfig = useMemo(() => {
    if (monthlyUsagePercentage >= 100 ) {
      return {
        bgColor: 'border-destructive/30 bg-destructive/[0.07]',
        message: "⚠️ Monthly limit exceeded! Your requests will be rejected until you upgrade.",
        subMessage: `You've used ${processedSmsLastMonth} of ${monthlyLimit} SMS this month.`,
        buttonText: "Upgrade Now!",
        buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        urgency: 'critical'
      }
    } else if (monthlyUsagePercentage >= 80) {
      return {
        bgColor: 'border-warning/30 bg-warning/[0.08]',
        message: "⚠️ Approaching limit! Upgrade to Pro to avoid service interruption.",
        subMessage: `You've used ${monthlyUsagePercentage}% of your monthly SMS limit (${processedSmsLastMonth}/${monthlyLimit}).`,
        buttonText: "Upgrade Before Limit!",
        buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        urgency: 'warning'
      }
    } else if (promoTier) {
      return {
        bgColor: 'border-primary/25 bg-primary/[0.06]',
        ...promotionBanner(promoTier),
        buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        urgency: 'normal'
      }
    } else {
      const randomIndex = Math.floor(Math.random() * CTA_MESSAGES.length)

      return {
        bgColor: 'border-primary/25 bg-primary/[0.06]',
        message: CTA_MESSAGES[randomIndex],
        subMessage: "Unlock premium features, priority support, and advanced capabilities with Pro!",
        buttonText: CTA_BUTTONS[randomIndex],
        buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        urgency: 'normal'
      }
    }
  }, [monthlyUsagePercentage, monthlyLimit, processedSmsLastMonth, promoTier])

  // At a limit the headline stays; the promotion is one added line.
  const saleLine =
    promoTier && alertConfig.urgency !== 'normal'
      ? promotionLine(promoTier.promotion!, 'Pro')
      : undefined
  const proHref = promoTier
    ? checkoutPath('pro', promotionInterval(promoTier), 'app_usage_alert')
    : checkoutPath('pro', undefined, 'app_usage_alert')

  const planName = currentSubscription?.plan?.name

  if (isLoadingSubscription || !currentSubscription || subscriptionError) {
    return null
  }

  if (planName === 'scale' || planName?.startsWith('custom')) {
    return null
  }

  // The past-due alert covers this; a bigger plan is not the fix.
  if (currentSubscription.usage?.paymentHold) {
    return null
  }

  if (planName === 'pro') {
    if (monthlyUsagePercentage < 80) return null

    const scaleAlertConfig =
      monthlyUsagePercentage >= 100
        ? {
            bgColor: 'border-destructive/30 bg-destructive/[0.07]',
            message: '⚠️ Monthly limit exceeded! Upgrade to Scale for 25,000 SMS/mo.',
            subMessage: `You've used ${processedSmsLastMonth} of ${monthlyLimit} SMS this month.`,
            buttonText: 'Upgrade to Scale!',
            buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
          }
        : {
            bgColor: 'border-warning/30 bg-warning/[0.08]',
            message: '⚠️ Approaching Pro limit! Scale up to 25,000 SMS/mo.',
            subMessage: `You've used ${monthlyUsagePercentage}% of your monthly SMS limit (${processedSmsLastMonth}/${monthlyLimit}).`,
            buttonText: 'Upgrade to Scale',
            buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
          }

    return (
      <Alert className={`${scaleAlertConfig.bgColor} text-foreground`}>
        <AlertDescription className='flex flex-col sm:flex-row flex-wrap items-center gap-2 md:gap-4'>
          <span className='w-full sm:flex-1 text-center sm:text-left text-sm md:text-base font-medium'>
            {scaleAlertConfig.message}
          </span>
          <span className='w-full sm:flex-1 text-center sm:text-left text-xs md:text-sm'>
            {scaleAlertConfig.subMessage}
          </span>
          <div className='w-full sm:w-auto mt-2 sm:mt-0 flex justify-center sm:justify-end flex-wrap gap-1 md:gap-2'>
            <Button
              variant='outline'
              size='sm'
              asChild
              className={`${scaleAlertConfig.buttonColor} text-xs md:text-sm`}
            >
              <Link href={checkoutPath('scale', undefined, 'app_usage_alert')}>
                {scaleAlertConfig.buttonText}
              </Link>
            </Button>
            {/* The dashboard has no pricing route; /#pricing was its own root. */}
            <Button
              variant='outline'
              size='sm'
              asChild
              className='text-xs md:text-sm'
            >
              <Link
                href={`${Routes.landingPage}/pricing`}
                target='_blank'
                rel='noopener noreferrer'
              >
                Learn More
              </Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className={`${alertConfig.bgColor} text-foreground`}>
      <AlertDescription className='flex flex-col sm:flex-row flex-wrap items-center gap-2 md:gap-4'>
        <span className='w-full sm:flex-1 text-center sm:text-left text-sm md:text-base font-medium'>
          {alertConfig.message}
        </span>
        <span className='w-full sm:flex-1 text-center sm:text-left text-xs md:text-sm'>
          {alertConfig.subMessage}
          {saleLine && <span className='mt-1 block font-medium'>{saleLine}</span>}
        </span>
        <div className='w-full sm:w-auto mt-2 sm:mt-0 flex justify-center sm:justify-end flex-wrap gap-1 md:gap-2'>
          <Button
            variant='outline'
            size='sm'
            asChild
            className={`${alertConfig.buttonColor} text-xs md:text-sm`}
          >
            <Link href={proHref}>{alertConfig.buttonText}</Link>
          </Button>
          {/* The dashboard has no pricing route; /#pricing was its own root. */}
          {alertConfig.urgency === 'normal' && (
            <Button
              variant='outline'
              size='sm'
              asChild
              className='text-xs md:text-sm'
            >
              <Link
                href={`${Routes.landingPage}/pricing`}
                target='_blank'
                rel='noopener noreferrer'
              >
                Learn More
              </Link>
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
