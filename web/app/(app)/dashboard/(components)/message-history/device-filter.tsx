'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { badgeVariants } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn, formatDeviceName } from '@/lib/utils'
import type { Device } from '@/lib/api'
import { toggleDeviceSelection } from './device-selection'

// Two names still fit the trigger; past that a count reads better than chips.
const MAX_CHIPS = 2

type DeviceFilterProps = {
  devices: Device[]
  // Empty means every device, including ones registered later.
  value: string[]
  onChange: (deviceIds: string[]) => void
}

const deviceName = (device: Device) =>
  formatDeviceName(device) || 'Unnamed device'

// Badge styling on a span: the Badge component renders a div, which is invalid
// inside the trigger button and inside a command item.
const chipClass = cn(
  badgeVariants({ variant: 'secondary' }),
  'max-w-[7rem] shrink truncate px-1.5 py-0 text-xs font-normal'
)

const tagClass = (variant: 'outline' | 'secondary') =>
  cn(
    badgeVariants({ variant }),
    'ml-auto shrink-0 px-1.5 py-0 text-[11px] font-normal'
  )

export default function DeviceFilter({
  devices,
  value,
  onChange,
}: DeviceFilterProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const allIds = useMemo(() => devices.map((d) => d._id), [devices])
  const selected = useMemo(() => new Set(value), [value])
  const chosen = devices.filter((d) => selected.has(d._id))

  // A selection seeded from a link can name a device that is no longer
  // registered. Counting it is honest; naming it would show the wrong device.
  const allResolved = chosen.length === value.length
  const showChips = value.length > 0 && value.length <= MAX_CHIPS && allResolved

  const triggerLabel = allResolved
    ? chosen.map(deviceName).join(', ')
    : `${value.length} selected`

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setQuery('')
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='outline'
          id='history-device'
          className='h-9 w-full justify-between font-normal sm:w-64'
          aria-label={`Devices: ${value.length === 0 ? 'all devices' : triggerLabel}`}
        >
          <span className='flex min-w-0 items-center gap-1.5'>
            <Smartphone className='h-4 w-4 shrink-0 text-muted-foreground' />
            {value.length === 0 ? (
              <span className='truncate'>All devices</span>
            ) : showChips ? (
              chosen.map((device) => (
                <span key={device._id} className={chipClass}>
                  {deviceName(device)}
                </span>
              ))
            ) : (
              <span className='truncate'>{value.length} devices</span>
            )}
          </span>
          <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
        </Button>
      </PopoverTrigger>

      {/* p-0 overrides the primitive's padding, and the clamp keeps the
          portaled panel inside a phone viewport. */}
      <PopoverContent
        align='start'
        className='w-[min(18rem,calc(100vw-2rem))] p-0'
      >
        <Command>
          <CommandInput
            placeholder='Search devices'
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>No devices match.</CommandEmpty>
            {devices.map((device) => {
              const isSelected = selected.has(device._id)
              return (
                <CommandItem
                  key={device._id}
                  value={device._id}
                  keywords={[deviceName(device)]}
                  className='cursor-pointer [&_svg]:size-3'
                  onSelect={() =>
                    onChange(toggleDeviceSelection(value, device._id, allIds))
                  }
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                      isSelected
                        ? 'border-primary bg-primary text-brand-foreground'
                        : 'border-muted-foreground/40'
                    )}
                  >
                    {isSelected && <Check />}
                  </span>
                  <span className='truncate'>{deviceName(device)}</span>
                  {!device.enabled ? (
                    <span className={tagClass('outline')}>disabled</span>
                  ) : device.isDefault ? (
                    <span className={tagClass('secondary')}>default</span>
                  ) : null}
                  {/* cmdk owns aria-selected for its own highlight, so the
                      checked state is announced here instead. */}
                  <span className='sr-only'>
                    {isSelected ? 'selected' : 'not selected'}
                  </span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>

        {value.length > 0 && (
          <div className='flex items-center justify-between border-t border-border px-2 py-1.5'>
            <span className='text-xs text-muted-foreground'>
              {value.length} selected
            </span>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-7 text-xs'
              onClick={() => onChange([])}
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
