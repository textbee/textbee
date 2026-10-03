'use client'

import { useState } from 'react'
import QRCode from 'react-qr-code'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/hooks/use-toast'
import { useGenerateApiKey } from '@/lib/api'
import { Routes } from '@/config/routes'
import { Copy, QrCode } from 'lucide-react'
import RegisterHelpDialog from './register-help-dialog'

// Self-serve device registration inside the onboarding step: generate a key
// and scan its QR right here, no dialog hop. The 10s onboarding poll flips the
// step done the moment the device appears.
export default function InlineRegisterPanel() {
  const [helpOpen, setHelpOpen] = useState(false)

  const {
    mutate: generateApiKey,
    isPending,
    data: generated,
  } = useGenerateApiKey()

  const apiKey: string | undefined = generated?.data

  const handleCopy = () => {
    if (!apiKey) return
    navigator.clipboard.writeText(apiKey)
    toast({ title: 'API key copied to clipboard' })
  }

  return (
    <div className='w-full rounded-lg border border-border bg-card p-4'>
      <div className='flex flex-col gap-4 sm:flex-row'>
        <ol className='flex-1 list-decimal space-y-2 pl-5 text-sm text-muted-foreground'>
          <li>
            Install the textbee app on your Android phone from{' '}
            <a
              href={Routes.downloadAndroidApp}
              target='_blank'
              rel='noreferrer'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              textbee.dev/download
            </a>
            .
          </li>
          <li>
            {apiKey
              ? 'Open the app and scan this QR code (or paste the key).'
              : 'Generate a key, then open the app and scan its QR code.'}
          </li>
          <li>
            Allow the SMS permission when the app asks. On Android 15 and newer,
            Android blocks it at first: open App info, tap the menu (⋮), choose
            Allow restricted settings, then allow SMS.
          </li>
        </ol>

        <div className='flex w-full flex-col items-center justify-center gap-3 sm:w-56'>
          {apiKey ? (
            <>
              <div className='rounded-lg bg-white p-3 animate-fade-in'>
                <QRCode value={apiKey} size={132} />
              </div>
              <div className='flex w-full items-center gap-2'>
                <code className='min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs'>
                  {apiKey}
                </code>
                <Button
                  variant='outline'
                  size='icon'
                  className='h-7 w-7 shrink-0'
                  onClick={handleCopy}
                  aria-label='Copy API key'
                >
                  <Copy className='h-3.5 w-3.5' />
                </Button>
              </div>
              <p className='text-center text-[11px] text-muted-foreground'>
                Save this key now; it won't be shown again.
              </p>
            </>
          ) : (
            <Button
              size='sm'
              onClick={() =>
                generateApiKey(undefined, {
                  onError: () =>
                    toast({
                      variant: 'destructive',
                      title: 'Could not generate a key',
                      description: 'Please try again.',
                    }),
                })
              }
              disabled={isPending}
            >
              {isPending ? (
                <Spinner size='sm' className='mr-2' color='white' />
              ) : (
                <QrCode className='mr-2 h-4 w-4' />
              )}
              {isPending ? 'Generating…' : 'Generate key & show QR'}
            </Button>
          )}
        </div>
      </div>

      <div className='mt-3 border-t border-border pt-2 text-right'>
        <button
          type='button'
          onClick={() => setHelpOpen(true)}
          className='text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
        >
          Need help?
        </button>
      </div>

      <RegisterHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
