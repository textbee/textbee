'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import Papa from 'papaparse'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import httpBrowserClient from '@/lib/httpBrowserClient'
import { ApiEndpoints } from '@/config/api'
import { invalidateAfterSend, useDevices, useSubscription } from '@/lib/api'
import { getSegmentInfo } from '@/lib/sms'
import {
  buildRecipientPlan,
  detectRecipientColumn,
  extractTemplateVariables,
  formatFileSize,
  findUnknownVariables,
  renderTemplate,
  type CsvRow,
} from './bulk-csv'
import {
  BULK_RECIPIENT_WARN_THRESHOLD,
  DEFAULT_SEND_DELAY_SECONDS,
  FALLBACK_MAX_ROWS,
  MAX_FILE_SIZE,
} from './constants'

// All bulk-send state in one place, mirroring get-started/use-onboarding.
// The steps are presentation only and read this through a single prop.
export function useBulkSend() {
  const [rows, setRows] = useState<CsvRow[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [recipientColumn, setRecipientColumn] = useState('')
  const [template, setTemplate] = useState('')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [simSubscriptionId, setSimSubscriptionId] = useState<number>()
  const [previewIndex, setPreviewIndex] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileWarning, setFileWarning] = useState<string | null>(null)
  const templateRef = useRef<HTMLTextAreaElement>(null)

  const queryClient = useQueryClient()
  const { data: devices } = useDevices()
  const { data: subscription, isPending: subscriptionPending } =
    useSubscription()

  // Only enforce a row cap once the real limit is known. The old version
  // defaulted to 50 while the subscription was still loading, so an unlimited
  // plan could be told its file was too big.
  const maxRows = useMemo(() => {
    const limit =
      subscription?.usage?.bulkSendLimit ?? subscription?.plan?.bulkSendLimit
    if (subscriptionPending) return undefined
    if (limit === -1) return Number.POSITIVE_INFINITY
    return limit || FALLBACK_MAX_ROWS
  }, [subscription, subscriptionPending])

  const resetFile = () => {
    setRows([])
    setColumns([])
    setFileName(null)
    setRecipientColumn('')
    setPreviewIndex(0)
    setFileWarning(null)
  }

  const rowCapUnknown = rows.length > 0 && maxRows === undefined

  const handleRecipientColumnChange = (value: string) => {
    setRecipientColumn(value)
    // plan.valid is rebuilt from the new column, so an index into the old
    // list can point past the end of the new one.
    setPreviewIndex(0)
  }

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    const file = accepted[0]

    // react-dropzone still calls onDrop when every file was filtered out by
    // `accept`, so returning silently here left a rejected drop with no
    // feedback at all: nothing happened and nothing said why.
    if (!file) {
      const rejected = rejections[0]
      if (rejected) {
        setFileError(
          rejections.length > 1
            ? 'Please drop a single CSV file.'
            : `"${rejected.file.name}" is not a CSV. Export your spreadsheet as CSV and try again.`
        )
      }
      return
    }

    if (file.size > MAX_FILE_SIZE) {
      setFileError(
        `That file is ${formatFileSize(file.size)}. The limit is ${formatFileSize(MAX_FILE_SIZE)}.`
      )
      return
    }

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = (results.data ?? []).filter(Boolean)

        if (parsed.length === 0) {
          setFileError('That file has no rows. Check it has a header row.')
          resetFile()
          return
        }

        // Take the header papaparse actually parsed. Reading keys off the
        // first data row instead loses every column that row happened to
        // leave blank, because papaparse only assigns keys for values that
        // are present.
        const headers = (results.meta?.fields ?? []).filter(Boolean)

        if (headers.length === 0) {
          setFileError('That file has no header row, so columns cannot be mapped.')
          resetFile()
          return
        }

        setRows(parsed)
        setColumns(headers)
        setFileName(file.name)
        setRecipientColumn(detectRecipientColumn(headers) ?? '')
        setPreviewIndex(0)
        setFileError(null)

        // Row-level problems are reported here, not through `error`, which
        // only fires on a fatal stream failure. A mis-delimited file parses
        // "successfully" into one mangled column, so this is worth saying.
        const problems = results.errors ?? []
        setFileWarning(
          problems.length > 0
            ? `${problems.length} row${problems.length === 1 ? '' : 's'} did not parse cleanly (first problem on row ${
                (problems[0].row ?? 0) + 1
              }: ${problems[0].message}). Check the delimiter and quoting if the columns below look wrong.`
            : null
        )
      },
      error: () => setFileError('That file could not be read as CSV.'),
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'] },
    multiple: false,
  })

  const plan = useMemo(
    () =>
      recipientColumn
        ? buildRecipientPlan(rows, recipientColumn)
        : { valid: [], excluded: [], counts: null },
    [rows, recipientColumn]
  )

  const unknownVariables = useMemo(
    () => findUnknownVariables(template, columns),
    [template, columns]
  )

  // The number that is actually sent, after blanks, invalid numbers, and
  // duplicates are dropped. The plan cap is measured against this rather than
  // the raw row count: a 60-row file with 15 unusable rows is 45 recipients,
  // and charging the user for rows that are never sent blocked legal sends.
  const recipientCount = plan.valid.length

  // Derived rather than checked once at drop time. The subscription can still
  // be loading when a file lands, in which case maxRows is undefined and the
  // old imperative check was skipped entirely and never revisited, so an
  // over-cap file sailed through on a limited plan.
  const rowCapExceeded = maxRows !== undefined && recipientCount > maxRows

  const selectedDevice = devices?.find((d) => d._id === deviceId)
  const availableSims = Array.isArray((selectedDevice as any)?.simInfo?.sims)
    ? (selectedDevice as any).simInfo.sims
    : []

  // A phone sends one message at a time with a configurable pause between
  // each, so a batch takes as long as the pacing says it will. The device
  // already reports its own delay, so this is the real figure, not a guess.
  const sendDelaySeconds =
    (selectedDevice as any)?.smsSendDelaySeconds || DEFAULT_SEND_DELAY_SECONDS
  const estimatedSendMs = recipientCount * sendDelaySeconds * 1000

  // Advisory only. Suppressed when the hard cap already blocks the send, so a
  // user never gets a warning and an error about the same file. This covers a
  // high finite cap too, not just an uncapped plan: a 10,000 limit still lets
  // someone start a multi-hour send with nothing said about it.
  const overWarnThreshold =
    !rowCapExceeded && recipientCount > BULK_RECIPIENT_WARN_THRESHOLD

  // Clamped, so the preview can never be stranded past the end of a shorter
  // list. Anything that shrinks plan.valid (changing the phone column, most
  // obviously) would otherwise hide the preview and disable its own Next
  // button, leaving Previous as the only way back.
  const safePreviewIndex = Math.min(
    previewIndex,
    Math.max(0, plan.valid.length - 1)
  )
  const previewRow = plan.valid[safePreviewIndex]
  const previewMessage = previewRow
    ? renderTemplate(template, previewRow.data)
    : ''
  // Counted from the rendered message, never the raw template: falling back to
  // the template counts the literal "{{ name }}" placeholders and misstates
  // the segment cost.
  const segments = getSegmentInfo(previewMessage)

  const hasFile = rows.length > 0
  const mapped =
    hasFile &&
    !rowCapExceeded &&
    !rowCapUnknown &&
    Boolean(recipientColumn) &&
    plan.valid.length > 0
  const composed = mapped && template.trim().length > 0 && Boolean(deviceId)

  const {
    mutate: sendBulk,
    isPending: isSending,
    isSuccess,
    error: sendError,
    reset: resetSend,
  } = useMutation({
    mutationFn: async () => {
      // Only rows that survived validation are sent. The previous version
      // mapped every parsed row, including blanks and duplicates.
      const messages = plan.valid.map((row) => ({
        message: renderTemplate(template, row.data),
        recipients: [row.raw],
        ...(simSubscriptionId !== undefined && { simSubscriptionId }),
      }))

      return httpBrowserClient.post(ApiEndpoints.gateway.sendBulkSMS(), {
        deviceId,
        messageTemplate: template,
        messages,
      })
    },
    // A campaign moves the quota bar the most, so it invalidates the same keys
    // as a single send.
    onSuccess: () => invalidateAfterSend(queryClient),
  })

  const insertVariable = (column: string) => {
    const el = templateRef.current
    const token = `{{ ${column} }}`
    if (!el) {
      setTemplate((t) => t + token)
      return
    }
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    const next = template.slice(0, start) + token + template.slice(end)
    setTemplate(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return {
    rows,
    columns,
    fileName,
    recipientColumn,
    template,
    setTemplate,
    deviceId,
    setDeviceId,
    simSubscriptionId,
    setSimSubscriptionId,
    previewIndex,
    setPreviewIndex,
    fileError,
    fileWarning,
    templateRef,
    devices,
    maxRows,
    resetFile,
    rowCapExceeded,
    rowCapUnknown,
    recipientCount,
    estimatedSendMs,
    overWarnThreshold,
    warnThreshold: BULK_RECIPIENT_WARN_THRESHOLD,
    handleRecipientColumnChange,
    getRootProps,
    getInputProps,
    isDragActive,
    plan,
    unknownVariables,
    selectedDevice,
    availableSims,
    safePreviewIndex,
    previewRow,
    previewMessage,
    segments,
    hasFile,
    mapped,
    composed,
    sendBulk,
    isSending,
    isSuccess,
    sendError,
    resetSend,
    insertVariable,
  }
}

export type BulkSendState = ReturnType<typeof useBulkSend>
