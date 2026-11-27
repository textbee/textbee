'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
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
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Routes } from '@/config/routes'
import { useDeviceLinkSettings } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  BAD_CODE_TEXT,
  CODE_LENGTH,
  firstTab,
  forgetStaleTab,
  normalizeCode,
  openLinkPage,
  rememberTab,
  serverTab,
  storeTypedCode,
  type AddDeviceTab,
} from '@/lib/device-link'
import CodeInput, { incompleteCodeButtonClass } from '@/components/shared/code-input'
import GenerateApiKey, { type GenerateApiKeyHandle } from '../api-keys/generate-api-key'

export type AddDeviceHandle = {
  open: () => void
}

const linkClass = 'font-medium text-primary underline-offset-4 hover:underline'

/**
 * The full "add a device" flow: what to do first, then the API key and QR.
 *
 * Extracted from device-list so the dashboard quick action can use the same
 * flow. That button opened the key-generation modal directly, which is
 * confusing for a first-time user: it asks them to create an API key when
 * what they wanted was to connect a phone, with no mention of installing the
 * app or granting SMS permissions first.
 *
 * While phone sign-in is on for the account, the dialog has two tabs: the
 * code from the app, and this API key flow unchanged. Otherwise it shows only
 * the API key flow.
 */
const AddDeviceDialog = forwardRef<AddDeviceHandle>(function AddDeviceDialog(
  _props,
  ref
) {
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  // Decided when the dialog opens and kept until it closes
  const [signInOn, setSignInOn] = useState(false)
  const [pickedTab, setPickedTab] = useState<AddDeviceTab | null>(null)
  const apiKeyRef = useRef<GenerateApiKeyHandle>(null)

  // The answer the dashboard already has: until one with enabled: true is
  // there, the dialog is the one of today
  const settings = useDeviceLinkSettings()
  const settingsOn = settings.data?.enabled === true
  const serverDefault = serverTab(settings.data?.defaultTab)

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setSignInOn(settingsOn)
        setInstructionsOpen(true)
      },
    }),
    [settingsOn]
  )

  const tabsShown = instructionsOpen && signInOn

  // Read once per opening; while sign-in is off the stored tab is not touched
  const openingTab = useMemo(
    () => (tabsShown ? firstTab(serverDefault) : serverDefault),
    [tabsShown, serverDefault]
  )
  const tab = pickedTab ?? openingTab

  useEffect(() => {
    if (tabsShown) forgetStaleTab(serverDefault)
  }, [tabsShown, serverDefault])

  const pickTab = (value: string) => {
    const next: AddDeviceTab = value === 'key' ? 'key' : 'code'
    setPickedTab(next)
    rememberTab(next, serverDefault)
  }

  const onOpenChange = (open: boolean) => {
    setInstructionsOpen(open)
    if (!open) setPickedTab(null)
  }

  const continueWithKey = () => {
    onOpenChange(false)
    apiKeyRef.current?.open()
  }

  const apiKeySteps = (
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
  )

  const apiKeyFooter = (
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
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button
          size='sm'
          className='flex-1 sm:flex-none'
          onClick={continueWithKey}
        >
          Continue
        </Button>
      </div>
    </DialogFooter>
  )

  const description =
    'Register a new device by scanning the QR code or pasting the API key.'

  let content
  if (signInOn) {
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Add a device</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={pickTab}>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='code'>Enter code</TabsTrigger>
            <TabsTrigger value='key'>QR code or API key</TabsTrigger>
          </TabsList>
          <TabsContent value='code' className='mt-4'>
            <CodeTab onShowKeyTab={() => pickTab('key')} />
          </TabsContent>
          <TabsContent value='key' className='mt-4 space-y-4'>
            <p className='rounded-lg border px-3 py-2 text-xs text-muted-foreground'>
              New: connect a phone without an API key. Update the textbee app
              to version 2.11.0 or newer, then use Enter code.{' '}
              <span className='inline-flex flex-wrap gap-x-3'>
                <a
                  href={Routes.downloadAndroidApp}
                  target='_blank'
                  rel='noreferrer'
                  className={linkClass}
                >
                  Get the latest app
                </a>
                <button
                  type='button'
                  onClick={() => pickTab('code')}
                  className={linkClass}
                >
                  Enter code
                </button>
              </span>
            </p>
            <p className='text-left text-sm text-muted-foreground'>
              {description}
            </p>
            {apiKeySteps}
            {apiKeyFooter}
          </TabsContent>
        </Tabs>
      </>
    )
  } else {
    content = (
      <>
        <DialogHeader>
          <DialogTitle>Add a device</DialogTitle>
          <DialogDescription className='text-left'>
            {description}
          </DialogDescription>
        </DialogHeader>
        {apiKeySteps}
        {apiKeyFooter}
      </>
    )
  }

  return (
    <>
      <GenerateApiKey ref={apiKeyRef} showTrigger={false} />

      <Dialog open={instructionsOpen} onOpenChange={onOpenChange}>
        <DialogContent
          className='sm:max-w-md'
          {...(signInOn && { 'aria-describedby': undefined })}
        >
          {content}
        </DialogContent>
      </Dialog>
    </>
  )
})

function CodeTab({ onShowKeyTab }: { onShowKeyTab: () => void }) {
  const [chars, setChars] = useState('')
  const [bad, setBad] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const inputId = useId()
  const safetyId = useId()
  const errorId = useId()
  const complete = chars.length === CODE_LENGTH

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (leaving) return
    const code = normalizeCode(chars)
    if (!code) {
      setBad(true)
      return
    }
    setLeaving(true)
    // The page takes the code from session storage, never from the address
    storeTypedCode(code)
    openLinkPage()
  }

  return (
    <div className='space-y-4'>
      <ol className='list-decimal space-y-3 pl-5 text-left text-sm text-muted-foreground'>
        <li>
          Install the textbee app on your phone:{' '}
          <a
            href={Routes.downloadAndroidApp}
            target='_blank'
            rel='noreferrer'
            className={linkClass}
          >
            textbee.dev/download
          </a>
          .
        </li>
        <li>Open the app and tap Sign in with textbee.</li>
        <li>Enter the code that the app shows.</li>
      </ol>
      <form
        onSubmit={submit}
        // Continue is off until the code is complete, so Enter would do
        // nothing; it explains instead
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !complete && !leaving) {
            event.preventDefault()
            setBad(true)
          }
        }}
        noValidate
        className='space-y-2'
      >
        <p id={safetyId} className='text-sm'>
          Use only a code from the textbee app on a phone you have with you. If
          someone sent you a code, do not enter it.
        </p>
        <Label htmlFor={inputId}>Code from the app</Label>
        <CodeInput
          id={inputId}
          chars={chars}
          onChars={(next) => {
            setChars(next)
            setBad(false)
          }}
          invalid={bad}
          describedBy={bad ? `${safetyId} ${errorId}` : safetyId}
          readOnly={leaving}
        />
        {bad && (
          <p id={errorId} role='alert' className='text-sm text-destructive'>
            {BAD_CODE_TEXT}
          </p>
        )}
        <Button
          type='submit'
          className={cn('mt-2 w-full', !complete && incompleteCodeButtonClass)}
          disabled={!complete || leaving}
          aria-busy={leaving}
        >
          Continue
        </Button>
      </form>
      <p className='text-xs text-muted-foreground'>
        Needs app version 2.11.0 or newer. No Sign in with textbee button in
        your app? Use{' '}
        <button type='button' onClick={onShowKeyTab} className={linkClass}>
          QR code or API key
        </button>
        .
      </p>
    </div>
  )
}

export default AddDeviceDialog
