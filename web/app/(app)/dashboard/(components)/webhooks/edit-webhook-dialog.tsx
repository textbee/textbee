'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import * as z from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { WebhookData } from '@/lib/types'
import { WEBHOOK_EVENTS } from '@/lib/constants'
import { useToast } from '@/hooks/use-toast'
import { useUpdateWebhook } from '@/lib/api'
import { apiErrorMessage } from '@/lib/utils/errorHandler'
import {
  ALL_DEVICES,
  WebhookDeviceField,
  deviceIdFromForm,
} from './webhook-device-field'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const formSchema = z.object({
  name: z
    .string()
    .max(64, { message: 'Name must be 64 characters or fewer' })
    .optional(),
  deliveryUrl: z.string().url({ message: 'Please enter a valid URL' }),
  events: z.array(z.string()).min(1, { message: 'Select at least one event' }),
  deviceId: z.string().optional(),
  isActive: z.boolean().default(true),
  signingSecret: z.string().min(1, { message: 'Signing secret is required' }),
})

// isActive is `.default(true)`, so zod's input type has it optional while the
// output type has it guaranteed. The form holds the input shape; the submit
// handler receives the output shape.
type WebhookFormInput = z.input<typeof formSchema>
type WebhookFormValues = z.output<typeof formSchema>

interface EditWebhookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  webhook: WebhookData
}

export function EditWebhookDialog({
  open,
  onOpenChange,
  webhook,
}: EditWebhookDialogProps) {
  const { toast } = useToast()

  const form = useForm<WebhookFormInput, unknown, WebhookFormValues>({
    resolver: zodResolver(formSchema),
    values: {
      name: webhook.name ?? '',
      deliveryUrl: webhook.deliveryUrl,
      events: webhook.events,
      deviceId: webhook.deviceId ?? ALL_DEVICES,
      isActive: webhook.isActive,
      signingSecret: webhook.signingSecret,
    },
  })

  const { mutate: updateWebhook, isPending } = useUpdateWebhook(webhook._id)

  const onSubmit = (values: WebhookFormValues) => {
    const payload = {
      ...values,
      name: values.name?.trim() ? values.name.trim() : '',
      // null tells the API to stop limiting the webhook to a device.
      deviceId: deviceIdFromForm(values.deviceId) ?? null,
    }
    updateWebhook(payload, {
      onSuccess: () => {
        toast({
          title: 'Success',
          description: 'Webhook updated successfully',
        })
        onOpenChange(false)
      },
      onError: (error) => {
        toast({
          title: 'Error',
          description: apiErrorMessage(error) || 'Failed to update webhook',
          variant: 'destructive',
        })
      },
    })
  }

  const message_events = [
    'MESSAGE_RECEIVED',
    'MESSAGE_SENT',
    'MESSAGE_DELIVERED',
    'MESSAGE_FAILED',
    
    // TODO: handle these events better in the future
    // 'UNKNOWN_STATE',
    // 'SMS_STATUS_UPDATED',
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>Edit Webhook</DialogTitle>
          <DialogDescription>
            Update your webhook configuration.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name (optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='e.g. Production CRM'
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>
                    A short label to help you tell your webhooks apart
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='deliveryUrl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Delivery URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://api.example.com/webhooks'
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The URL where webhook notifications will be sent via POST
                    requests
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='signingSecret'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Signing Secret</FormLabel>
                  <FormControl>
                    <div className='flex space-x-2'>
                      <Input {...field} type='text' />
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => field.onChange(uuidv4())}
                      >
                        Generate
                      </Button>
                    </div>
                  </FormControl>
                  <FormDescription>
                    Used to verify webhook payload authenticity
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='events'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Events</FormLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <FormControl>
                        <Button
                          variant='outline'
                          className='w-full justify-between'
                        >
                          {field.value && field.value.length > 0
                            ? `${field.value.length} events selected`
                            : 'Select events to subscribe to'}
                        </Button>
                      </FormControl>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className='w-full'>
                      {message_events.map((event) => (
                        <DropdownMenuCheckboxItem
                          key={event}
                          checked={field.value?.includes(event) || false}
                          onCheckedChange={(checked) => {
                            const currentValues = field.value || []
                            const newValues = checked
                              ? [...currentValues, event]
                              : currentValues.filter((v: string) => v !== event)
                            field.onChange(newValues)
                          }}
                          // 👇 prevent menu from closing
                          onSelect={(e) => e.preventDefault()}
                        >
                          {event}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <FormDescription>
                    Choose the events you want to receive notifications for
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <WebhookDeviceField control={form.control} name='deviceId' />
            <div className='flex justify-end space-x-2'>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type='submit' disabled={isPending}>
                {isPending ? 'Updating...' : 'Update'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}