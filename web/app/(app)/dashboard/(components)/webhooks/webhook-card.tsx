'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DeleteWebhookButton } from './delete-webhook-button'
import { ChevronDown, Edit2, Eye, EyeOff } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { CopyButton } from '@/components/shared/copy-button'
import { WebhookData } from '@/lib/types'
import { useUpdateWebhook } from '@/lib/api'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface WebhookCardProps {
  webhook: WebhookData
  onEdit: () => void
  onDeleted?: () => void
  defaultOpen?: boolean
}

export function WebhookCard({
  webhook,
  onEdit,
  onDeleted,
  defaultOpen = false,
}: WebhookCardProps) {
  const { toast } = useToast()
  const [showSecret, setShowSecret] = useState(false)
  const [open, setOpen] = useState(defaultOpen)

  const { mutate: updateWebhook, isPending: isLoading } = useUpdateWebhook(
    webhook._id
  )

  const handleToggle = (checked: boolean) =>
    updateWebhook(
      { isActive: checked },
      {
        onSuccess: () =>
          toast({
            title: `Webhook ${checked ? 'enabled' : 'disabled'}`,
            description: `Webhook notifications are now ${
              checked ? 'enabled' : 'disabled'
            }.`,
          }),
        onError: () =>
          toast({
            title: 'Error',
            description: `Failed to ${checked ? 'enable' : 'disable'} webhook`,
            variant: 'destructive',
          }),
      }
    )

  const maskSecret = (secret: string) => {
    if (!secret) return ''
    if (secret.length <= 18) {
      return secret.slice(0, 18)
    }
    return secret.slice(0, 18) + '*'.repeat(Math.max(6, secret.length - 24))
  }

  const title = webhook.name?.trim() || 'Webhook Endpoint'
  const eventCount = webhook.events?.length ?? 0

  // Stop the trigger from toggling when interacting with inline actions.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <Collapsible open={open} onOpenChange={setOpen} className='group'>
      <CollapsibleTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors',
            'select-none',
          )}
          role='button'
          aria-expanded={open}
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
          />

          <div className='flex min-w-0 flex-1 items-center gap-2'>
            <span
              className={cn(
                'truncate text-sm font-medium',
                !webhook.isActive && 'text-muted-foreground',
              )}
              title={title}
            >
              {title}
            </span>
            <Badge
              variant={webhook.isActive ? 'default' : 'secondary'}
              className='h-5 shrink-0 px-1.5 text-[11px] uppercase tracking-wide'
            >
              {webhook.isActive ? 'Active' : 'Inactive'}
            </Badge>
            <span
              className='hidden md:inline truncate text-xs font-mono text-muted-foreground'
              title={webhook.deliveryUrl}
            >
              {webhook.deliveryUrl}
            </span>
            <span className='ml-auto hidden sm:inline shrink-0 text-xs text-muted-foreground whitespace-nowrap'>
              {eventCount} {eventCount === 1 ? 'event' : 'events'}
            </span>
          </div>

          <div
            className='flex shrink-0 items-center gap-1.5'
            onClick={stop}
            onPointerDown={stop}
            onKeyDown={stop}
          >
            <Switch
              checked={webhook.isActive}
              onCheckedChange={handleToggle}
              disabled={isLoading}
              aria-label={webhook.isActive ? 'Disable webhook' : 'Enable webhook'}
            />
            <Button
              variant='ghost'
              size='icon'
              className='h-8 w-8'
              onClick={(e) => {
                e.stopPropagation()
                onEdit()
              }}
              aria-label='Edit webhook'
            >
              <Edit2 className='h-4 w-4' />
            </Button>
            <DeleteWebhookButton
              webhookId={webhook._id ?? ''}
              webhookLabel={webhook.name?.trim() || webhook.deliveryUrl}
              onDeleted={onDeleted}
            />
          </div>
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className='border-t bg-muted/20 px-3 py-3'>
          <dl className='grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)]'>
            <dt className='pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              Delivery URL
            </dt>
            <dd className='flex items-center gap-1 min-w-0'>
              <code className='flex-1 min-w-0 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs'>
                {webhook.deliveryUrl}
              </code>
              <CopyButton value={webhook.deliveryUrl} label='Copy URL' />
            </dd>

            <dt className='pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              Signing Secret
            </dt>
            <dd className='flex items-center gap-1 min-w-0'>
              <code className='flex-1 min-w-0 truncate rounded-md bg-background px-2 py-1.5 font-mono text-xs'>
                {showSecret ? webhook.signingSecret : maskSecret(webhook.signingSecret)}
              </code>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 shrink-0'
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Hide signing secret' : 'Show signing secret'}
              >
                {showSecret ? (
                  <EyeOff className='h-4 w-4' />
                ) : (
                  <Eye className='h-4 w-4' />
                )}
              </Button>
              <CopyButton value={webhook.signingSecret} label='Copy Secret' />
            </dd>

            <dt className='pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              Events
            </dt>
            <dd className='flex flex-wrap gap-1.5'>
              {webhook.events.map((event) => (
                <Badge key={event} variant='secondary' className='font-mono text-[11px]'>
                  {event}
                </Badge>
              ))}
            </dd>
          </dl>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
