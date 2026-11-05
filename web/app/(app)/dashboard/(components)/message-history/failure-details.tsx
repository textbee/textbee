import { smsPermissionGuideUrl } from '@/config/external-links'
import { format } from 'date-fns'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  entryView,
  errorMeta,
  failureView,
  historyHeading,
  timelinePattern,
  type FailureView,
} from './failure-view'
import { messageDate } from './group'
import type { ErrorHistoryEntry, SmsMessage } from './types'

// One timeline of failures and delivery reports. Each entry shows its first
// sentence; tapping it shows the full text and the phone's original text.
function Timeline({
  kind,
  entries,
  reference,
}: {
  kind: FailureView['kind']
  entries: ErrorHistoryEntry[]
  reference: Date | null
}) {
  const pattern = timelinePattern(entries, reference)
  return (
    <div className='space-y-1.5'>
      <p className='text-xs font-medium text-foreground'>{historyHeading(kind, entries)}</p>
      <ol className='space-y-1.5'>
        {entries.map((entry, index) => {
          const view = entryView(entry)
          const expandable = Boolean(view.full || view.deviceText)
          const line = (
            <>
              <span
                aria-hidden
                className={cn(
                  'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                  entry.deliveryReport ? 'bg-muted-foreground/60' : 'bg-destructive'
                )}
              />
              <span className='min-w-0 flex-1'>
                <span className='block break-words font-mono text-[11px] text-muted-foreground'>
                  <time dateTime={entry.at}>{format(new Date(entry.at), pattern)}</time>
                  {view.meta && ` · ${view.meta}`}
                </span>
                {view.summary && (
                  <span className='block break-words text-xs text-foreground'>
                    {view.summary}
                  </span>
                )}
              </span>
            </>
          )
          return (
            <li key={`${entry.source}-${entry.code}-${entry.at}-${index}`}>
              {expandable ? (
                <details className='group'>
                  <summary className='flex cursor-pointer list-none gap-2 rounded-sm [&::-webkit-details-marker]:hidden'>
                    {line}
                    <ChevronRight
                      aria-hidden
                      className='mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90'
                    />
                  </summary>
                  <div className='mt-1 space-y-1 pl-4 text-xs'>
                    {view.full && <p className='break-words text-foreground'>{view.full}</p>}
                    {view.deviceText && (
                      <p className='break-words text-muted-foreground'>
                        Text from the phone: {view.deviceText}
                      </p>
                    )}
                  </div>
                </details>
              ) : (
                <div className='flex gap-2'>{line}</div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// The failure box in the message details: the current failure in red, earlier
// failures of a message that went out after all, or a missing phone report.
export default function FailureDetails({ message }: { message: SmsMessage }) {
  const view = failureView(message)
  if (!view) return null
  const reference = messageDate(message)

  if (view.kind === 'no-report') {
    return (
      <div className='space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3'>
        <p className='text-xs text-foreground'>
          {view.attempts.some((attempt) => attempt.source === 'device')
            ? 'The phone sent no sent or delivered report within 20 minutes.'
            : 'No status report from the phone yet. The phone did not report within 20 minutes.'}
        </p>
        {view.attempts.length > 0 && (
          <Timeline kind={view.kind} entries={view.attempts} reference={reference} />
        )}
      </div>
    )
  }

  if (view.kind === 'delivery-unconfirmed') {
    return (
      <div className='space-y-2 rounded-lg border bg-muted/40 p-3'>
        <p className='text-sm font-medium text-foreground'>Delivery report not confirmed</p>
        <p className='text-xs text-muted-foreground'>
          The message was sent. The carrier did not confirm delivery.
        </p>
        <Timeline kind={view.kind} entries={view.attempts} reference={reference} />
      </div>
    )
  }

  if (view.kind === 'recovered') {
    return (
      <div className='space-y-2 rounded-lg border bg-muted/40 p-3'>
        <Timeline kind={view.kind} entries={view.attempts} reference={reference} />
        {view.capped && (
          <p className='text-xs text-muted-foreground'>
            Only the first 5 and the newest 10 failures are kept.
          </p>
        )}
      </div>
    )
  }

  const meta = errorMeta(view)
  const permissionDenied =
    view.code === 'PERMISSION_DENIED' || view.name === 'PERMISSION_DENIED'

  return (
    <div className='space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3'>
      <p className='text-sm font-medium text-destructive'>Not sent</p>
      {view.message && (
        <p className='break-words text-sm text-foreground'>{view.message}</p>
      )}
      {meta && (
        <p className='break-words font-mono text-xs text-muted-foreground'>{meta}</p>
      )}
      {permissionDenied ? (
        <p className='text-xs text-foreground'>
          The textbee app on this phone does not have SMS permission.{' '}
          <a
            href={smsPermissionGuideUrl('message_details')}
            target='_blank'
            rel='noopener noreferrer'
            className='font-medium underline underline-offset-2'
          >
            How to fix it
          </a>
        </p>
      ) : (
        view.docsUrl && (
          <a
            href={view.docsUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2'
          >
            How to fix this
            <ExternalLink className='h-3 w-3' aria-hidden />
            <span className='sr-only'>(opens in a new tab)</span>
          </a>
        )
      )}
      {view.deviceMessage && (
        <details className='border-t border-destructive/20 pt-2 text-xs text-muted-foreground'>
          <summary className='cursor-pointer'>Text from the phone</summary>
          <p className='mt-1 break-words'>{view.deviceMessage}</p>
        </details>
      )}
      {view.others.length > 0 && (
        <div className='border-t border-destructive/20 pt-2'>
          <Timeline kind={view.kind} entries={view.others} reference={reference} />
        </div>
      )}
    </div>
  )
}
