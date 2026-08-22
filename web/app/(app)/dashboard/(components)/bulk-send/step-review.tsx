'use client'

import { AlertCircle, Clock, Send } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { RateLimitError } from '@/components/shared/rate-limit-error'
import { formatError } from '@/lib/utils/errorHandler'
import { formatDeviceName } from '@/lib/utils'
import StepShell from './step-shell'
import { formatSendDuration } from './bulk-csv'
import { REASON_LABEL } from './constants'
import type { BulkSendState } from './use-bulk-send'

export default function ReviewStep({ bulk }: { bulk: BulkSendState }) {
  const {
    plan,
    selectedDevice,
    composed,
    sendBulk,
    isSending,
    sendError,
    recipientCount,
    estimatedSendMs,
    overWarnThreshold,
  } = bulk

  return (
    <>
      {/* 4. Review and send */}
      <StepShell
        step={4}
        title='Review and send'
        description='Nothing is sent until you confirm'
        locked={!composed}
      >
        <div className='rounded-lg border border-border bg-muted/30 p-3 text-sm'>
          <p>
            Sending{' '}
            <strong>{plan.valid.length.toLocaleString()} messages</strong> from{' '}
            <strong>
              {selectedDevice ? formatDeviceName(selectedDevice) : 'your device'}
            </strong>
            .
          </p>
          {plan.excluded.length > 0 && (
            <details className='mt-2'>
              <summary className='cursor-pointer text-xs text-muted-foreground hover:text-foreground'>
                {plan.excluded.length} row
                {plan.excluded.length === 1 ? '' : 's'} skipped
              </summary>
              <ul className='mt-2 space-y-1 text-xs text-muted-foreground'>
                {plan.excluded.slice(0, 10).map((row) => (
                  <li key={`${row.rowNumber}-${row.reason}`}>
                    Row {row.rowNumber}
                    {row.raw ? ` ("${row.raw}")` : ''}:{' '}
                    {REASON_LABEL[row.reason]}
                  </li>
                ))}
                {plan.excluded.length > 10 && (
                  <li>and {plan.excluded.length - 10} more</li>
                )}
              </ul>
            </details>
          )}
        </div>

        {/* Product physics, not a limit: the phone is the bottleneck, so a
            large batch is quoted in time before it is started. Advisory only,
            the send is never blocked. */}
        {overWarnThreshold && (
          <Alert>
            <Clock className='h-4 w-4' />
            <AlertTitle>This is a large send</AlertTitle>
            <AlertDescription>
              Your phone sends these one at a time, so{' '}
              {recipientCount.toLocaleString()} messages will take{' '}
              {formatSendDuration(estimatedSendMs)} to go out. Keep the phone
              awake, on power, and on a stable connection until it finishes. You
              can watch progress on the messages page.
            </AlertDescription>
          </Alert>
        )}

        {sendError &&
          (() => {
            const formatted = formatError(sendError)
            if (formatted.isRateLimit) {
              return (
                <RateLimitError
                  errorData={formatted.rateLimitData}
                  variant='alert'
                />
              )
            }
            return (
              <Alert variant='destructive'>
                <AlertCircle className='h-4 w-4' />
                <AlertTitle>Could not send</AlertTitle>
                <AlertDescription>{formatted.message}</AlertDescription>
              </Alert>
            )
          })()}

        <Button
          className='w-full'
          disabled={!composed || isSending || plan.valid.length === 0}
          onClick={() => sendBulk()}
        >
          {isSending ? (
            <>
              <Spinner size='sm' className='mr-2 text-white dark:text-black' />
              Sending...
            </>
          ) : (
            <>
              <Send className='mr-2 h-4 w-4' />
              Send {plan.valid.length.toLocaleString()} message
              {plan.valid.length === 1 ? '' : 's'}
            </>
          )}
        </Button>
      </StepShell>
    </>
  )
}
