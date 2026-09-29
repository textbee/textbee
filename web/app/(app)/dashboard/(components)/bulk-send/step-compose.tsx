'use client'

import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import StepShell from './step-shell'
import type { BulkSendState } from './use-bulk-send'

export default function ComposeStep({ bulk }: { bulk: BulkSendState }) {
  const {
    columns,
    template,
    setTemplate,
    deviceId,
    setPreviewIndex,
    templateRef,
    plan,
    unknownVariables,
    safePreviewIndex,
    previewRow,
    previewMessage,
    segments,
    mapped,
    composed,
    insertVariable,
  } = bulk

  return (
    <>
      {/* 3. Compose */}
      <StepShell
        step={3}
        title='Write your message'
        description='Insert a column to personalise each message'
        locked={!mapped || !deviceId}
        complete={composed}
      >
        {columns.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {columns.map((c) => (
              <button
                key={c}
                type='button'
                onClick={() => insertVariable(c)}
                className='rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs transition-colors hover:border-primary/50 hover:text-primary'
              >
                {`{{ ${c} }}`}
              </button>
            ))}
          </div>
        )}

        <div className='space-y-1.5'>
          <Label htmlFor='message-template'>Message template</Label>
          <Textarea
            id='message-template'
            ref={templateRef}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            placeholder='Hi {{ name }}, your order {{ order_id }} is confirmed. Total: ${{ total }}. Thanks for shopping with us!'
            className='min-h-28 font-mono text-sm'
          />
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>
              {segments.length} characters, {segments.segments} segment
              {segments.segments === 1 ? '' : 's'} ({segments.encoding})
            </span>
            {segments.segments > 1 && (
              <span className='text-warning'>
                Over {segments.perSegment} characters counts as multiple
                messages
              </span>
            )}
          </div>
        </div>

        {unknownVariables.length > 0 && (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Unknown column reference</AlertTitle>
            <AlertDescription>
              Your CSV has no column named{' '}
              {unknownVariables.map((v) => `"${v}"`).join(', ')}. Those
              placeholders will render as empty text.
            </AlertDescription>
          </Alert>
        )}

        {previewRow && template && (
          <div className='space-y-2 rounded-lg border border-border bg-muted/30 p-3'>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-xs font-medium text-muted-foreground'>
                Preview for {previewRow.raw}
              </p>
              <div className='flex items-center gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6'
                  aria-label='Previous recipient'
                  disabled={safePreviewIndex === 0}
                  onClick={() =>
                    setPreviewIndex(Math.max(0, safePreviewIndex - 1))
                  }
                >
                  <ChevronLeft className='h-3.5 w-3.5' />
                </Button>
                <span className='text-xs tabular-nums text-muted-foreground'>
                  {safePreviewIndex + 1} / {plan.valid.length}
                </span>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6'
                  aria-label='Next recipient'
                  disabled={safePreviewIndex >= plan.valid.length - 1}
                  onClick={() =>
                    setPreviewIndex(
                      Math.min(plan.valid.length - 1, safePreviewIndex + 1)
                    )
                  }
                >
                  <ChevronRight className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>
            <p className='whitespace-pre-wrap text-sm'>{previewMessage}</p>
          </div>
        )}
      </StepShell>

    </>
  )
}
