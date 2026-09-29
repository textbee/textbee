'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Smartphone,
  Copy,
  Plus,
  ExternalLink,
  Loader2,
  MoreVertical,
  TriangleAlert,
  ArrowUpCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import { Routes } from '@/config/routes'
import {
  useDeleteDevice,
  useDevices,
  useSetDefaultDevice,
  useSubscription,
} from '@/lib/api'
import EmptyState from '@/components/shared/empty-state'
import ErrorState from '@/components/shared/error-state'
import RelativeTime from '@/components/shared/relative-time'
import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn, formatDeviceName } from '@/lib/utils'
import AddDeviceDialog, { type AddDeviceHandle } from './add-device-dialog'
import {
  DeviceVersionCandidate,
  formatDeviceVersion,
  isDeviceOutdated,
  latestAppVersionLabel,
} from './update-app-helpers'

type DeviceRow = DeviceVersionCandidate & {
  createdAt: string
  enabled?: boolean
}

// Mutation errors arrive as unknown, so both handlers narrow them the same way.
const errorMessage = (err: unknown) =>
  err &&
  typeof err === 'object' &&
  'message' in err &&
  typeof (err as { message: unknown }).message === 'string'
    ? (err as { message: string }).message
    : 'Something went wrong'

export default function DeviceList() {
  const addDeviceRef = useRef<AddDeviceHandle>(null)
  const [devicePendingDelete, setDevicePendingDelete] =
    useState<DeviceRow | null>(null)
  const { toast } = useToast()
  const { isPending, error, data: devices, refetch } = useDevices()

  const { data: currentSubscription } = useSubscription()

  // -1 (or missing) means unlimited; only enabled devices count toward the limit
  const deviceLimit = currentSubscription?.usage?.deviceLimit ?? -1
  const activeDeviceCount =
    devices?.filter((device) => device.enabled).length ?? 0
  const isDeviceLimitReached =
    deviceLimit !== -1 && !isPending && activeDeviceCount >= deviceLimit
  const isApproachingDeviceLimit =
    deviceLimit >= 2 && !isPending && activeDeviceCount === deviceLimit - 1

  const { mutate: deleteDevice, isPending: isDeletingDevice } = useDeleteDevice()
  const { mutate: setDefaultDevice, isPending: isSettingDefaultDevice } =
    useSetDefaultDevice()

  const handleDeleteDevice = (id: string) =>
    deleteDevice(id, {
      onSuccess: () => {
        setDevicePendingDelete(null)
        toast({ title: 'Device removed' })
      },
      onError: (err: unknown) => {
        toast({
          variant: 'destructive',
          title: 'Error removing device',
          description: errorMessage(err),
        })
      },
    })

  const handleSetDefaultDevice = (id: string) =>
    setDefaultDevice(id, {
      onSuccess: () => {
        toast({ title: 'Default device updated' })
      },
      onError: (err: unknown) => {
        toast({
          variant: 'destructive',
          title: 'Error setting default device',
          description: errorMessage(err),
        })
      },
    })

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id)
    toast({
      title: 'Device ID copied to clipboard',
    })
  }

  return (
    <>
      <AddDeviceDialog ref={addDeviceRef} />
      <Card className='min-w-0 max-w-full'>
        <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2'>
          <CardTitle className='whitespace-nowrap text-lg'>
            Registered Devices
            {!isPending && !error && (
              <span className='ml-2 text-sm font-normal text-muted-foreground'>
                {devices?.length ?? 0}
              </span>
            )}
          </CardTitle>
          <Button
            variant='outline'
            size='sm'
            onClick={() => addDeviceRef.current?.open()}
          >
            <Plus className='mr-1 h-4 w-4' />
            Add device
          </Button>
        </CardHeader>
      <CardContent>
          {(isDeviceLimitReached || isApproachingDeviceLimit) && (
            <div
              className={`mb-4 flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                isDeviceLimitReached
                  ? 'border-destructive/30 bg-destructive/10'
                  : 'border-warning/30 bg-warning/10'
              }`}
            >
              <div className='flex items-start gap-2'>
                <TriangleAlert
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    isDeviceLimitReached
                      ? 'text-destructive'
                      : 'text-warning'
                  }`}
                />
                <p className='text-xs text-muted-foreground'>
                  {isDeviceLimitReached ? (
                    <>
                      You've reached your plan's limit of{' '}
                      <span className='font-medium text-foreground'>
                        {deviceLimit} active device{deviceLimit === 1 ? '' : 's'}
                      </span>
                      . New devices can't be registered or re-enabled.
                    </>
                  ) : (
                    <>
                      You're using{' '}
                      <span className='font-medium text-foreground'>
                        {activeDeviceCount} of {deviceLimit}
                      </span>{' '}
                      active devices included in your plan.
                    </>
                  )}
                </p>
              </div>
              {/* The dashboard has no /pricing route: this used to 404. */}
              <Button variant='outline' size='sm' asChild className='shrink-0'>
                <Link
                  href={`${Routes.landingPage}/pricing`}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  Upgrade plan
                </Link>
              </Button>
            </div>
          )}
          <div className='-my-2'>
            {isPending && (
              <>
                {[1, 2, 3].map((i) => (
                  <Card key={i} className='rounded-none border-x-0 border-b-0 border-t bg-transparent p-0 shadow-none first:border-t-0'>
                    <CardContent className='flex items-center rounded-none border-0 bg-transparent px-0 py-3 shadow-none'>
                      <Skeleton className='h-6 w-6 rounded-full mr-3 shrink-0' />
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center justify-between'>
                          <Skeleton className='h-4 w-[120px]' />
                          <Skeleton className='h-4 w-[60px]' />
                        </div>
                        <div className='flex items-center space-x-2 mt-1'>
                          <Skeleton className='h-4 w-[180px]' />
                        </div>
                        <div className='flex items-center mt-1 space-x-3'>
                          <Skeleton className='h-3 w-[200px]' />
                        </div>
                      </div>
                      <Skeleton className='h-6 w-6 shrink-0' />
                    </CardContent>
                  </Card>
                ))}
              </>
            )}

            {error && (
              <ErrorState
                error={error}
                title="Couldn't load your devices"
                icon={Smartphone}
                onRetry={() => refetch()}
              />
            )}

            {!isPending && !error && devices?.length === 0 && (
              <EmptyState
                icon={Smartphone}
                title='No devices found'
                hint='Install the app on your phone and add it as a device to get started.'
              />
            )}

            {devices?.map((device) => (
              <Card key={device._id} className='rounded-none border-x-0 border-b-0 border-t bg-transparent p-0 shadow-none first:border-t-0'>
                <CardContent className='flex items-start gap-3 rounded-none border-0 bg-transparent px-0 py-3 shadow-none'>
                  <span className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/60 text-muted-foreground'>
                    <Smartphone className='h-4 w-4' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <h3
                        className='truncate text-sm font-medium'
                        title={formatDeviceName(device)}
                      >
                        {formatDeviceName(device)}
                      </h3>
                      {device.isDefault && (
                        <TooltipProvider delayDuration={200}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                tabIndex={0}
                                variant='outline'
                                className='shrink-0 cursor-default border-primary/30 bg-primary/10 px-2 py-0 text-[11px] text-primary'
                              >
                                Default
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className='max-w-[220px]'>
                                Sends that do not specify a deviceId go out
                                from this device.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                    {/* No battery or signal indicators: the app does not
                        report either, so they only ever rendered "unknown"
                        and "-" next to a meaningful-looking icon. */}
                    <p className='mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground'>
                      {/* Colour and text come from the same field. */}
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 font-medium',
                          device.enabled ? 'text-success' : 'text-muted-foreground'
                        )}
                      >
                        <span
                          aria-hidden
                          className='h-1.5 w-1.5 rounded-full bg-current'
                        />
                        {device.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        App{' '}
                        {formatDeviceVersion(device as DeviceVersionCandidate) ??
                          'version unknown'}
                      </span>
                      <span aria-hidden>·</span>
                      <span>
                        Registered <RelativeTime value={device.createdAt} />
                      </span>
                    </p>
                    <div className='mt-1.5 flex min-w-0 items-center gap-1'>
                      <code
                        className='truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'
                        title={device._id}
                      >
                        {device._id}
                      </code>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-6 w-6 shrink-0'
                        aria-label='Copy device ID'
                        title='Copy device ID'
                        onClick={() => handleCopyId(device._id)}
                      >
                        <Copy className='h-3 w-3' />
                      </Button>
                    </div>
                    {isDeviceOutdated(device as DeviceVersionCandidate) && (
                      <div className='mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-warning/30 bg-warning/[0.08] px-2.5 py-1.5'>
                        <p className='flex min-w-0 items-center gap-1.5 text-xs text-warning'>
                          <ArrowUpCircle aria-hidden className='h-3.5 w-3.5 shrink-0' />
                          <span>
                            Update available:{' '}
                            <span className='font-medium'>
                              {latestAppVersionLabel}
                            </span>
                          </span>
                        </p>
                        <a
                          href={Routes.downloadAndroidApp}
                          target='_blank'
                          rel='noreferrer'
                          className='shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline'
                        >
                          Update app
                        </a>
                      </div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='h-8 w-8 shrink-0'
                        aria-label='Device actions'
                      >
                        <MoreVertical className='h-4 w-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      {!device.isDefault && device.enabled && (
                        <DropdownMenuItem
                          disabled={isSettingDefaultDevice}
                          onClick={() => handleSetDefaultDevice(device._id)}
                        >
                          Set as default
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className='text-destructive focus:text-destructive'
                        onClick={() =>
                          setDevicePendingDelete(device as DeviceRow)
                        }
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardContent>
              </Card>
            ))}
          </div>
      </CardContent>
      </Card>


      <Dialog
        open={!!devicePendingDelete}
        onOpenChange={(open) => {
          if (!open) setDevicePendingDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this device?</DialogTitle>
            <DialogDescription>
              {devicePendingDelete
                ? `This removes ${formatDeviceName(devicePendingDelete)} from your account. You will not be able to send or receive SMS through it until you register the app again.`
                : 'This removes the device from your account. You will not be able to send or receive SMS through it until you register the app again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setDevicePendingDelete(null)}
              disabled={isDeletingDevice}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() =>
                devicePendingDelete &&
                handleDeleteDevice(devicePendingDelete._id)
              }
              disabled={isDeletingDevice}
            >
              {isDeletingDevice ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
