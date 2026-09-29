'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useDevices } from '@/lib/api'
import { ArrowUpRight, BellRing } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Routes } from '@/config/routes'
import { formatDeviceName } from '@/lib/utils'
import {
  DeviceVersionCandidate,
  getOutdatedDevices,
  latestAppVersionLabel,
  summarizeOutdatedDeviceNames,
} from './update-app-helpers'

export default function UpdateAppNotificationBar() {
  const { data: devices, isLoading, error } = useDevices()

  const outdatedDevices = useMemo(
    () => getOutdatedDevices((devices ?? []) as DeviceVersionCandidate[]),
    [devices]
  )

  const primaryOutdatedDevice = outdatedDevices[0]

  if (isLoading || error || !primaryOutdatedDevice) {
    return null
  }

  const summary = summarizeOutdatedDeviceNames(outdatedDevices, formatDeviceName)
  const verb = outdatedDevices.length > 1 ? 'are' : 'is'

  return (
    <Alert className='sticky top-4 z-20 border-primary/30 bg-card/95 text-foreground shadow-sm backdrop-blur [&>svg]:text-primary'>
      <BellRing className='h-4 w-4 text-primary' />
      <AlertDescription className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div className='pr-2 text-sm'>
          <span className='font-medium'>{summary}</span> {verb} running an older app
          version. Update to version {latestAppVersionLabel} for improved
          reliability, bug fixes, and more.
        </div>
        <Button asChild size='sm' className='w-full md:w-auto shrink-0'>
          <Link href={Routes.downloadAndroidApp}>
            Update app
            <ArrowUpRight className='ml-1 h-4 w-4' />
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  )
}
