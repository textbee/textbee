'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  ArrowRight,
  ArrowUpRightIcon,
  KeyRound,
  Plus,
  Send,
  Webhook,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import DeviceList from './(components)/devices/device-list'
import Overview from './(components)/overview'
import ApiKeys from './(components)/api-keys/api-keys'
import GenerateApiKey, {
  type GenerateApiKeyHandle,
} from './(components)/api-keys/generate-api-key'
import AddDeviceDialog, {
  type AddDeviceHandle,
} from './(components)/devices/add-device-dialog'
import { useWebhooks } from '@/lib/api'

// Compact path to webhooks: it left the mobile tab bar and its management
// section moved to /dashboard/webhooks, so Home keeps a discoverable link.
function WebhooksSummaryRow() {
  const { data: webhooks } = useWebhooks()
  const activeCount = webhooks?.filter((w) => w.isActive).length ?? 0

  return (
    <Link
      href='/dashboard/webhooks'
      className='group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50'
    >
      <div className='rounded-full bg-primary/10 p-2'>
        <Webhook className='h-4 w-4 text-primary' />
      </div>
      <div className='min-w-0 flex-1'>
        <p className='text-sm font-medium'>Webhooks</p>
        <p className='truncate text-xs text-muted-foreground'>
          {activeCount > 0
            ? `${activeCount} active webhook${activeCount === 1 ? '' : 's'}`
            : 'Get notified at your endpoints when SMS events happen'}
        </p>
      </div>
      <ArrowRight className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5' />
    </Link>
  )
}

export default function DashboardPage() {
  const { data: session } = useSession()
  const apiKeyFlowRef = useRef<GenerateApiKeyHandle>(null)
  const addDeviceRef = useRef<AddDeviceHandle>(null)

  return (
    <div className='flex-1 space-y-6 p-4 sm:p-6 md:p-8'>
      {/* Two separate flows on purpose. "Add device" walks through installing
          the app and granting permissions before it ever mentions an API key,
          matching the button in the Registered Devices card. "New API key"
          goes straight to key generation, which is what that phrasing asks
          for. Previously both opened the key modal, so a new user who clicked
          Add device was handed an API key with no explanation. */}
      <AddDeviceDialog ref={addDeviceRef} />
      <GenerateApiKey ref={apiKeyFlowRef} showTrigger={false} />

      <div className='flex flex-col gap-4 md:flex-row md:items-end md:justify-between'>
        <div className='space-y-1'>
          <h2 className='text-2xl font-medium tracking-tight'>
            Welcome back, {session?.user?.name?.split(' ')[0] || 'there'}
          </h2>
          <p className='text-sm text-muted-foreground'>
            Here's what's happening with your SMS gateway
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Button asChild size='sm'>
            <Link href='/dashboard/messaging'>
              <Send className='h-4 w-4' />
              Send SMS
            </Link>
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => addDeviceRef.current?.open()}
          >
            <Plus className='h-4 w-4' />
            Add device
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => apiKeyFlowRef.current?.open()}
          >
            <KeyRound className='h-4 w-4' />
            New API key
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => window.open(
                'https://textbee.dev/quickstart',
                '_blank',
                'noopener,noreferrer'
              )}
          >
            <ArrowUpRightIcon className='h-4 w-4' />
            Quick Start
          </Button>
        </div>
      </div>

      <div className='space-y-6'>
        {/* Onboarding, quota usage, then all-time totals. */}
        <Overview />

        <div className='grid gap-6 md:grid-cols-2'>
          <DeviceList />
          <ApiKeys />
        </div>

        <WebhooksSummaryRow />
      </div>
    </div>
  )
}
