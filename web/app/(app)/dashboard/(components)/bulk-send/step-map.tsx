'use client'

import { AlertCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatDeviceName } from '@/lib/utils'
import StepShell from './step-shell'
import type { BulkSendState } from './use-bulk-send'

export default function MapStep({ bulk }: { bulk: BulkSendState }) {
  const {
    columns,
    recipientColumn,
    deviceId,
    setDeviceId,
    simSubscriptionId,
    setSimSubscriptionId,
    devices,
    handleRecipientColumnChange,
    plan,
    availableSims,
    hasFile,
    mapped,
  } = bulk

  return (
    <>
      {/* 2. Map */}
      <StepShell
        step={2}
        title='Choose the phone column and device'
        description='We guess the phone column from your headers'
        locked={!hasFile}
        complete={mapped && Boolean(deviceId)}
      >
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5'>
            <Label htmlFor='recipient-column'>Phone number column</Label>
            <Select
              value={recipientColumn}
              onValueChange={handleRecipientColumnChange}
            >
              <SelectTrigger id='recipient-column'>
                <SelectValue placeholder='Select a column' />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='device-select'>Send from</Label>
            <Select
              value={deviceId ?? ''}
              onValueChange={(v) => {
                setDeviceId(v)
                setSimSubscriptionId(undefined)
              }}
            >
              <SelectTrigger id='device-select'>
                <SelectValue placeholder='Select a device' />
              </SelectTrigger>
              <SelectContent>
                {devices?.map((device) => (
                  <SelectItem
                    key={device._id}
                    value={device._id}
                    disabled={!device.enabled}
                  >
                    {formatDeviceName(device)}
                    {!device.enabled
                      ? ' (disabled)'
                      : device.isDefault
                        ? ' (default)'
                        : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {availableSims.length > 1 && (
            <div className='space-y-1.5'>
              <Label htmlFor='sim-select'>SIM (optional)</Label>
              <Select
                value={simSubscriptionId?.toString() ?? ''}
                onValueChange={(v) =>
                  setSimSubscriptionId(v ? Number(v) : undefined)
                }
              >
                <SelectTrigger id='sim-select'>
                  <SelectValue placeholder='Default SIM' />
                </SelectTrigger>
                <SelectContent>
                  {availableSims.map((sim: any) => (
                    <SelectItem
                      key={sim.subscriptionId}
                      value={String(sim.subscriptionId)}
                    >
                      {sim.displayName || 'SIM'} ({sim.subscriptionId})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {plan.counts && (
          <div className='flex flex-wrap gap-2 text-xs'>
            <span className='rounded-full bg-success/10 px-2.5 py-1 font-medium text-success'>
              {plan.counts.valid.toLocaleString()} will receive a message
            </span>
            {plan.counts.empty > 0 && (
              <span className='rounded-full bg-muted px-2.5 py-1 font-medium text-muted-foreground'>
                {plan.counts.empty} with no number
              </span>
            )}
            {plan.counts.invalid > 0 && (
              <span className='rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning'>
                {plan.counts.invalid} invalid
              </span>
            )}
            {plan.counts.duplicate > 0 && (
              <span className='rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning'>
                {plan.counts.duplicate} duplicate
              </span>
            )}
          </div>
        )}

        {recipientColumn && plan.valid.length === 0 && (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>No usable phone numbers</AlertTitle>
            <AlertDescription>
              No row in "{recipientColumn}" holds a valid phone number. Pick a
              different column.
            </AlertDescription>
          </Alert>
        )}
      </StepShell>

    </>
  )
}
