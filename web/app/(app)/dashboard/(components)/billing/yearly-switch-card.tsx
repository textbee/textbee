'use client'

import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { ApiEndpoints } from '@/config/api'
import { useBillingPlans } from '@/lib/api'
import type { Subscription } from '@/lib/api/types'
import { yearlySwitchTier } from '@/lib/billing'
import httpBrowserClient from '@/lib/httpBrowserClient'
import {
  formatPlanPrice,
  monthlyEquivalent,
  promotionOffer,
} from '@/lib/plans'
import { apiErrorMessage } from '@/lib/utils/errorHandler'
import { checkoutSourceBody } from '@/lib/analytics/checkout-source'

/** Offers a monthly subscriber the same plan billed yearly. */
export default function YearlySwitchCard({
  subscription,
}: {
  subscription: Subscription | undefined
}) {
  const { data: plans } = useBillingPlans()
  const [open, setOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const tier = yearlySwitchTier(subscription, plans)
  if (!tier?.yearlyPrice) return null

  const sale = tier.salePrice
  const yearlyPrice = formatPlanPrice(sale ?? tier.yearlyPrice)
  const perMonth = sale !== undefined ? sale / 12 : monthlyEquivalent(tier)
  const monthsFree =
    tier.monthsFree >= 1
      ? `, ${tier.monthsFree} ${tier.monthsFree === 1 ? 'month' : 'months'} free`
      : ''

  const confirm = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setIsConfirming(true)
    setError(null)
    try {
      await httpBrowserClient.post(ApiEndpoints.billing.changePlan(), {
        planName: tier.id,
        billingInterval: 'yearly',
        ...(sale !== undefined && { promotionShown: true }),
        ...checkoutSourceBody({ from: 'app_billing_yearly' }),
      })
      window.location.href = '/dashboard/account/billing?plan-change-success=1'
    } catch (err) {
      // no auto-retry here: the request may have charged the card
      setError(
        apiErrorMessage(err) ||
          'Failed to change your plan. Please try again or contact billing@textbee.dev.'
      )
      inFlight.current = false
      setIsConfirming(false)
    }
  }

  return (
    <section className='frame rounded-lg border bg-card p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <h4 className='text-sm font-semibold text-foreground'>
          Switch to yearly
        </h4>
        <Badge variant='secondary' className='text-[11px]'>
          Save {tier.savingPercent}%{monthsFree}
        </Badge>
      </div>
      <p className='mt-1 text-xs text-muted-foreground tabular-nums'>
        {tier.name} billed yearly is{' '}
        {sale !== undefined && (
          <>
            <s>{formatPlanPrice(tier.yearlyPrice)}</s>{' '}
          </>
        )}
        <span className='font-medium text-foreground'>{yearlyPrice}</span> a
        year
        {perMonth !== undefined && <>, {formatPlanPrice(perMonth)}/month</>}.
        {sale !== undefined && tier.promotion && (
          <> {tier.promotion.label}: {promotionOffer(tier.promotion)}.</>
        )}
      </p>
      <p className='mt-1 text-xs text-muted-foreground'>
        Unused days on your monthly plan are credited by our payment provider.
      </p>
      <Button
        size='sm'
        className='mt-3'
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        Switch to yearly
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!isConfirming) setOpen(next)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Switch {tier.name} to yearly</DialogTitle>
            <DialogDescription className='tabular-nums'>
              {tier.name} plan, billed yearly. {yearlyPrice} a year, charged
              now minus the credit.
            </DialogDescription>
          </DialogHeader>
          {error && <p className='text-sm text-destructive'>{error}</p>}
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button
              variant='outline'
              disabled={isConfirming}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={confirm} disabled={isConfirming}>
              {isConfirming && (
                <Spinner
                  size='sm'
                  color='white'
                  className='mr-2 motion-reduce:animate-none'
                />
              )}
              {isConfirming ? 'Switching' : 'Confirm switch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
