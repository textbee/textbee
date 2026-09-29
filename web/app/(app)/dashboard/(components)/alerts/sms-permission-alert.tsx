'use client'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { smsPermissionGuideUrl } from '@/config/external-links'
import { useSmsPermissionStatus } from '@/lib/api'
import { BookOpen, ShieldAlert } from 'lucide-react'
import Link from 'next/link'

export default function SmsPermissionAlert() {
  const { data: status } = useSmsPermissionStatus()

  if (status?.needsSmsPermission !== true) {
    return null
  }

  const phone = status.deviceName ? ` on ${status.deviceName}` : ''

  return (
    <Alert className='border-destructive/30 bg-destructive/5 text-foreground'>
      <AlertDescription className='flex flex-col sm:flex-row flex-wrap items-center gap-2 md:gap-4'>
        <span className='w-full sm:flex-1 text-center sm:text-left text-sm md:text-base flex items-start justify-center sm:justify-start gap-2'>
          <ShieldAlert className='h-5 w-5 shrink-0 text-destructive mt-0.5' />
          <span>
            <span className='font-medium'>Your phone cannot send SMS.</span>{' '}
            The textbee app{phone} does not have SMS permission, so your last
            message failed. Open Settings &gt; Apps &gt; textbee &gt;
            Permissions and set SMS to Allow. On Android 15 and 16, tap the menu
            (⋮) and choose Allow restricted settings first.
          </span>
        </span>
        <div className='w-full sm:w-auto mt-2 sm:mt-0 flex flex-wrap justify-center sm:justify-end gap-2'>
          <Button variant='default' size='sm' asChild>
            <Link
              href={smsPermissionGuideUrl('dashboard')}
              target='_blank'
              rel='noopener noreferrer'
            >
              <BookOpen className='mr-2 h-4 w-4' />
              Show me how
            </Link>
          </Button>
          <Button variant='outline' size='sm' asChild>
            <Link href='/dashboard/messaging/history'>View messages</Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
