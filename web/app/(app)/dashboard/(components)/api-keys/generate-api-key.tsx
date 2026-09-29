import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Routes } from '@/config/routes'
import { useToast } from '@/hooks/use-toast'
import { useGenerateApiKey } from '@/lib/api'
import { QrCode, Copy, Smartphone, Download, AlertTriangle } from 'lucide-react'
import React, { forwardRef, useImperativeHandle, useState } from 'react'
import QRCode from 'react-qr-code'

export type GenerateApiKeyHandle = {
  open: () => void
}

type GenerateApiKeyProps = {
  showTrigger?: boolean
  // Lets a caller say "Generate another API key" where a key already exists.
  triggerLabel?: string
  triggerVariant?: 'default' | 'outline'
}

const GenerateApiKey = forwardRef<GenerateApiKeyHandle, GenerateApiKeyProps>(
  function GenerateApiKey(
    {
      showTrigger = true,
      triggerLabel = 'Generate API Key',
      triggerVariant = 'default',
    },
    ref
  ) {
    const [isGenerateKeyModalOpen, setIsGenerateKeyModalOpen] = useState(false)
    const [isConfirmGenerateKeyModalOpen, setIsConfirmGenerateKeyModalOpen] =
      useState(false)

    const handleConfirmGenerateKey = () => {
      setIsConfirmGenerateKeyModalOpen(true)
    }

    useImperativeHandle(ref, () => ({
      open: () => setIsConfirmGenerateKeyModalOpen(true),
    }))

    const {
      isPending: isGeneratingApiKey,
      mutateAsync: generateApiKeyMutation,
      data: generatedApiKey,
    } = useGenerateApiKey()

    const generateApiKey = () =>
      generateApiKeyMutation(undefined, {
        onSuccess: () => {
          setIsConfirmGenerateKeyModalOpen(false)
          setIsGenerateKeyModalOpen(true)
        },
      })

    const { toast } = useToast()

    const handleCopyKey = () => {
      if (!generatedApiKey?.data) return
      navigator.clipboard.writeText(generatedApiKey.data)
      toast({
        title: 'API key copied to clipboard',
      })
    }

    return (
      <>
        {showTrigger ? (
          <Button variant={triggerVariant} onClick={handleConfirmGenerateKey}>
            <QrCode className='mr-2 h-4 w-4' />
            {triggerLabel}
          </Button>
        ) : null}

        <Dialog
          open={isConfirmGenerateKeyModalOpen}
          onOpenChange={setIsConfirmGenerateKeyModalOpen}
        >
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>Create new API Key</DialogTitle>
              <DialogDescription>
                By clicking generate, you will be able to view your API key.
                Make sure to save it before closing the modal as you will not be
                able to view it again.
              </DialogDescription>
            </DialogHeader>
            <div className='flex flex-col space-y-4'>
              <Button
                onClick={() => generateApiKey()}
                disabled={isGeneratingApiKey}
              >
                {isGeneratingApiKey ? (
                  <div className='flex justify-center items-center h-full'>
                    <Spinner size='sm' className='text-primary-foreground' />
                  </div>
                ) : (
                  'Generate API Key'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={isGenerateKeyModalOpen}
          onOpenChange={setIsGenerateKeyModalOpen}
        >
          <DialogContent className='sm:max-w-lg'>
            <DialogHeader>
              <DialogTitle>Your API Key</DialogTitle>
              <DialogDescription>
                Use this API key to connect your device or authenticate your
                service.
              </DialogDescription>
            </DialogHeader>

            <div className='space-y-6'>
              <div className='flex justify-center p-4 bg-muted dark:bg-white rounded-lg '>
                {generatedApiKey?.data && (
                  <QRCode value={generatedApiKey?.data} size={120} />
                )}
              </div>

              <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                  <code className='relative rounded bg-muted px-[0.5rem] py-[0.3rem] font-mono text-sm flex-1'>
                    {generatedApiKey?.data}
                  </code>
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label='Copy API key'
                    title='Copy API key'
                    onClick={handleCopyKey}
                  >
                    <Copy className='h-4 w-4' />
                  </Button>
                </div>
              </div>

              <div className='space-y-4 text-sm'>
                <div className='space-y-2'>
                  <h4 className='font-medium flex items-center gap-2'>
                    <Smartphone className='h-4 w-4' />
                    For Device Registration
                  </h4>
                  <p className='text-muted-foreground'>
                    Open the textbee app and scan the QR code, or manually enter
                    the API key in the app and click register/update.
                  </p>
                </div>

                <div className='space-y-2'>
                  <h4 className='font-medium flex items-center gap-2'>
                    <Download className='h-4 w-4' />
                    Don&apos;t have the app?
                  </h4>
                  <p className='text-muted-foreground'>
                    Download the APK from{' '}
                    <a
                      href={Routes.downloadAndroidApp}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-primary hover:underline'
                    >
                      {Routes.downloadAndroidApp}
                    </a>{' '}
                    and install it.
                  </p>
                </div>

                <div className='space-y-2'>
                  <h4 className='font-medium'>For External Services</h4>
                  <p className='text-muted-foreground'>
                    Copy the API key and store it securely for authenticating your
                    external service with textbee.
                  </p>
                </div>

                <div className='rounded-md bg-warning/10 p-3 mt-4'>
                  <div className='flex items-center gap-2 text-warning'>
                    <AlertTriangle className='h-4 w-4' />
                    <p className='text-sm font-medium'>Important</p>
                  </div>
                  <p className='mt-2 text-sm text-warning'>
                    Once you close this modal, you will not be able to view your
                    API key again. Make sure to save it before closing.
                  </p>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  },
)

export default GenerateApiKey
