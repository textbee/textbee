import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useSubscription } from '@/lib/api'
import { checkoutPath } from '@/lib/plans'
import { Routes } from '@/config/routes'
import Link from 'next/link'
import { useMemo } from 'react'

const DISCOUNT_CODE_FALLBACK = null
const DISCOUNT_PERCENTAGE_FALLBACK = null

const envDiscountCode = process.env.NEXT_PUBLIC_DISCOUNT_CODE?.trim()
const envDiscountPercentage = process.env.NEXT_PUBLIC_DISCOUNT_PERCENTAGE?.trim()

const discountCode = (envDiscountCode !== undefined && envDiscountCode !== '') 
  ? envDiscountCode 
  : DISCOUNT_CODE_FALLBACK
const discountPercentage = (envDiscountPercentage !== undefined && envDiscountPercentage !== '')
  ? envDiscountPercentage
  : DISCOUNT_PERCENTAGE_FALLBACK
const isDiscountEnabled = discountCode !== null && discountCode !== '' && discountPercentage !== null && discountPercentage !== ''

export default function UpgradeToProAlert() {
  const {
    data: currentSubscription,
    isLoading: isLoadingSubscription,
    error: subscriptionError,
  } = useSubscription()

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
    } else {
      const allCtaMessages = [
        "Upgrade to Pro for exclusive features and benefits!",
        "Offer: You are eligible for a 30% discount when upgrading to Pro!",
        "Unlock premium features with our Pro plan today!",
        "Take your experience to the next level with Pro!",
        "Pro users get priority support and advanced features!",
        "Limited time offer: Upgrade to Pro and save 30%!",
      ]
      const allButtonTexts = [
        "Get Pro Now!",
        "Upgrade Today!",
        "Go Pro!",
        "Unlock Pro!",
        "Claim Your Discount!",
        "Upgrade & Save!",
      ]
      
      // Filter out discount-related messages if discount is not enabled
      const ctaMessages = isDiscountEnabled
        ? allCtaMessages
        : allCtaMessages.filter(
            (msg) =>
              !msg.toLowerCase().includes('discount') &&
              !msg.toLowerCase().includes('offer') &&
              !msg.toLowerCase().includes('save') &&
              !msg.includes('30%')
          )
      
      const buttonTexts = isDiscountEnabled
        ? allButtonTexts
        : allButtonTexts.filter(
            (text) =>
              !text.toLowerCase().includes('discount') &&
              !text.toLowerCase().includes('save')
          )
      
      const randomIndex = Math.floor(Math.random() * ctaMessages.length)
      
      const subMessage = isDiscountEnabled
        ? `Use discount code ${discountCode} at checkout for a ${discountPercentage}% discount!`
        : "Unlock premium features, priority support, and advanced capabilities with Pro!"
      
      return {
        bgColor: 'border-primary/25 bg-primary/[0.06]',
        message: ctaMessages[randomIndex],
        subMessage,
        buttonText: buttonTexts[randomIndex],
        buttonColor: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
        urgency: 'normal'
      }
    }
  }, [monthlyUsagePercentage, monthlyLimit, processedSmsLastMonth])

  const planName = currentSubscription?.plan?.name

  if (isLoadingSubscription || !currentSubscription || subscriptionError) {
    return null
  }

  if (planName === 'scale' || planName?.startsWith('custom')) {
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
              <Link href={checkoutPath('scale')}>
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
          {alertConfig.urgency === 'normal' && isDiscountEnabled ? (
            <>Use discount code <strong className="text-primary">{discountCode}</strong> at checkout for a {discountPercentage}% discount!</>
          ) : (
            alertConfig.subMessage
          )}
        </span>
        <div className='w-full sm:w-auto mt-2 sm:mt-0 flex justify-center sm:justify-end flex-wrap gap-1 md:gap-2'>
          <Button
            variant='outline'
            size='sm'
            asChild
            className={`${alertConfig.buttonColor} text-xs md:text-sm`}
          >
            <Link href={checkoutPath('pro')}>{alertConfig.buttonText}</Link>
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
