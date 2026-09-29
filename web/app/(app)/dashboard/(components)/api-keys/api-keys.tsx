'use client'

import { useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Key, MoreVertical, Loader2, Plus, AlertTriangle } from 'lucide-react'
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
import type { ApiKey } from '@/lib/api/types'
import { Skeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/shared/empty-state'
import ErrorState from '@/components/shared/error-state'
import RelativeTime from '@/components/shared/relative-time'
import GenerateApiKey, {
  type GenerateApiKeyHandle,
} from './generate-api-key'
import { Alert, AlertDescription } from '@/components/ui/alert'

// Was a local duplicate of the shared ApiKey type, which meant the list
// callback annotated its rows as one type while the hook returned the other.
// The two extra fields it carried now live on ApiKey itself.
type ApiKeyRow = ApiKey

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

  const { mutate: revokeApiKey, isPending: isRevokingApiKey } = useRevokeApiKey()
  const { mutate: deleteRevokedApiKey, isPending: isDeletingRevokedApiKey } =
    useDeleteApiKey()
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

  const revokedList = revokedKeysData as ApiKeyRow[] | undefined

  return (
    <>
      <GenerateApiKey ref={addApiKeyRef} showTrigger={false} />
      <Card className='min-w-0 max-w-full'>
        <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2'>
          <CardTitle className='whitespace-nowrap text-lg'>
            API Keys
            {!isPending && !error && (
              <span className='ml-2 text-sm font-normal text-muted-foreground'>
                {apiKeys?.length ?? 0}
              </span>
            )}
          </CardTitle>
          <div className='flex items-center gap-1'>
            <Button
              variant='ghost'
              size='sm'
              className='h-auto px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground'
              onClick={() => setIsRevokedModalOpen(true)}
            >
              View revoked keys
            </Button>
            <Button
              variant='outline'
              size='sm'
              onClick={() => addApiKeyRef.current?.open()}
            >
              <Plus className='mr-1 h-4 w-4' />
              Add API key
            </Button>
          </div>
        </CardHeader>
      <CardContent>
          <div className='space-y-2'>
            {isPending && (
              <>
                {/* Mirrors the loaded row, so the list does not resize as it
                    settles. */}
                {[1, 2, 3].map((i) => (
                  <div key={i} className='flex items-start gap-2.5 px-2 py-2'>
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
              <ErrorState
                error={error}
                title="Couldn't load your API keys"
                icon={Key}
                onRetry={() => refetch()}
              />
            )}

            {!isPending && !error && apiKeys?.length === 0 && (
              <EmptyState
                icon={Key}
                title='No API keys found'
                hint='Generate an API key to connect a device or call the API.'
              />
            )}

            {/* A plain row, not a nested Card. Each key used to render a Card
                stripped of its border and shadow inside the outer Card, which
                bought markup and padding for no visual result.

                The per-row "Active" badge is gone too: this list only ever
                holds active keys, revoked ones live behind their own dialog,
                so the badge was on every row and distinguished nothing. */}
            {apiKeys?.map((apiKey: ApiKeyRow) => (
              <div
                key={apiKey._id}
                className='flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50'
              >
                <Key className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0 flex-1 space-y-1'>
                  <div className='flex items-center gap-2'>
                    <h3 className='truncate text-sm font-medium'>
                      {apiKey.name || 'API Key'}
                    </h3>
                  </div>
                  {/* inline-block so the tinted background hugs the key
                      instead of stretching into a full-width bar. */}
                  <code className='inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 align-middle font-mono text-xs text-muted-foreground'>
                    {apiKey.apiKey}
                  </code>
                  <p className='text-xs text-muted-foreground'>
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
                      className='h-7 w-7 shrink-0'
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
                      }}
                    >
                      Revoke
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>

        {/* Revoke Dialog */}
        <Dialog open={isRevokeDialogOpen} onOpenChange={setIsRevokeDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke API key?</DialogTitle>
              <DialogDescription className='sr-only'>
                Revoking stops this key from working everywhere it is used.
              </DialogDescription>
            </DialogHeader>
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Revoking immediately stops this key from working everywhere it is
                still used—apps, servers, scripts, devices, and other integrations.
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
                disabled={isRevokingApiKey}
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
                    <div className='font-medium text-sm truncate'>
                      {k.name || 'API Key'}
                    </div>
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
