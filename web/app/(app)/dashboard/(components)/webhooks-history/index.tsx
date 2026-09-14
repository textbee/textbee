'use client'

import WebhookDeliveriesTable from './deliveries-table'
import NumberedPagination from '@/components/shared/numbered-pagination'
import ErrorState from '@/components/shared/error-state'
import {
  useDevices,
  useWebhookNotifications,
  useWebhooks,
} from '@/lib/api'
import Filters from './filters'
import { useWebhookHistoryFilters } from './use-filters'

// Container for the webhook delivery history: owns filter state via the
// use-filters hook and hands rendering to Filters + the notifications table.
export default function WebhooksHistory() {
  const filters = useWebhookHistoryFilters()
  const {
    currentDevice,
    currentWebhook,
    eventType,
    status,
    dateQuery,
    page,
    setPage,
    limit,
  } = filters

  const { data: devices } = useDevices()
  const { data: webhooks } = useWebhooks()

  const { 
    data: webhookNotifications, 
    isLoading: isLoadingNotifications,
    error,
    refetch,
   } = useWebhookNotifications({
      eventType: eventType === 'all' ? '' : eventType,
      status: status === 'all' ? '' : status,
      deviceId: currentDevice === 'all' ? '' : currentDevice,
      webhookSubscriptionId: currentWebhook === 'all' ? '' : currentWebhook,
      start: dateQuery.start,
      end: dateQuery.end,
      page,
      limit,
    })

  const totalPages = webhookNotifications?.data?.meta?.totalPages ?? 1
  return (
    <div className='flex flex-col gap-y-4'>
      <div className='bg-card rounded-lg shadow-sm border border-border p-4 mb-4'>
        <div className='flex flex-col gap-4'>
          <Filters
            filters={filters}
            devices={devices ?? []}
            webhooks={webhooks ?? []}
          />

          {isLoadingNotifications ? (
            <WebhookDeliveriesTable
              data={[]}
              isLoading={true}
            />
          ) : error ? (
            <ErrorState
              error={error}
              title="Couldn't load webhook deliveries"
              onRetry={() => refetch()}
            />
          ) : (
            <WebhookDeliveriesTable
              data={webhookNotifications?.data?.data || []}
              isLoading={false}
              status={status}
            />
          )}

          <NumberedPagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  )
}
