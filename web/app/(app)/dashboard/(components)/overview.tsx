'use client'

import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { BarChart3, Smartphone, Key, MessageSquare } from 'lucide-react'
import GetStartedCard from './get-started'
import UsageSummary from './billing/usage-summary'
import { useApiKeys, useDevices, useGatewayStats } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

// Compact all-time totals. Deliberately no trend indicators: the stats
// endpoint returns running totals with no time window, so there is nothing to
// compare against and any arrow would be invented.
function Stat({
  label,
  value,
  caption,
  icon: Icon,
}: {
  label: string
  value: string | number | undefined
  caption: string
  icon: typeof MessageSquare
}) {
  return (
    <div className='min-w-0 bg-card px-4 py-3.5'>
      <div className='flex items-center justify-between gap-3'>
        <p className='label-mono truncate'>{label}</p>
        <Icon className='h-4 w-4 shrink-0 text-muted-foreground' />
      </div>
      <div className='num mt-2 text-2xl font-semibold leading-none tracking-tight'>
        {value !== undefined ? value : <Skeleton className='h-6 w-14' />}
      </div>
      {caption && (
        <p className='mt-1.5 truncate text-xs text-muted-foreground'>{caption}</p>
      )}
    </div>
  )
}

export function Totals() {
  const { data: stats } = useGatewayStats()
  const { data: devices } = useDevices()
  const { data: apiKeys } = useApiKeys('active')

  // The stats endpoint counts every device, enabled or not, so "enabled" has
  // to be derived from the device list we already fetch.
  const enabledDevices = devices?.filter((d) => d.enabled).length
  const totalDevices = devices?.length ?? stats?.totalDeviceCount

  return (
    <>
      <Stat
        label='SMS sent'
        caption='all time'
        value={stats?.totalSentSMSCount?.toLocaleString()}
        icon={MessageSquare}
      />
      <Stat
        label='SMS received'
        caption='all time'
        value={stats?.totalReceivedSMSCount?.toLocaleString()}
        icon={BarChart3}
      />
      <Stat
        label='Devices'
        caption={
          enabledDevices !== undefined ? `${enabledDevices} enabled` : ''
        }
        value={totalDevices}
        icon={Smartphone}
      />
      <Stat
        label='API keys'
        caption='active'
        value={apiKeys?.length ?? stats?.totalApiKeyCount}
        icon={Key}
      />
    </>
  )
}

export default function Overview() {
  return (
    <div className='space-y-6'>
      <GetStartedCard />
      {/* One panel: quota windows on the left, all-time totals as a 2x2 on
          the right from lg up; stacked above the totals on smaller screens. */}
      <Card>
        <CardContent className='grid grid-cols-2 gap-px overflow-hidden bg-border p-0 lg:grid-flow-row-dense lg:grid-cols-4'>
          <UsageSummary />
          <Totals />
        </CardContent>
        {/* The quota counts every message on the account, inbound and
            outbound: the backend counts SMS documents with no type filter.
            Saying "sent" would understate what actually consumes the limit. */}
        <CardFooter className='px-3 pb-1.5 pt-2'>
          <p className='text-xs text-muted-foreground'>
            Counts messages sent and received against your plan limit.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
