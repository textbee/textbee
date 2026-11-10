'use client'

import { useId, useState, type FormEvent } from 'react'
import type { AxiosError } from 'axios'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useUpdateSimNumbers, type Device, type SimNumber } from '@/lib/api'
import { formatError } from '@/lib/utils/errorHandler'
import { SIM_NUMBER_ERROR, normalizeSimNumber, simSlots } from '@/lib/sim-slots'

type SimNumbersDialogProps = {
  device?: Device | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// The API puts its reason in `error`; validation errors may use `message`.
const saveErrorMessage = (err: unknown) => {
  const data = (err as AxiosError<{ error?: unknown; message?: unknown }>)?.response?.data
  if (typeof data?.error === 'string' && data.error) return data.error
  if (typeof data?.message === 'string' && data.message) return data.message
  return formatError(err).message
}

export function SimNumbersDialog({ device, open, onOpenChange }: SimNumbersDialogProps) {
  return (
    <Dialog open={open && Boolean(device)} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[420px]'>
        <DialogHeader>
          <DialogTitle>SIM numbers</DialogTitle>
          <DialogDescription>
            Only a label for you. textbee does not check it.
          </DialogDescription>
        </DialogHeader>
        {/* Mounts on open, so the fields start from the saved numbers */}
        {device && (
          <SimNumbersForm
            key={device._id}
            device={device}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function SimNumbersForm({ device, onDone }: { device: Device; onDone: () => void }) {
  const baseId = useId()
  const slots = simSlots(device.simInfo, device.simNumbers)
  const [texts, setTexts] = useState<Record<number, string>>(() =>
    Object.fromEntries(slots.map((s) => [s.slotIndex, s.phoneNumber ?? '']))
  )
  const { mutate, isPending, error } = useUpdateSimNumbers()

  const parsed = slots.map((s) => ({
    slotIndex: s.slotIndex,
    phoneNumber: normalizeSimNumber(texts[s.slotIndex] ?? ''),
  }))
  const invalid = parsed.some((p) => p.phoneNumber === null)

  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // The dialog is portalled, but React still bubbles submit to a parent form
    e.stopPropagation()
    if (invalid || isPending) return
    mutate(
      { id: device._id, simNumbers: parsed as SimNumber[] },
      { onSuccess: onDone }
    )
  }

  return (
    <form onSubmit={save} noValidate className='space-y-4'>
      {slots.map((slot) => {
        const fieldId = `${baseId}-sim-${slot.slotIndex}`
        const fieldInvalid = normalizeSimNumber(texts[slot.slotIndex] ?? '') === null
        return (
          <div key={slot.slotIndex} className='space-y-1.5'>
            <Label htmlFor={fieldId} className='flex items-baseline gap-1.5'>
              SIM {slot.slotIndex + 1}
              {slot.carrier && (
                <span className='text-xs font-normal text-muted-foreground'>
                  {slot.carrier}
                </span>
              )}
            </Label>
            <Input
              id={fieldId}
              type='tel'
              inputMode='tel'
              autoComplete='off'
              placeholder='Phone number (optional)'
              value={texts[slot.slotIndex] ?? ''}
              onChange={(e) =>
                setTexts((prev) => ({ ...prev, [slot.slotIndex]: e.target.value }))
              }
              aria-invalid={fieldInvalid || undefined}
              aria-describedby={fieldInvalid ? `${fieldId}-error` : undefined}
            />
            {fieldInvalid && (
              <p id={`${fieldId}-error`} role='alert' className='text-xs text-destructive'>
                {SIM_NUMBER_ERROR}
              </p>
            )}
          </div>
        )
      })}

      {error && (
        <p role='alert' className='text-sm text-destructive'>
          {saveErrorMessage(error)}
        </p>
      )}

      <DialogFooter className='gap-2 sm:gap-0'>
        <Button type='button' variant='outline' onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button type='submit' disabled={invalid || isPending}>
          {isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          Save
        </Button>
      </DialogFooter>
    </form>
  )
}
