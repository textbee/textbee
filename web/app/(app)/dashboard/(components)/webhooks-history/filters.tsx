'use client'

import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
} from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageSquare, Smartphone, Webhook } from 'lucide-react'
import { formatDeviceName } from '@/lib/utils'
import type { Device, WebhookSubscription } from '@/lib/api'
import {
  DATE_RANGE_PRESETS,
  MESSAGE_EVENTS,
  type WebhookHistoryFilters,
} from './use-filters'

function FilterField({
  icon: Icon,
  label,
  className,
  children,
}: {
  icon: typeof Smartphone
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <div className='flex items-center gap-2 mb-1.5'>
        <Icon className='h-3.5 w-3.5 text-primary' />
        <h3 className='text-sm font-medium text-foreground'>{label}</h3>
      </div>
      {children}
    </div>
  )
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All', dot: 'bg-muted-foreground' },
  { value: 'delivered', label: 'Delivered', dot: 'bg-green-500' },
  { value: 'pending', label: 'Pending', dot: 'bg-brand-500' },
  { value: 'failed', label: 'Failed', dot: 'bg-red-500' },
  { value: 'retrying', label: 'Retrying', dot: 'bg-muted-foreground' },
]

type FiltersProps = {
  filters: WebhookHistoryFilters
  devices: Device[]
  webhooks: WebhookSubscription[]
}

// Filter row for the webhook delivery history (device, webhook, event type,
// status, date range with a custom-range popover).
export default function Filters({ filters, devices, webhooks }: FiltersProps) {
  const {
    currentDevice,
    currentWebhook,
    eventType,
    status,
    dateRange,
    openCal,
    setOpenCal,
    dateQuery,
    setDateQuery,
    handleDeviceChange,
    handleWebhookChange,
    handleEventTypeChange,
    handleStatusChange,
    handleDateRangeChange,
    cancelCustomRange,
    applyCustomRange,
  } = filters

  return (
    <>
      <div className='flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap'>
        <FilterField icon={Smartphone} label='Device'>
          <Select value={currentDevice} onValueChange={handleDeviceChange}>
            <SelectTrigger className='w-full h-9 text-sm'>
              <SelectValue placeholder='Select a device' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key='all' value='all'>
                All devices
              </SelectItem>
              {devices.map((device) => (
                <SelectItem key={device._id} value={device._id}>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium'>{formatDeviceName(device)}</span>
                    {!device.enabled && (
                      <Badge variant='outline' className='ml-1 text-xs py-0 h-5'>
                        Disabled
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField icon={Webhook} label='Webhook' className='w-full sm:w-56'>
          <Select value={currentWebhook} onValueChange={handleWebhookChange}>
            <SelectTrigger className='w-full h-9 text-sm'>
              <SelectValue placeholder='Select a webhook' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem key='all' value='all'>
                All webhooks
              </SelectItem>
              {webhooks.map((webhook) => (
                <SelectItem key={webhook._id} value={webhook._id}>
                  <div className='flex items-center gap-2'>
                    <span className='font-medium truncate max-w-[180px]'>
                      {webhook.name?.trim() || webhook.deliveryUrl}
                    </span>
                    {!webhook.isActive && (
                      <Badge variant='outline' className='ml-1 text-xs py-0 h-5'>
                        Inactive
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField
          icon={MessageSquare}
          label='Event Type'
          className='w-full sm:w-44'
        >
          <Select value={eventType} onValueChange={handleEventTypeChange}>
            <SelectTrigger className='w-full h-9 text-sm'>
              <SelectValue placeholder='Message type' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>
                <div className='flex items-center gap-1.5'>
                  <div className='h-1.5 w-1.5 rounded-full bg-muted-foreground' />
                  All Events
                </div>
              </SelectItem>
              {MESSAGE_EVENTS.map((event) => (
                <SelectItem value={event} key={event}>
                  <div className='flex items-center gap-1.5'>
                    <div className='h-1.5 w-1.5 rounded-full bg-muted-foreground' />
                    {event}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField icon={MessageSquare} label='Status' className='w-full sm:w-44'>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className='w-full h-9 text-sm'>
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className='flex items-center gap-1.5'>
                    <div className={`h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                    {opt.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField
          icon={MessageSquare}
          label='Date Range'
          className='w-full sm:w-44'
        >
          <Select value={dateRange} onValueChange={handleDateRangeChange}>
            <SelectTrigger className='w-full h-9 text-sm'>
              <SelectValue placeholder='Date Range' />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
      </div>

      <Popover open={openCal} onOpenChange={setOpenCal}>
        <PopoverContent className='p-4 w-64'>
          <div className='flex flex-col gap-3'>
            <div>
              <label className='block text-xs mb-1' htmlFor='start-date'>
                Start Date
              </label>
              <input
                id='start-date'
                type='date'
                className='w-full border rounded px-2 py-1 text-sm'
                value={dateQuery.start ? dateQuery.start.split('T')[0] : ''}
                onChange={(e) =>
                  setDateQuery({
                    ...dateQuery,
                    start: e.target.value
                      ? new Date(e.target.value + 'T23:59:59.999Z').toISOString()
                      : '',
                  })
                }
              />
            </div>
            <div>
              <label className='block text-xs mb-1' htmlFor='end-date'>
                End Date
              </label>
              <input
                id='end-date'
                type='date'
                className='w-full border rounded px-2 py-1 text-sm'
                value={dateQuery.end ? dateQuery.end.split('T')[0] : ''}
                onChange={(e) =>
                  setDateQuery({
                    ...dateQuery,
                    end: e.target.value
                      ? new Date(e.target.value + 'T23:59:59.999Z').toISOString()
                      : '',
                  })
                }
              />
            </div>
            <div className='flex gap-2'>
              <Button size='sm' variant='outline' onClick={cancelCustomRange}>
                Cancel
              </Button>
              <Button
                size='sm'
                onClick={applyCustomRange}
                disabled={!dateQuery.start || !dateQuery.end}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
