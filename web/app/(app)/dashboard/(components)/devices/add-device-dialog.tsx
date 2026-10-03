'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Routes } from '@/config/routes'
import GenerateApiKey, { type GenerateApiKeyHandle } from '../api-keys/generate-api-key'

export type AddDeviceHandle = {
  open: () => void
}

/**
 * The full "add a device" flow: what to do first, then the API key and QR.
 *
 * Extracted from device-list so the dashboard quick action can use the same
 * flow. That button opened the key-generation modal directly, which is
 * confusing for a first-time user: it asks them to create an API key when
 * what they wanted was to connect a phone, with no mention of installing the
 * app or granting SMS permissions first.
 */
const AddDeviceDialog = forwardRef<AddDeviceHandle>(function AddDeviceDialog(
  _props,
  ref
) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const apiKeyRef = useRef<GenerateApiKeyHandle>(null)

  useImperativeHandle(ref, () => ({
    open: () => setInstructionsOpen(true),
  }))

  return (
    <>
      <GenerateApiKey ref={apiKeyRef} showTrigger={false} />

      <Dialog open={instructionsOpen} onOpenChange={setInstructionsOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Add a device</DialogTitle>
            <DialogDescription className='text-left'>
              Register a new device by scanning the QR code or pasting the API
              key.
            </DialogDescription>
          </DialogHeader>
          <ol className='list-decimal space-y-3 pl-5 text-left text-sm text-muted-foreground'>
            <li>
              Download textbee app from{' '}
              <a
                href={Routes.downloadAndroidApp}
                target='_blank'
                rel='noreferrer'
                className='font-medium text-primary underline-offset-4 hover:underline'
              >
                {Routes.downloadAndroidApp}
              </a>
              , and install it.
            </li>
            <li>
              Tap Continue to create a new API key and get a QR code in the next
              dialog. If you already have an active API key, you can paste it in
              the app instead
            </li>
            <li>
              Open the textbee.dev app and scan the QR code or paste the key
              manually. Your device should appear in the list when the link
              succeeds.
            </li>
            <li>
              Allow the SMS permission when the app asks. On Android 15 and
              newer, Android blocks it at first: open App info, tap the menu
              (⋮), choose Allow restricted settings, then allow SMS.
            </li>
          </ol>
          <DialogFooter className='flex-col gap-2 sm:flex-row sm:justify-between'>
            <Button variant='outline' size='sm' asChild>
              <a href={Routes.quickstart} target='_blank' rel='noreferrer'>
                Full guide
                <ExternalLink className='ml-1 h-3 w-3' />
              </a>
            </Button>
            <div className='flex w-full gap-2 sm:w-auto'>
              <Button
                variant='outline'
                size='sm'
                className='flex-1 sm:flex-none'
                onClick={() => setInstructionsOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size='sm'
                className='flex-1 sm:flex-none'
                onClick={() => {
                  setInstructionsOpen(false)
                  apiKeyRef.current?.open()
                }}
              >
                Continue
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

export default AddDeviceDialog
