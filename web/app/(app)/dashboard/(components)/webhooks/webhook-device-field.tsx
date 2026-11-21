'use client'

import type { Control, FieldValues, Path } from 'react-hook-form'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDevices } from '@/lib/api'
import { formatDeviceName } from '@/lib/utils'

// The select has no empty option, so "every device" is this sentinel in the form.
export const ALL_DEVICES = 'all'

// What the API takes for a form value: a device id, or nothing for every device.
export const deviceIdFromForm = (value?: string) =>
  !value || value === ALL_DEVICES ? undefined : value

interface WebhookDeviceFieldProps<T extends FieldValues> {
  control: Control<T>
  name: Path<T>
}

// Lets a webhook be limited to the messages one device handles.
export function WebhookDeviceField<T extends FieldValues>({
  control,
  name,
}: WebhookDeviceFieldProps<T>) {
  const { data: devices = [] } = useDevices()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Device</FormLabel>
          <Select
            value={field.value || ALL_DEVICES}
            onValueChange={field.onChange}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder='All devices' />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value={ALL_DEVICES}>All devices</SelectItem>
              {devices.map((device) => (
                <SelectItem key={device._id} value={device._id}>
                  {formatDeviceName(device)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormDescription>
            Only receive events for messages handled by this device
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
