'use client'

import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BulkSendState } from './use-bulk-send'

export default function SuccessPanel({ bulk }: { bulk: BulkSendState }) {
  const { plan, resetSend, resetFile, setTemplate } = bulk

  return (
      <div className='frame rounded-lg border border-border bg-card p-8 text-center'>
        <div className='mx-auto mb-3 w-fit rounded-full bg-success/10 p-3'>
          <CheckCircle2 className='h-6 w-6 text-success' />
        </div>
        <h3 className='text-lg font-semibold'>
          {plan.valid.length.toLocaleString()} message
          {plan.valid.length === 1 ? '' : 's'} queued
        </h3>
        <p className='mt-1 text-sm text-muted-foreground'>
          Delivery status appears in your message history as each one is sent.
        </p>
        <div className='mt-5 flex flex-wrap items-center justify-center gap-2'>
          <Button asChild size='sm'>
            <a href='/dashboard/messaging/history'>View message history</a>
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              resetSend()
              resetFile()
              setTemplate('')
            }}
          >
            Send another batch
          </Button>
        </div>
      </div>
    )
}
