'use client'

import { Button } from '@/components/ui/button'
import { PlusCircle, Webhook } from 'lucide-react'
import ErrorState from '@/components/shared/error-state'
import { useState } from 'react'
import { WebhookData } from '@/lib/types'
import { queryKeys } from '@/lib/api/query-keys'
import { WebhookCard } from './webhook-card'
import { WebhookDocs } from './webhook-docs'
import { CreateWebhookDialog } from './create-webhook-dialog'
import { EditWebhookDialog } from './edit-webhook-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { Skeleton } from '@/components/ui/skeleton'
import { useBillingPlans, useSubscription } from '@/lib/api'
import { Routes } from '@/config/routes'

function WebhookRowSkeleton() {
  return (
    <div className='flex items-center gap-3 px-3 py-2.5'>
      <Skeleton className='h-4 w-4 rounded-sm' />
      <Skeleton className='h-4 w-32' />
      <Skeleton className='h-5 w-14 rounded-full' />
      <Skeleton className='hidden md:block h-4 w-48' />
      <div className='ml-auto flex items-center gap-1.5'>
        <Skeleton className='h-5 w-9 rounded-full' />
        <Skeleton className='h-8 w-8 rounded-md' />
        <Skeleton className='h-8 w-8 rounded-md' />
      </div>
    </div>
  )
}

const plural = (count: number) => (count === 1 ? 'webhook' : 'webhooks')

const planLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

export default function WebhooksSection() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<WebhookData | null>(
    null,
  )
  const queryClient = useQueryClient()

  const {
    data: webhooks,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: () =>
      httpBrowserClient
        .get(ApiEndpoints.gateway.getWebhooks())
        .then((res) => res.data as { data: WebhookData[] }),
  })

  // The list was previously read as `webhooks?.data?.length > 0`, which
  // compares undefined against 0 while the query is still in flight.
  const webhookList = webhooks?.data ?? []

  const handleCreateClick = () => {
    setCreateDialogOpen(true)
  }

  const handleEditClick = (webhook: WebhookData) => {
    setSelectedWebhook(webhook)
    setEditDialogOpen(true)
  }

  const { data: currentSubscription } = useSubscription()
  const { data: plans } = useBillingPlans()

  const webhookCount = webhooks?.data?.length ?? 0
  // Undefined until the subscription loads. -1 means unlimited.
  const webhookLimit = currentSubscription?.usage?.webhookLimit
  const isLimited = webhookLimit !== undefined && webhookLimit !== -1
  const reachedLimit = isLimited && webhookCount >= webhookLimit
  const nearLimit =
    isLimited && webhookLimit >= 2 && webhookCount === webhookLimit - 1

  // A free account sees the Pro limit when Pro allows more. Everyone else,
  // or a Pro plan without a higher limit, is pointed to support.
  const proPlan = plans?.find((plan) => plan.name?.toLowerCase() === 'pro')
  const proWebhookLimit = proPlan?.webhookLimit
  const upgradeNote =
    currentSubscription?.plan?.name?.toLowerCase() === 'free' &&
    proPlan?.name &&
    isLimited &&
    proWebhookLimit !== undefined &&
    (proWebhookLimit === -1 || proWebhookLimit > webhookLimit)
      ? `Upgrade to ${planLabel(proPlan.name)} for ${
          proWebhookLimit === -1 ? 'unlimited' : proWebhookLimit
        } webhooks.`
      : null

  const usageLabel = !isLimited
    ? webhookLimit === -1
      ? `${webhookCount} ${plural(webhookCount)}, unlimited`
      : `${webhookCount} configured`
    : `${webhookCount} of ${webhookLimit} ${plural(webhookLimit)} used`

  return (
    <div>
      {/* Section title and the Deliveries view are owned by the webhooks
          layout (route tabs); this header only carries count + actions. */}
      <div className='flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6'>
        <p className='text-sm text-muted-foreground'>
          Receive real-time notifications for SMS events.{' '}
          {!isLoading && (
            <span className='font-medium text-foreground'>{usageLabel}</span>
          )}
        </p>
        <Button
          onClick={handleCreateClick}
          disabled={reachedLimit || isLoading}
          variant='default'
          className='w-full sm:w-auto'
          title={
            reachedLimit
              ? `Your plan allows ${webhookLimit} ${plural(webhookLimit)}. Delete one to add a new one.`
              : undefined
          }
        >
          <PlusCircle className='mr-2 h-4 w-4' />
          Create Webhook
        </Button>
      </div>

      {!isLoading && (reachedLimit || nearLimit) && (
        <p
          role='status'
          className='mb-4 sm:mb-6 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'
        >
          {reachedLimit
            ? `You have used all ${webhookLimit} ${plural(webhookLimit)} on your plan. Delete one to add a new one. `
            : `You have 1 webhook left on your plan. `}
          {upgradeNote ? (
            <a
              href={`${Routes.landingPage}/pricing`}
              target='_blank'
              rel='noopener noreferrer'
              className='font-medium text-foreground underline underline-offset-4'
            >
              {upgradeNote}
            </a>
          ) : (
            <>
              Need more? Contact{' '}
              <a
                href='mailto:support@textbee.dev'
                className='font-medium text-foreground underline underline-offset-4'
              >
                support@textbee.dev
              </a>
              .
            </>
          )}
        </p>
      )}

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8'>
        <div className='space-y-4'>
          {isLoading ? (
            <div className='rounded-md border divide-y'>
              <WebhookRowSkeleton />
              <WebhookRowSkeleton />
              <WebhookRowSkeleton />
              <WebhookRowSkeleton />
              <WebhookRowSkeleton />
            </div>
          ) : error ? (
            <ErrorState
              error={error}
              title="Couldn't load your webhooks"
              icon={Webhook}
              onRetry={() => refetch()}
            />
          ) : webhookList.length > 0 ? (
            <div className='rounded-md border divide-y bg-card overflow-hidden'>
              {webhookList.map((webhook) => (
                <WebhookCard
                  key={webhook._id}
                  webhook={webhook}
                  onEdit={() => handleEditClick(webhook)}
                  defaultOpen={webhookList.length === 1}
                />
              ))}
            </div>
          ) : (
            <div className='bg-muted/50 rounded-lg p-8 text-center'>
              <h3 className='text-lg font-medium mb-2'>
                No webhooks configured
              </h3>
              <p className='text-muted-foreground mb-4'>
                Add a webhook endpoint to receive real-time notifications for
                SMS events. You can add multiple endpoints for different
                services.
              </p>
              <Button onClick={handleCreateClick} variant='default'>
                <PlusCircle className='mr-2 h-4 w-4' />
                Create Webhook
              </Button>
            </div>
          )}
        </div>

        <div className='hidden lg:block sticky top-8 self-start'>
          <WebhookDocs />
        </div>
      </div>

      <div className='block lg:hidden mt-4 sm:mt-8'>
        <WebhookDocs />
      </div>

      <CreateWebhookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      {selectedWebhook && (
        <EditWebhookDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          webhook={selectedWebhook}
        />
      )}
    </div>
  )
}
