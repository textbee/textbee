'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
  MessageSquare,
  Reply,
  Smartphone,
} from 'lucide-react'
import { CopyButton } from '@/components/shared/copy-button'
import { getStatusBadge } from './utils'
import { messageDate, messageDirection } from './group'
import {
  simFullLabel,
  simMismatch,
  simName,
  simRequested,
  simSlotMismatch,
} from './sim-label'
import { SimChip } from './sim-chip'
import { toExactLabel } from '@/components/shared/relative-time'
import SmsComposerDialog from './sms-composer-dialog'
import FailureDetails from './failure-details'
import { cn, formatDeviceName } from '@/lib/utils'
import { hasLetters, isPlausiblePhone } from '@/lib/sms'
import { simNumberForSlot } from '@/lib/sim-slots'
import type { Device } from '@/lib/api'
import type { SmsMessage } from './types'

type SmsDetailsDialogProps = {
  message: SmsMessage
  open: boolean
  onOpenChange: (open: boolean) => void
  // The device whose history is open. The messages endpoint populates
  // `device`, but replying must still work if that is ever missing, otherwise
  // the composer opens with no device selected and cannot send.
  fallbackDeviceId?: string
  // Full device from the account list, preferred over the populated copy.
  device?: Device
  // Narrows the history to this message's batch. Omitted, the action is hidden.
  onShowBatch?: (batchId: string) => void
}

// Ordered by what people open this for: the message itself first, then the
// few facts that explain it. Copy actions sit next to the thing they copy,
// rather than a single footer button whose target had to be inferred.
export default function SmsDetailsDialog({
  message,
  open,
  onOpenChange,
  fallbackDeviceId,
  device,
  onShowBatch,
}: SmsDetailsDialogProps) {
  const [isReplyOpen, setIsReplyOpen] = useState(false)
  const [isFollowUpOpen, setIsFollowUpOpen] = useState(false)

  const statusBadge = getStatusBadge(message?.status)
  const isSent = messageDirection(message) === 'sent'
  const counterpartyNumber = isSent
    ? message.recipient || message.recipients?.[0] || ''
    : message.sender || ''
  const counterparty = counterpartyNumber || 'Unknown'
  // A sender name such as "MYBANK" is a label, not an address, so no message
  // can reach it. The check matches the send form, so the composer never opens
  // with a recipient it then rejects.
  const canMessage =
    Boolean(counterpartyNumber) && isPlausiblePhone(counterpartyNumber)
  const date = messageDate(message)
  const composerDeviceId = message.device?._id || fallbackDeviceId
  const deviceSource = device ?? message.device
  const deviceName = deviceSource ? formatDeviceName(deviceSource) : ''
  const sim = simFullLabel(
    message,
    simNumberForSlot(deviceSource?.simNumbers, message.simUsed?.slotIndex)
  )
  const requested = isSent ? simRequested(message) : undefined

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* The dialog is the only scroll container. Capping the message body
            instead put a scrollbar inside a scrollbar, which is easy to miss
            on touch. */}
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-[540px]'>
          {/* text-left overrides the primitive's mobile centring, which left
              the title on the left and the date centred under it. */}
          <DialogHeader className='pr-8 text-left'>
            <DialogTitle className='flex items-center gap-2 text-base'>
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  isSent
                    ? 'bg-primary/10 text-primary'
                    : 'bg-success/10 text-success'
                )}
                aria-hidden
              >
                {isSent ? (
                  <ArrowUpRight className='h-4 w-4' />
                ) : (
                  <ArrowDownLeft className='h-4 w-4' />
                )}
              </span>
              <span className='min-w-0 truncate'>
                {isSent ? 'To' : 'From'} {counterparty}
              </span>
              <CopyButton
                value={counterparty}
                label='Number'
                className='h-7 w-7'
              />
            </DialogTitle>
            {/* Exact time as text: the hover tooltip in the list is not
                reachable on touch. */}
            <DialogDescription>
              {date ? toExactLabel(date) : 'Date unknown'}
            </DialogDescription>
          </DialogHeader>

          {/* The message body leads: it is the reason this dialog is open. */}
          <div className='relative'>
            <div className='whitespace-pre-wrap break-words rounded-lg bg-muted p-3 pr-11 text-sm'>
              {message.message}
            </div>
            <CopyButton
              value={message.message ?? ''}
              label='Message'
              className='absolute right-1.5 top-1.5 h-7 w-7 bg-background/70 backdrop-blur hover:bg-background'
            />
          </div>

          {/* Facts as chips rather than a label/value table: direction and
              number were already in the header, so the table mostly repeated
              itself. */}
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium',
                statusBadge.color
              )}
            >
              {statusBadge.icon}
              {statusBadge.label}
            </span>

            {deviceName && (
              <span
                className='inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground'
                title={deviceName}
              >
                <Smartphone className='h-3 w-3 shrink-0' />
                <span className='sr-only'>Device: </span>
                <span className='truncate'>{deviceName}</span>
              </span>
            )}

            {sim && (
              <SimChip
                message={message}
                text={sim}
                className='gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground'
              />
            )}

            {requested && (
              <span className='inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-muted-foreground'>
                {requested}
              </span>
            )}

            {message.gatewayMessageId && (
              <span className='inline-flex min-w-0 items-center gap-1 rounded-full bg-muted py-0.5 pl-2.5 pr-0.5 text-muted-foreground'>
                <span className='shrink-0'>ID</span>
                <span className='truncate font-mono'>
                  {message.gatewayMessageId}
                </span>
                <CopyButton
                  value={message.gatewayMessageId}
                  label='Gateway ID'
                  className='h-6 w-6'
                />
              </span>
            )}
          </div>

          {simMismatch(message) && (
            <p className='rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground'>
              The request asked for SIM ID {message.simSubscriptionId}, but the
              phone used {simName(message)}. This usually means no SIM in the
              phone has that ID. SIM IDs can change when a SIM is removed,
              reinserted or swapped. Copy the current ID from the SIM Cards
              section of the textbee app.
            </p>
          )}

          {simSlotMismatch(message) && (
            <p className='rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-foreground'>
              The request asked for SIM {(message.simSlotIndex ?? 0) + 1}, but the
              phone used {simName(message)}. This can happen with an older textbee
              app when the SIMs change after the request. Update the textbee app on
              the phone so it sends from the chosen SIM.
            </p>
          )}

          <FailureDetails message={message} />

          {!canMessage && counterpartyNumber && (
            <p className='text-xs text-muted-foreground'>
              {!hasLetters(counterpartyNumber)
                ? `${counterpartyNumber} is not a phone number or short code, so it cannot receive SMS.`
                : isSent
                  ? `${counterpartyNumber} contains letters, so it cannot receive SMS.`
                  : `${counterpartyNumber} is a sender name, not a phone number. Sender names cannot receive SMS.`}
            </p>
          )}

          <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
            {message.smsBatch && onShowBatch && (
              <Button
                size='sm'
                variant='outline'
                className='w-full sm:w-auto'
                onClick={() => {
                  onOpenChange(false)
                  onShowBatch(message.smsBatch as string)
                }}
              >
                <Layers className='h-4 w-4' />
                Messages in this batch
              </Button>
            )}
            {isSent ? (
              <Button
                size='sm'
                className='w-full sm:w-auto'
                disabled={!canMessage}
                onClick={() => {
                  onOpenChange(false)
                  setIsFollowUpOpen(true)
                }}
              >
                <MessageSquare className='h-4 w-4' />
                Follow up
              </Button>
            ) : (
              <Button
                size='sm'
                className='w-full sm:w-auto'
                disabled={!canMessage}
                onClick={() => {
                  onOpenChange(false)
                  setIsReplyOpen(true)
                }}
              >
                <Reply className='h-4 w-4' />
                Reply
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {isReplyOpen && (
        <SmsComposerDialog
          open={isReplyOpen}
          onOpenChange={setIsReplyOpen}
          title={`Reply to ${counterparty}`}
          description='Send a reply to this sender.'
          icon={Reply}
          deviceId={composerDeviceId}
          recipient={message.sender}
          submitLabel='Send reply'
          successTitle='Reply sent'
          errorTitle='Could not send the reply'
        />
      )}
      {isFollowUpOpen && (
        <SmsComposerDialog
          open={isFollowUpOpen}
          onOpenChange={setIsFollowUpOpen}
          title={`Follow up with ${counterparty}`}
          description='Send another message to this recipient.'
          icon={MessageSquare}
          deviceId={composerDeviceId}
          recipient={counterpartyNumber}
          submitLabel='Send follow up'
          successTitle='Follow up sent'
          errorTitle='Could not send the follow up'
        />
      )}
    </>
  )
}
