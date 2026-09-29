'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useDevices } from '@/lib/api'
import { Download, Sparkles, Smartphone } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Routes } from '@/config/routes'
import { formatDeviceName } from '@/lib/utils'
import {
  DeviceVersionCandidate,
  UPDATE_APP_DONT_ASK_AGAIN_MS,
  UPDATE_APP_REMIND_LATER_MS,
  getOutdatedDevices,
  latestAppVersionLabel,
  setUpdatePromptSnooze,
  summarizeOutdatedDeviceNames,
  useUpdatePromptSnooze,
} from './update-app-helpers'

export default function UpdateAppModal() {
  const [isOpen, setIsOpen] = useState(false)
  const ignoreNextOpenChangeRef = useRef(false)
  const { isSnoozed } = useUpdatePromptSnooze()

  const { data: devices, isLoading, error } = useDevices()

  const outdatedDevices = useMemo(
    () => getOutdatedDevices((devices ?? []) as DeviceVersionCandidate[]),
    [devices]
  )

  const primaryOutdatedDevice = outdatedDevices[0]

  useEffect(() => {
    if (isLoading || error || isSnoozed || outdatedDevices.length === 0) {
      setIsOpen(false)
      return
    }

    if (isOpen) {
      return
    }

    const timer = window.setTimeout(() => {
      setIsOpen(true)
    }, 900)

    return () => window.clearTimeout(timer)
  }, [error, isLoading, isOpen, isSnoozed, outdatedDevices.length])

  const closeWithSnooze = (durationMs: number) => {
    setUpdatePromptSnooze(durationMs)
    ignoreNextOpenChangeRef.current = true
    setIsOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && isOpen) {
      if (ignoreNextOpenChangeRef.current) {
        ignoreNextOpenChangeRef.current = false
      } else {
        setUpdatePromptSnooze(UPDATE_APP_REMIND_LATER_MS)
      }
    }

    setIsOpen(open)
  }

  if (!primaryOutdatedDevice || error) {
    return null
  }

  const deviceSummary = summarizeOutdatedDeviceNames(
    outdatedDevices,
    formatDeviceName
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <div className='mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary'>
            <Smartphone className='h-6 w-6' />
          </div>
          <DialogTitle className='text-center text-2xl'>
            You are using an older version of the textbee mobile app
          </DialogTitle>
          <DialogDescription className='text-center text-sm sm:text-base'>
            <span className='font-medium text-foreground'>{deviceSummary}</span>{' '}
            is ready for an update. Install version {latestAppVersionLabel} to get
            improved reliability, bug fixes, and more.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3 rounded-xl border bg-shell p-4'>
          <div className='flex items-start gap-3'>
            <Sparkles className='mt-0.5 h-4 w-4 text-primary' />
            <div className='space-y-1 text-sm text-muted-foreground'>
              <p className='font-medium text-foreground'>Update highlights</p>
              <p>Improved reliability, bug fixes, and more.</p>
            </div>
          </div>
          <div className='flex items-start gap-3'>
            <Download className='mt-0.5 h-4 w-4 text-primary' />
            <div className='space-y-1 text-sm text-muted-foreground'>
              <p className='font-medium text-foreground'>Recommended action</p>
              <p>Download the latest Android app build and update your device.</p>
            </div>
          </div>
        </div>

        <DialogFooter className='flex-col gap-2 sm:flex-col'>
          <Button asChild className='w-full'>
            <Link href={Routes.downloadAndroidApp}>Update now</Link>
          </Button>
          <div className='flex w-full items-center justify-between gap-2'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => closeWithSnooze(UPDATE_APP_REMIND_LATER_MS)}
              className='text-muted-foreground'
            >
              Remind later
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => closeWithSnooze(UPDATE_APP_DONT_ASK_AGAIN_MS)}
              className='text-muted-foreground hover:text-destructive'
            >
              Don&apos;t ask again
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
