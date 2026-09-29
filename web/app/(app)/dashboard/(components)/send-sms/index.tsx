'use client'

import { useEffect } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { sendSmsSchema, type SendSmsFormData } from '@/lib/schemas'
import { AlertCircle, CheckCircle2, MessageSquare, Send } from 'lucide-react'
import { formatError } from '@/lib/utils/errorHandler'
import { RateLimitError } from '@/components/shared/rate-limit-error'
import { formatDeviceName } from '@/lib/utils'
import { useDevices, useSendSms } from '@/lib/api'
import { getSegmentInfo } from '@/lib/sms'
import RecipientInput from './recipient-input'

export default function SendSms() {
  // Typed hook rather than a raw useQuery(['devices']) reading devices.data:
  // that shared cache key with a different unwrapped shape is what caused the
  // devices?.filter crash previously.
  const { data: devices, isPending: devicesPending } = useDevices()
  const {
    mutate: sendSms,
    isPending: isSendingSms,
    error: sendSmsError,
    isSuccess,
    reset: resetSend,
  } = useSendSms()

  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<SendSmsFormData>({
    resolver: zodResolver(sendSmsSchema),
    defaultValues: { deviceId: undefined, recipients: [], message: '' },
  })

  const recipients = useWatch({ control, name: 'recipients' }) ?? []
  const message = useWatch({ control, name: 'message' }) ?? ''
  const selectedDeviceId = useWatch({ control, name: 'deviceId' })

  const enabledDevices = devices?.filter((device) => device.enabled) ?? []
  // A primitive, so the effect below does not re-run on every render just
  // because filter() returns a new array.
  const soleDeviceId =
    enabledDevices.length === 1 ? enabledDevices[0]._id : undefined
  const preselectedDeviceId =
    enabledDevices.find((d) => d.isDefault)?._id ?? soleDeviceId

  // Preselect the default device, or the only usable one, once devices have
  // loaded. This used to be computed in defaultValues, which react-hook-form
  // reads once on mount while the query is still pending, so the auto-select
  // never actually happened.
  useEffect(() => {
    if (!selectedDeviceId && preselectedDeviceId) {
      setValue('deviceId', preselectedDeviceId)
    }
  }, [selectedDeviceId, preselectedDeviceId, setValue])

  const selectedDevice = devices?.find((d) => d._id === selectedDeviceId)
  const availableSims = Array.isArray((selectedDevice as any)?.simInfo?.sims)
    ? (selectedDevice as any).simInfo.sims
    : []

  const segments = getSegmentInfo(message)

  const onSubmit = (data: SendSmsFormData) =>
    sendSms(data, {
      onSuccess: () => {
        // Reset so the next message starts clean, keeping the chosen device.
        reset({
          deviceId: data.deviceId,
          recipients: [],
          message: '',
        })
      },
    })

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center gap-2'>
          <MessageSquare className='h-5 w-5 text-primary' />
          <CardTitle>Send SMS</CardTitle>
        </div>
        <CardDescription>
          Send a message from one of your connected devices.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className='space-y-5'>
          <div className='space-y-1.5'>
            <Label htmlFor='sms-device'>Send from</Label>
            <Controller
              name='deviceId'
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                  <SelectTrigger id='sms-device'>
                    <SelectValue
                      placeholder={
                        devicesPending ? 'Loading devices...' : 'Select a device'
                      }
                    />
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
              )}
            />
            {errors.deviceId && (
              <p className='text-sm text-destructive'>
                {errors.deviceId.message}
              </p>
            )}
          </div>

          {availableSims.length > 1 && (
            <div className='space-y-1.5'>
              <Label htmlFor='sms-sim'>SIM (optional)</Label>
              <Controller
                name='simSubscriptionId'
                control={control}
                render={({ field }) => (
                  <Select
                    onValueChange={(value) => field.onChange(Number(value))}
                    value={field.value?.toString() ?? ''}
                  >
                    <SelectTrigger id='sms-sim'>
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
                )}
              />
            </div>
          )}

          <Controller
            name='recipients'
            control={control}
            render={({ field }) => (
              <RecipientInput
                recipients={field.value ?? []}
                onChange={field.onChange}
                error={
                  errors.recipients?.message ??
                  errors.recipients?.root?.message ??
                  (Array.isArray(errors.recipients)
                    ? errors.recipients.find(Boolean)?.message
                    : undefined)
                }
              />
            )}
          />

          <div className='space-y-1.5'>
            <Label htmlFor='sms-message'>Message</Label>
            <Textarea
              id='sms-message'
              placeholder='Type your message'
              rows={5}
              {...register('message')}
            />
            <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
              <span>
                {segments.length} characters, {segments.segments} segment
                {segments.segments === 1 ? '' : 's'} ({segments.encoding})
              </span>
              {segments.segments > 1 && (
                <span className='text-warning'>
                  Over {segments.perSegment} characters counts as multiple
                  messages
                </span>
              )}
            </div>
            {errors.message && (
              <p className='text-sm text-destructive'>
                {errors.message.message}
              </p>
            )}
          </div>

          {sendSmsError &&
            (() => {
              const formatted = formatError(sendSmsError)
              if (formatted.isRateLimit) {
                return (
                  <RateLimitError
                    errorData={formatted.rateLimitData}
                    variant='alert'
                  />
                )
              }
              return (
                <Alert variant='destructive'>
                  <AlertCircle className='h-4 w-4' />
                  <AlertTitle>Could not send</AlertTitle>
                  <AlertDescription>{formatted.message}</AlertDescription>
                </Alert>
              )
            })()}

          {isSuccess && (
            <Alert>
              <CheckCircle2 className='h-4 w-4' />
              <AlertTitle>Message sent</AlertTitle>
              <AlertDescription>
                Delivery status appears in your message history.
              </AlertDescription>
            </Alert>
          )}

          <Button
            type='submit'
            className='w-full'
            // Also disabled while devices load: submitting first showed
            // "Required" on the device field, which then auto-filled a moment
            // later, leaving a stale error next to a populated field.
            disabled={isSendingSms || devicesPending}
            onClick={() => {
              // Clear a previous result so the alert reflects this attempt.
              if (isSuccess || sendSmsError) resetSend()
            }}
          >
            {isSendingSms ? (
              <>
                <Spinner size='sm' className='mr-2' color='white' />
                Sending...
              </>
            ) : (
              <>
                <Send className='h-4 w-4' />
                {recipients.length > 1
                  ? `Send to ${recipients.length} recipients`
                  : 'Send message'}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
