'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'
import type { RateLimitErrorData } from '@/lib/utils/errorHandler'
import {
  checkoutPath,
  priceTiers,
  promotionInterval,
  promotionLine,
} from '@/lib/plans'
import { useBillingPlans, useSubscription } from '@/lib/api'
import { promotionEligible } from '@/lib/billing'
import { ExternalLinks } from '@/config/external-links'

function DiscordHelpLine() {
  return (
    <p className="text-xs text-muted-foreground">
      Questions about limits? Ask the{' '}
      <a
        href={ExternalLinks.discord}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2"
      >
        community on Discord
      </a>
      .
    </p>
  )
}

interface RateLimitErrorProps {
  errorData?: RateLimitErrorData
  variant?: 'alert' | 'inline'
  className?: string
}

/**
 * Component for displaying rate limit (429) errors with upgrade option
 */
export function RateLimitError({
  errorData,
  variant = 'alert',
  className,
}: RateLimitErrorProps) {
  const { data: subscription } = useSubscription()
  const { data: plans } = useBillingPlans()
  const message = errorData?.message || 'You have reached your usage limit.'
  const pro =
    !errorData?.paymentHold && promotionEligible(subscription)
      ? priceTiers(plans).find((tier) => tier.id === 'pro')
      : undefined
  const promotion = pro?.promotion
  const saleLine = promotion ? promotionLine(promotion, 'Pro') : null
  // An unpaid renewal is fixed by paying, not by a bigger plan.
  const action = errorData?.paymentHold
    ? { href: '/dashboard/account/billing', label: 'Update payment' }
    : promotion && pro
      ? {
          href: checkoutPath('pro', promotionInterval(pro), 'app_limit_error'),
          label: `Upgrade for ${promotion.percentOff}% off`,
        }
      : {
          href: checkoutPath('pro', undefined, 'app_limit_error'),
          label: 'Upgrade Plan',
        }
  const waitHint = errorData?.paymentHold ? null : 'or wait for your limit to reset'

  if (variant === 'inline') {
    return (
      <div className={`flex flex-col gap-2 ${className || ''}`}>
        <p className="text-sm text-destructive">{message}</p>
        {saleLine && <p className="text-sm">{saleLine}</p>}
        <div className="flex gap-2 flex-wrap">
          <Button asChild variant="default" size="sm">
            <Link href={action.href}>{action.label}</Link>
          </Button>
          {waitHint && (
            <p className="text-xs text-muted-foreground flex items-center">
              {waitHint}
            </p>
          )}
        </div>
        <DiscordHelpLine />
      </div>
    )
  }

  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Limit Reached</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 mt-2">
        <p>{message}</p>
        {saleLine && <p className="text-foreground">{saleLine}</p>}
        <div className="flex gap-2 flex-wrap items-center">
          <Button asChild variant="outline" size="sm">
            <Link href={action.href}>{action.label}</Link>
          </Button>
          {waitHint && (
            <span className="text-xs text-muted-foreground">{waitHint}</span>
          )}
        </div>
        <DiscordHelpLine />
      </AlertDescription>
    </Alert>
  )
}

/**
 * Formats a rate limit error message for use in toast notifications
 * Since toasts can't contain interactive components, this returns a plain message
 */
export function formatRateLimitMessageForToast(
  errorData?: RateLimitErrorData
): string {
  const baseMessage = errorData?.message || 'You have reached your usage limit.'
  if (errorData?.paymentHold) return baseMessage
  return `${baseMessage} Please upgrade your plan or wait for your limit to reset.`
}
