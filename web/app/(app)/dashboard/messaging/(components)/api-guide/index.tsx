'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ExternalLink,
  KeyRound,
  Smartphone,
  Webhook,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useDevices } from '@/lib/api'
import { formatDeviceName, cn } from '@/lib/utils'
import PackageManagerTabs from '@/components/shared/package-manager-tabs'
import CodeBlock from './code-block'
import {
  API_BASE_URL,
  buildEndpoints,
  LANGUAGES,
  SDK_PACKAGE,
  type LanguageId,
} from './snippets'

// This is a full page, so nothing is collapsed. The previous version rendered
// a collapsed accordion that defaulted to closed, which meant navigating to
// /messaging/api-guide showed an apparently empty page.
export default function ApiGuide() {
  const { data: devices } = useDevices()
  const [language, setLanguage] = useState<LanguageId>('curl')
  const [deviceId, setDeviceId] = useState<string>('')

  const enabledDevices = devices?.filter((d) => d.enabled) ?? []
  const selectedDeviceId =
    deviceId ||
    enabledDevices.find((d) => d.isDefault)?._id ||
    enabledDevices[0]?._id ||
    devices?.[0]?._id ||
    ''
  const hasDevice = Boolean(selectedDeviceId)

  const endpoints = useMemo(
    () => buildEndpoints(selectedDeviceId),
    [selectedDeviceId]
  )

  const highlight =
    LANGUAGES.find((l) => l.id === language)?.highlight ?? 'bash'

  return (
    <div className='space-y-8'>
      {/* Getting started */}
      <section className='space-y-4'>
        <div className='space-y-1'>
          <h3 className='text-lg font-semibold'>Before you start</h3>
          <p className='text-sm text-muted-foreground'>
            Every request needs an API key in the{' '}
            <code className='rounded bg-muted px-1 py-0.5 font-mono text-xs'>
              x-api-key
            </code>{' '}
            header. A device id is optional when sending: leave it out and the
            API uses your default device, or otherwise the enabled device with
            the most recent heartbeat. The read endpoints still name a device.
          </p>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='frame rounded-lg border border-border bg-card p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <KeyRound className='h-4 w-4 text-primary' />
              <p className='text-sm font-medium'>API key</p>
            </div>
            <p className='mb-3 text-xs text-muted-foreground'>
              Keys are shown once, when created. Store yours as an environment
              variable rather than pasting it into source.
            </p>
            <Button asChild variant='outline' size='sm'>
              <Link href='/dashboard'>Manage API keys</Link>
            </Button>
          </div>

          <div className='frame rounded-lg border border-border bg-card p-4'>
            <div className='mb-2 flex items-center gap-2'>
              <Smartphone className='h-4 w-4 text-primary' />
              <p className='text-sm font-medium'>Device</p>
            </div>
            {hasDevice ? (
              <>
                <p className='mb-2 text-xs text-muted-foreground'>
                  Samples below use this device's real id, so they run as soon
                  as you add your key.
                </p>
                <Label htmlFor='api-guide-device' className='sr-only'>
                  Device for code samples
                </Label>
                <Select
                  value={selectedDeviceId}
                  onValueChange={(v) => setDeviceId(v)}
                >
                  <SelectTrigger id='api-guide-device' className='h-8 text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {devices?.map((device) => (
                      <SelectItem key={device._id} value={device._id}>
                        {formatDeviceName(device)}
                        {device.enabled ? '' : ' (disabled)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            ) : (
              <>
                <p className='mb-3 text-xs text-muted-foreground'>
                  Register a device and the samples below will use its real id
                  automatically.
                </p>
                <Button asChild variant='outline' size='sm'>
                  <Link href='/dashboard'>Add a device</Link>
                </Button>
              </>
            )}
          </div>
        </div>

        <div className='space-y-1.5'>
          <p className='text-sm font-medium'>Base URL</p>
          <CodeBlock code={API_BASE_URL} language='bash' />
        </div>

        {!hasDevice && (
          <Alert>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Samples use a placeholder device id</AlertTitle>
            <AlertDescription>
              You have no device registered yet, so the examples show
              YOUR_DEVICE_ID. Register one and they will fill in
              automatically.
            </AlertDescription>
          </Alert>
        )}
      </section>

      {/* Language picker, applies to every endpoint below. */}
      <div className='sticky top-14 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur md:top-0'>
        <div
          className='flex gap-1 overflow-x-auto rounded-lg bg-muted p-1'
          role='tablist'
          aria-label='Code language'
        >
          {LANGUAGES.map((lang) => (
            <button
              key={lang.id}
              type='button'
              role='tab'
              aria-selected={language === lang.id}
              onClick={() => setLanguage(lang.id)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                language === lang.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* One install step for the whole guide, since the language picker above
          is global. Only the SDK needs installing; the REST samples do not. */}
      {language === 'sdk' && (
        <div className='space-y-1.5'>
          <p className='text-sm font-medium'>Install the SDK</p>
          <PackageManagerTabs pkg={SDK_PACKAGE} />
        </div>
      )}

      {/* Endpoints */}
      <div className='space-y-8'>
        {endpoints.map((endpoint) => (
          <section
            key={endpoint.id}
            id={endpoint.id}
            className='scroll-mt-24 space-y-3'
          >
            <div className='space-y-1'>
              <h3 className='text-lg font-semibold'>{endpoint.title}</h3>
              <p className='text-sm text-muted-foreground'>{endpoint.blurb}</p>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <span
                className={cn(
                  'rounded border bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] font-semibold',
                  endpoint.method === 'POST' ? 'text-success' : 'text-foreground'
                )}
              >
                {endpoint.method}
              </span>
              <code className='min-w-0 break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground'>
                {endpoint.path}
              </code>
            </div>

            <CodeBlock
              code={endpoint.samples[language]}
              language={highlight}
            />

            <details className='group'>
              <summary className='cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground'>
                Example response
              </summary>
              <div className='mt-2'>
                <CodeBlock code={endpoint.response} language='json' />
              </div>
            </details>
          </section>
        ))}
      </div>

      {/* Where to go next */}
      <section className='rounded-lg border border-border bg-muted/30 p-4'>
        <h3 className='text-sm font-semibold'>Next steps</h3>
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button asChild variant='outline' size='sm'>
            <Link href='/dashboard/webhooks'>
              <Webhook className='h-3.5 w-3.5' />
              Receive events with webhooks
            </Link>
          </Button>
          <Button asChild variant='outline' size='sm'>
            <a
              href='https://api.textbee.dev/'
              target='_blank'
              rel='noopener noreferrer'
            >
              <ExternalLink className='h-3.5 w-3.5' />
              Full API reference
            </a>
          </Button>
          <Button asChild variant='outline' size='sm'>
            <a
              href='https://www.npmjs.com/package/@textbee/sdk'
              target='_blank'
              rel='noopener noreferrer'
            >
              <ExternalLink className='h-3.5 w-3.5' />
              JavaScript SDK on npm
            </a>
          </Button>
        </div>
      </section>
    </div>
  )
}
