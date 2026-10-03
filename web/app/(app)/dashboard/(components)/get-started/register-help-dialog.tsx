'use client'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink } from 'lucide-react'
import { Routes } from '@/config/routes'

type RegisterHelpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Step-by-step instructions for linking a phone to the account.
export default function RegisterHelpDialog({
  open,
  onOpenChange,
}: RegisterHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Register your device</DialogTitle>
          <DialogDescription>
            Follow these steps to link your phone to your account.
          </DialogDescription>
        </DialogHeader>
        <ol className='mt-2 list-decimal space-y-3 pl-5 text-sm text-muted-foreground'>
          <li>Generate an API key in the step above (if you have not already).</li>
          <li>
            Download the textbee Android app from{' '}
            <a
              href={Routes.downloadAndroidApp}
              target='_blank'
              rel='noreferrer'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              {Routes.downloadAndroidApp}
            </a>
            .
          </li>
          <li>
            In the app, register your device by scanning the QR code shown when
            you generate an API key, or paste the key manually.
          </li>
          <li>
            Allow the SMS permission when the app asks. On Android 15 and newer,
            Android blocks it at first: open App info, tap the menu (⋮), choose
            Allow restricted settings, then allow SMS.
          </li>
          <li>
            Your phone should appear under Registered Devices on this dashboard
            when the link succeeds.
          </li>
        </ol>
        <DialogFooter className='flex flex-col gap-2 sm:flex-row sm:justify-between'>
          <Button variant='outline' size='sm' asChild>
            <a href={Routes.quickstart} target='_blank' rel='noreferrer'>
              View full guide
              <ExternalLink className='ml-1 h-3 w-3' />
            </a>
          </Button>
          <Button size='sm' onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
