'use client'

import { useId, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Key,
  MoreVertical,
  Loader2,
  Plus,
  AlertTriangle,
  ChevronRight,
  Smartphone,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import {
  useApiKeys,
  useDeleteApiKey,
  useRenameApiKey,
  useRevokeApiKey,
} from '@/lib/api'
import { SIGN_IN_KEY_SOURCE, type ApiKey } from '@/lib/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/shared/empty-state'
import ErrorState from '@/components/shared/error-state'
import RelativeTime from '@/components/shared/relative-time'
import GenerateApiKey, {
  type GenerateApiKeyHandle,
} from './generate-api-key'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatDeviceName } from '@/lib/utils'
import { keyDevicesWarning, lastSeenLabel } from './key-devices'
import { Routes } from '@/config/routes'
import { devicePresence } from '../devices/device-presence'

// Was a local duplicate of the shared ApiKey type, which meant the list
// callback annotated its rows as one type while the hook returned the other.
// The two extra fields it carried now live on ApiKey itself.
type ApiKeyRow = ApiKey

const isSignInKey = (key: ApiKeyRow) => key.source === SIGN_IN_KEY_SOURCE

// The device of a sign-in key, when the server sent one
function linkedDeviceOf(key: ApiKeyRow) {
  const device = key.linkedDevice
  return device && typeof device === 'object' && typeof device._id === 'string'
    ? device
    : undefined
}

// Only an explicit null says the device was deleted; a missing value is unknown
const deviceRemoved = (key: ApiKeyRow) => key.linkedDevice === null

// A phone's name follows its device, not the key
function phoneName(key: ApiKeyRow): string {
  const device = linkedDeviceOf(key)
  const model = [device?.brand, device?.model].filter(Boolean).join(' ')
  return device?.name?.trim() || model || key.name || 'Phone'
}

function PhoneLabel() {
  return (
    <span className='shrink-0 rounded-full border px-1.5 text-[11px] font-medium leading-[18px] text-muted-foreground'>
      Phone
    </span>
  )
}

function GroupHeading({ id, title, line }: { id: string; title: string; line: string }) {
  return (
    <div className='px-2 pt-2 max-md:px-3.5 max-md:py-3'>
      <h3 id={id} className='text-sm font-semibold'>
        {title}
      </h3>
      <p className='text-xs text-muted-foreground'>{line}</p>
    </div>
  )
}

export default function ApiKeys() {
  const addApiKeyRef = useRef<GenerateApiKeyHandle>(null)

  const [selectedKey, setSelectedKey] = useState<ApiKeyRow | null>(null)
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false)
  const [isRevokedModalOpen, setIsRevokedModalOpen] = useState(false)
  const [isConfirmDeleteRevokedOpen, setIsConfirmDeleteRevokedOpen] =
    useState(false)
  const [revokedKeyToDelete, setRevokedKeyToDelete] =
    useState<ApiKeyRow | null>(null)
  const [newKeyName, setNewKeyName] = useState('')
  const [disconnectTarget, setDisconnectTarget] = useState<ApiKeyRow | null>(
    null
  )
  const [removeTarget, setRemoveTarget] = useState<ApiKeyRow | null>(null)
  const [isRemovingOrphan, setIsRemovingOrphan] = useState(false)

  const { toast } = useToast()

  const {
    isPending,
    error,
    data: apiKeys,
    refetch,
  } = useApiKeys('active')

  const { data: revokedKeysData, isPending: isRevokedPending } = useApiKeys(
    'revoked',
    { enabled: isRevokedModalOpen }
  )

  const {
    mutate: revokeApiKey,
    mutateAsync: revokeApiKeyAsync,
    isPending: isRevokingApiKey,
  } = useRevokeApiKey()
  const {
    mutate: deleteRevokedApiKey,
    mutateAsync: deleteApiKeyAsync,
    isPending: isDeletingRevokedApiKey,
  } = useDeleteApiKey()
  const { mutate: renameApiKey, isPending: isRenamingApiKey } =
    useRenameApiKey()

  const handleRevokeApiKey = (id: string) =>
    revokeApiKey(id, {
      onSuccess: () => {
        setIsRevokeDialogOpen(false)
        toast({ title: `API key "${selectedKey?.apiKey}" has been revoked` })
      },
      onError: (err) => {
        toast({
          variant: 'destructive',
          title: 'Error revoking API key',
          description: err?.message,
        })
      },
    })

  const handleDeleteRevokedApiKey = (id: string) =>
    deleteRevokedApiKey(id, {
      onSuccess: () => {
        setIsConfirmDeleteRevokedOpen(false)
        setRevokedKeyToDelete(null)
        toast({ title: 'API key removed' })
      },
      onError: (err) => {
        toast({
          variant: 'destructive',
          title: 'Error deleting API key',
          description: err?.message,
        })
      },
    })

  const handleRenameApiKey = (id: string, name: string) =>
    renameApiKey(
      { id, name },
      {
        onSuccess: () => {
          setIsRenameDialogOpen(false)
          toast({ title: `API key renamed to "${newKeyName}"` })
        },
        onError: (err) => {
          toast({
            variant: 'destructive',
            title: 'Error renaming API key',
            description: err?.message,
          })
        },
      }
    )

  // Revoking a phone's key disconnects the phone; the app then asks to reconnect
  const handleDisconnectPhone = (key: ApiKeyRow) =>
    revokeApiKey(key._id, {
      onSuccess: () => setDisconnectTarget(null),
      onError: (err) => {
        toast({
          variant: 'destructive',
          title: 'Error revoking API key',
          description: err?.message,
        })
      },
    })

  // The key of a deleted device: revoke it if it still works, then remove it
  const handleRemoveOrphanKey = async (key: ApiKeyRow) => {
    if (isRemovingOrphan) return
    setIsRemovingOrphan(true)
    try {
      if (!key.revokedAt) await revokeApiKeyAsync(key._id)
      await deleteApiKeyAsync(key._id)
      setRemoveTarget(null)
      toast({ title: 'API key removed' })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error deleting API key',
        description: (err as Error)?.message,
      })
    } finally {
      setIsRemovingOrphan(false)
    }
  }

  const phoneKeys = apiKeys?.filter(isSignInKey) ?? []
  const ownKeys = apiKeys?.filter((k: ApiKeyRow) => !isSignInKey(k)) ?? []
  // Without a sign-in key the list stays as it always was, with no groups
  const grouped = phoneKeys.length > 0
  const ownGroupId = useId()
  const phoneGroupId = useId()

  const revokedList = revokedKeysData as ApiKeyRow[] | undefined
  // The refetched row while the key is listed, the copy taken on click once it is revoked
  const revokeTarget =
    apiKeys?.find((k: ApiKeyRow) => k._id === selectedKey?._id) ?? selectedKey
  const keyDevices = revokeTarget?.devices ?? []
  const keyDevicesWarningId = useId()
  const revokeDescriptionId = useId()

  // The device warning waits for a fresh key list, since a phone may have connected since the page loaded
  const [deviceCheck, setDeviceCheck] = useState<'pending' | 'failed' | 'done'>(
    'done'
  )
  const deviceCheckRun = useRef(0)
  const checkKeyDevices = () => {
    const run = ++deviceCheckRun.current
    setDeviceCheck('pending')
    refetch().then(
      (result) => {
        if (run === deviceCheckRun.current) {
          setDeviceCheck(result?.isError ? 'failed' : 'done')
        }
      },
      () => {
        if (run === deviceCheckRun.current) setDeviceCheck('failed')
      }
    )
  }
  const showsKeyDevices = deviceCheck === 'done' && keyDevices.length > 0

  const keyRow = (apiKey: ApiKeyRow) => (
    <div
      key={apiKey._id}
      className='flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50 max-md:min-h-16 max-md:items-center max-md:rounded-none max-md:py-2.5 max-md:pl-3.5 max-md:pr-1'
    >
      <Key className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground max-md:mt-0' />
      <div className='min-w-0 flex-1 space-y-1 max-md:space-y-0.5'>
        <div className='flex items-center gap-2'>
          <h3 className='truncate text-sm font-medium'>
            {apiKey.name || 'API Key'}
          </h3>
        </div>
        {/* inline-block so the tinted background hugs the key
            instead of stretching into a full-width bar. */}
        <code className='hidden max-w-full truncate rounded bg-muted px-1.5 py-0.5 align-middle font-mono text-xs text-muted-foreground md:inline-block'>
          {apiKey.apiKey}
        </code>
        <p className='flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground md:hidden'>
          <span className='font-mono'>
            {apiKey.apiKey.slice(0, 8)}…
          </span>
          <span aria-hidden>·</span>
          <span className='truncate'>
            {apiKey?.lastUsedAt && apiKey.usageCount ? (
              <>
                used{' '}
                <RelativeTime value={apiKey.lastUsedAt} compact />
              </>
            ) : (
              'never used'
            )}
          </span>
        </p>
        <p className='hidden text-xs text-muted-foreground md:block'>
          Created <RelativeTime value={apiKey.createdAt} />
          <span className='mx-1.5 opacity-50'>·</span>
          Last used{' '}
          <RelativeTime
            value={
              apiKey?.lastUsedAt && apiKey.usageCount
                ? apiKey.lastUsedAt
                : null
            }
            fallback='never'
          />
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7 shrink-0 max-md:h-11 max-md:w-11'
            aria-label='API key actions'
          >
            <MoreVertical className='h-3.5 w-3.5' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem
            onClick={() => {
              setSelectedKey(apiKey)
              setNewKeyName(apiKey.name || 'API Key')
              setIsRenameDialogOpen(true)
            }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive'
            onClick={() => {
              setSelectedKey(apiKey)
              setIsRevokeDialogOpen(true)
              checkKeyDevices()
            }}
          >
            Revoke
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  const phoneRow = (apiKey: ApiKeyRow) => {
    const device = linkedDeviceOf(apiKey)
    const removed = deviceRemoved(apiKey)
    const name = phoneName(apiKey)
    const model = [device?.brand, device?.model].filter(Boolean).join(' ')
    const online =
      !!device &&
      devicePresence({
        enabled: device.enabled,
        lastHeartbeat: device.lastHeartbeat,
      }) === 'online'
    return (
      <div
        key={apiKey._id}
        className='flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50 max-md:min-h-16 max-md:items-center max-md:rounded-none max-md:py-2.5 max-md:pl-3.5 max-md:pr-1'
      >
        <Smartphone className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground max-md:mt-0' />
        <div className='min-w-0 flex-1 space-y-1 max-md:space-y-0.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <PhoneLabel />
            <h3 className='truncate text-sm font-medium'>
              {removed ? 'Device removed' : name}
            </h3>
          </div>
          {device && (
            <p className='text-xs text-muted-foreground'>
              {model && `${model}. `}
              {online ? (
                'Online'
              ) : device.lastHeartbeat ? (
                <>
                  Last active <RelativeTime value={device.lastHeartbeat} />
                </>
              ) : null}
              {(online || device.lastHeartbeat) && (
                <span className='mx-1.5 opacity-50'>·</span>
              )}
              Connected <RelativeTime value={apiKey.createdAt} />
            </p>
          )}
          <code className='inline-block max-w-full truncate rounded bg-muted px-1 py-px align-middle font-mono text-[11px] text-muted-foreground'>
            {apiKey.apiKey}
          </code>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7 shrink-0 max-md:h-11 max-md:w-11'
              aria-label='API key actions'
            >
              <MoreVertical className='h-3.5 w-3.5' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {!removed ? (
              <>
                {device && (
                  <DropdownMenuItem asChild>
                    <a href={`${Routes.dashboard}#device-${device._id}`}>
                      View device
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className='text-destructive'
                  onClick={() => setDisconnectTarget(apiKey)}
                >
                  Disconnect phone
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem
                className='text-destructive'
                onClick={() => setRemoveTarget(apiKey)}
              >
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <>
      <GenerateApiKey ref={addApiKeyRef} showTrigger={false} />
      {/* Below md the shell is dropped: a compact header row sits above one
          bordered list surface. */}
      <Card className='min-w-0 max-w-full max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0'>
        <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2 max-md:min-h-11 max-md:flex-nowrap max-md:px-1 max-md:py-0'>
          <CardTitle className='whitespace-nowrap text-lg max-md:label-mono'>
            API Keys
            {!isPending && !error && (
              <span className='ml-2 text-sm font-normal text-muted-foreground max-md:ml-1.5 max-md:text-xs'>
                {grouped ? ownKeys.length : (apiKeys?.length ?? 0)}
              </span>
            )}
          </CardTitle>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='hidden h-auto px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground md:inline-flex'
              onClick={() => setIsRevokedModalOpen(true)}
            >
              View revoked keys
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='max-md:-mr-2 max-md:h-11 max-md:border-0 max-md:bg-transparent max-md:px-2 max-md:text-sm max-md:font-semibold max-md:text-primary'
              onClick={() => addApiKeyRef.current?.open()}
            >
              <Plus className='mr-1 h-4 w-4 max-md:mr-0' />
              <span className='md:hidden'>
                New<span className='sr-only'> API key</span>
              </span>
              <span className='hidden md:inline'>Add API key</span>
            </Button>
          </div>
        </CardHeader>
      <CardContent className='max-md:overflow-hidden max-md:rounded-xl max-md:p-0 max-md:shadow-none'>
          <div className='space-y-2 max-md:space-y-0 max-md:divide-y'>
            {isPending && (
              <>
                {/* Mirrors the loaded row, so the list does not resize as it
                    settles. */}
                {[1, 2, 3].map((i) => (
                  <div key={i} className='flex items-start gap-2.5 px-2 py-2 max-md:px-3.5 max-md:py-3'>
                    <Skeleton className='mt-0.5 h-4 w-4 shrink-0 rounded' />
                    <div className='min-w-0 flex-1 space-y-1'>
                      <Skeleton className='h-4 w-28' />
                      <Skeleton className='h-4 w-full max-w-[15rem]' />
                      <Skeleton className='h-3 w-44' />
                    </div>
                    <Skeleton className='h-7 w-7 shrink-0 rounded-md' />
                  </div>
                ))}
              </>
            )}

            {error && (
              <div className='max-md:px-4'>
                <ErrorState
                  error={error}
                  title="Couldn't load your API keys"
                  icon={Key}
                  onRetry={() => refetch()}
                />
              </div>
            )}

            {!isPending && !error && apiKeys?.length === 0 && (
              <div className='max-md:px-4'>
                <EmptyState
                  icon={Key}
                  title='No API keys found'
                  hint='Generate an API key to connect a device or call the API.'
                />
              </div>
            )}

            {/* A plain row, not a nested Card. Each key used to render a Card
                stripped of its border and shadow inside the outer Card, which
                bought markup and padding for no visual result.

                The per-row "Active" badge is gone too: this list only ever
                holds active keys, revoked ones live behind their own dialog,
                so the badge was on every row and distinguished nothing. */}
            {grouped ? (
              <>
                <div
                  role='group'
                  aria-labelledby={ownGroupId}
                  className='space-y-2 max-md:space-y-0 max-md:divide-y'
                >
                  <GroupHeading
                    id={ownGroupId}
                    title='Your API keys'
                    line='For your own code, scripts and integrations.'
                  />
                  {ownKeys.map(keyRow)}
                </div>
                <div
                  role='group'
                  aria-labelledby={phoneGroupId}
                  className='space-y-2 max-md:space-y-0 max-md:divide-y'
                >
                  <GroupHeading
                    id={phoneGroupId}
                    title='Phone connections'
                    line='Made by the textbee app when a phone signs in. Each one works only on its own phone.'
                  />
                  {phoneKeys.map(phoneRow)}
                </div>
              </>
            ) : (
              apiKeys?.map(keyRow)
            )}

            <button
              type='button'
              className='flex min-h-[52px] w-full items-center justify-between pl-3.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50 md:hidden'
              onClick={() => setIsRevokedModalOpen(true)}
            >
              Revoked keys
              <ChevronRight aria-hidden className='h-4 w-4' />
            </button>
          </div>

        {/* Disconnect a phone that signed in */}
        <Dialog
          open={!!disconnectTarget}
          onOpenChange={(open) => {
            if (!open) setDisconnectTarget(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Disconnect {disconnectTarget ? phoneName(disconnectTarget) : ''}?
              </DialogTitle>
              <DialogDescription>
                The textbee app on this phone stops sending and receiving SMS.
                To use the phone again, open the app and tap &quot;Reconnect
                this phone&quot;. Your own API keys are not changed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setDisconnectTarget(null)}
                disabled={isRevokingApiKey}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() =>
                  disconnectTarget && handleDisconnectPhone(disconnectTarget)
                }
                disabled={isRevokingApiKey}
              >
                {isRevokingApiKey ? (
                  <Loader2 className='h-4 w-4 animate-spin mr-2' />
                ) : null}
                Disconnect phone
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove the key of a deleted device */}
        <Dialog
          open={!!removeTarget}
          onOpenChange={(open) => {
            if (!open && !isRemovingOrphan) setRemoveTarget(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove this key?</DialogTitle>
              <DialogDescription>
                This removes the key from your account permanently. This cannot
                be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setRemoveTarget(null)}
                disabled={isRemovingOrphan}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() =>
                  removeTarget && void handleRemoveOrphanKey(removeTarget)
                }
                disabled={isRemovingOrphan}
              >
                {isRemovingOrphan ? (
                  <Loader2 className='h-4 w-4 animate-spin mr-2' />
                ) : null}
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoke Dialog */}
        <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
          <DialogContent
            className='max-h-[85vh] overflow-y-auto'
            {...((showsKeyDevices || deviceCheck !== 'done') && {
              'aria-describedby': `${keyDevicesWarningId} ${revokeDescriptionId}`,
            })}
          >
            <DialogHeader>
              <DialogTitle>Revoke API key?</DialogTitle>
              <DialogDescription id={revokeDescriptionId} className='sr-only'>
                Revoking stops this key from working everywhere it is used.
              </DialogDescription>
            </DialogHeader>
            {deviceCheck === 'pending' && (
              <p
                id={keyDevicesWarningId}
                role='status'
                className='flex items-center gap-2 text-sm text-muted-foreground'
              >
                <Loader2 aria-hidden className='h-4 w-4 shrink-0 animate-spin' />
                Checking which devices use this key...
              </p>
            )}
            {deviceCheck === 'failed' && (
              <Alert variant='destructive'>
                <AlertTriangle className='h-4 w-4' />
                <AlertDescription className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
                  <p id={keyDevicesWarningId}>
                    Could not check which devices use this key. Try again.
                  </p>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-7 shrink-0 px-2 text-xs'
                    onClick={checkKeyDevices}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {showsKeyDevices && (
              <Alert variant='destructive'>
                <AlertTriangle className='h-4 w-4' />
                <AlertDescription>
                  <p id={keyDevicesWarningId} className='font-medium'>
                    {keyDevicesWarning(keyDevices.length)}
                  </p>
                  <ul role='list' className='mt-2 space-y-1 text-xs text-muted-foreground'>
                    {keyDevices.map((device) => (
                      <li key={device._id} className='flex flex-wrap gap-x-1.5'>
                        <span className='break-words font-medium text-foreground [overflow-wrap:anywhere]'>
                          {formatDeviceName(device) || 'Unnamed device'}
                        </span>
                        {lastSeenLabel(device.lastHeartbeat) && (
                          <span>{lastSeenLabel(device.lastHeartbeat)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Revoking immediately stops this key from working everywhere it is
                still used: apps, servers, scripts, devices, and other integrations.
                Create a new API key first if you need one, then update every
                place the old key is stored and reconnect or reconfigure anything
                that depends on it.
              </AlertDescription>
            </Alert>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setIsRevokeDialogOpen(false)}
                disabled={isRevokingApiKey}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() => selectedKey?._id && handleRevokeApiKey(selectedKey._id)}
                disabled={isRevokingApiKey || deviceCheck === 'pending'}
              >
                {isRevokingApiKey ? (
                  <Loader2 className='h-4 w-4 animate-spin mr-2' />
                ) : null}
                Revoke key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Revoked keys list */}
        <Dialog
          open={isRevokedModalOpen}
          onOpenChange={setIsRevokedModalOpen}
        >
          <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
            <DialogHeader>
              <DialogTitle>Revoked API keys</DialogTitle>
              <DialogDescription>
                These keys no longer work. You can remove them from your account
                to tidy your list.
              </DialogDescription>
            </DialogHeader>
            {isRevokedPending && (
              <div className='space-y-2 py-2'>
                <Skeleton className='h-12 w-full' />
                <Skeleton className='h-12 w-full' />
              </div>
            )}
            {!isRevokedPending &&
              (!revokedList || revokedList.length === 0) && (
                <p className='text-sm text-muted-foreground py-4'>
                  No revoked keys.
                </p>
              )}
            {!isRevokedPending &&
              revokedList?.map((k) => (
                <div
                  key={k._id}
                  className='flex items-center justify-between gap-3 rounded-md border p-3'
                >
                  <div className='min-w-0 flex-1'>
                    {isSignInKey(k) ? (
                      <div className='flex min-w-0 items-center gap-2'>
                        <PhoneLabel />
                        <div className='font-medium text-sm truncate'>
                          {k.name || 'API Key'}
                        </div>
                      </div>
                    ) : (
                      <div className='font-medium text-sm truncate'>
                        {k.name || 'API Key'}
                      </div>
                    )}
                    <code className='text-xs text-muted-foreground'>
                      {k.apiKey}
                    </code>
                    <div className='text-xs text-muted-foreground mt-1'>
                      Revoked <RelativeTime value={k.revokedAt} fallback='' />
                    </div>
                  </div>
                  <Button
                    variant='destructive'
                    size='sm'
                    onClick={() => {
                      setRevokedKeyToDelete(k)
                      setIsConfirmDeleteRevokedOpen(true)
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ))}
          </DialogContent>
        </Dialog>

        {/* Confirm delete revoked key */}
        <Dialog
          open={isConfirmDeleteRevokedOpen}
          onOpenChange={(open) => {
            setIsConfirmDeleteRevokedOpen(open)
            if (!open) setRevokedKeyToDelete(null)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove this key?</DialogTitle>
              <DialogDescription>
                This removes the key from your account permanently. It is already
                revoked and cannot be used. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => {
                  setIsConfirmDeleteRevokedOpen(false)
                  setRevokedKeyToDelete(null)
                }}
                disabled={isDeletingRevokedApiKey}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={() =>
                  revokedKeyToDelete &&
                  handleDeleteRevokedApiKey(revokedKeyToDelete._id)
                }
                disabled={isDeletingRevokedApiKey}
              >
                {isDeletingRevokedApiKey ? (
                  <Loader2 className='h-4 w-4 animate-spin mr-2' />
                ) : null}
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog */}
        <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename API Key</DialogTitle>
              <DialogDescription>
                Enter a new name for your API key.
              </DialogDescription>
            </DialogHeader>
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder='Enter new name'
            />
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => setIsRenameDialogOpen(false)}
                disabled={isRenamingApiKey}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  selectedKey &&
                  handleRenameApiKey(selectedKey._id, newKeyName.trim())
                }
                disabled={isRenamingApiKey || !newKeyName?.trim()}
              >
                {isRenamingApiKey ? (
                  <Loader2 className='h-4 w-4 animate-spin mr-2' />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
      </Card>
    </>
  )
}
