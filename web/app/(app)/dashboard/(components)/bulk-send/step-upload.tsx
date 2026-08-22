'use client'

import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import StepShell from './step-shell'
import { formatFileSize } from './bulk-csv'
import { MAX_FILE_SIZE, PREVIEW_ROWS, SAMPLE_CSV } from './constants'
import type { BulkSendState } from './use-bulk-send'

export default function UploadStep({ bulk }: { bulk: BulkSendState }) {
  const {
    getRootProps,
    getInputProps,
    rows,
    columns,
    fileName,
    fileError,
    fileWarning,
    maxRows,
    resetFile,
    rowCapExceeded,
    recipientCount,
    isDragActive,
    plan,
    hasFile,
  } = bulk

  return (
    <>
      {/* 1. Upload */}
      <StepShell
        step={1}
        title='Upload your CSV'
        description='One row per recipient, with a header row'
        complete={hasFile}
      >
        {hasFile ? (
          <div className='space-y-3'>
            <div className='flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2'>
              <FileSpreadsheet className='h-4 w-4 shrink-0 text-primary' />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>{fileName}</p>
                <p className='text-xs text-muted-foreground'>
                  {rows.length.toLocaleString()} rows, {columns.length} columns
                </p>
              </div>
              <Button
                variant='ghost'
                size='icon'
                onClick={resetFile}
                aria-label='Remove file'
              >
                <X className='h-4 w-4' />
              </Button>
            </div>

            {/* Show what was actually parsed, so a mis-delimited file is
                obvious before anything is sent. */}
            <div className='overflow-x-auto rounded-lg border border-border'>
              <table className='w-full text-left text-xs'>
                <thead className='bg-muted/50'>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className='whitespace-nowrap px-3 py-2 font-medium'>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td
                          key={c}
                          className='whitespace-nowrap px-3 py-1.5 text-muted-foreground'
                        >
                          {row[c] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > PREVIEW_ROWS && (
              <p className='text-xs text-muted-foreground'>
                Showing the first {PREVIEW_ROWS} of{' '}
                {rows.length.toLocaleString()} rows.
              </p>
            )}
          </div>
        ) : (
          <>
            <div
              {...getRootProps()}
              className={cn(
                'cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors sm:p-8',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-muted/30'
              )}
            >
              <input {...getInputProps()} />
              <Upload className='mx-auto h-8 w-8 text-muted-foreground' />
              <p className='mt-2 text-sm font-medium'>
                Drop a CSV here, or tap to choose one
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Up to {formatFileSize(MAX_FILE_SIZE)}
                {maxRows !== undefined && maxRows !== Number.POSITIVE_INFINITY
                  ? ` and ${maxRows.toLocaleString()} rows on your plan`
                  : ''}
              </p>
            </div>

            <a
              href={SAMPLE_CSV}
              download
              className='inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline'
            >
              <Download className='h-3.5 w-3.5' />
              Download a sample CSV
            </a>
          </>
        )}

        {fileError && (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>That file could not be used</AlertTitle>
            <AlertDescription>{fileError}</AlertDescription>
          </Alert>
        )}

        {rowCapExceeded && (
          <Alert variant='destructive'>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>That file is over your plan limit</AlertTitle>
            <AlertDescription>
              It has {recipientCount.toLocaleString()} usable recipient
              {recipientCount === 1 ? '' : 's'} and your plan allows{' '}
              {maxRows!.toLocaleString()} per bulk send. Remove the extra rows,
              split the file into smaller batches, or upgrade your plan.
            </AlertDescription>
          </Alert>
        )}

        {fileWarning && !fileError && (
          <Alert>
            <AlertCircle className='h-4 w-4' />
            <AlertTitle>Some rows did not parse cleanly</AlertTitle>
            <AlertDescription>{fileWarning}</AlertDescription>
          </Alert>
        )}
      </StepShell>

    </>
  )
}
