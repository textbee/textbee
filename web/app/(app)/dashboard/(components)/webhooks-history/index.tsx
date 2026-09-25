'use client'

import WebhookDeliveriesTable from './deliveries-table'
import NumberedPagination from '@/components/shared/numbered-pagination'
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
    isError: isNotificationsError,
    error: notificationsError,
    refetch: refetchNotifications,
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
      <div className='frame bg-card rounded-lg border border-border p-4 mb-4'>
        <div className='flex flex-col gap-4'>
          <Filters
            filters={filters}
            devices={devices ?? []}
            webhooks={webhooks ?? []}
          />

          {isNotificationsError ? (
            <div className='rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm'>
              <p className='font-medium text-destructive'>Failed to load webhook history</p>
              <p className='mt-1 text-muted-foreground'>
                {(notificationsError as Error)?.message || 'Request failed'}
              </p>
              <button
                type='button'
                className='mt-3 underline'
                onClick={() => refetchNotifications()}
              >
                Retry
              </button>
            </div>
          ) : isLoadingNotifications ? (
            <WebhookDeliveriesTable data={[]} isLoading={true} />
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
