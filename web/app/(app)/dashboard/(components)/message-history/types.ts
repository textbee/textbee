import type { Device } from '@/lib/api'

// Shape of a message row as returned by the device messages endpoint. Kept
// permissive to match the backend payloads (sent and received rows differ).
export type SmsMessage = {
  _id: string
  message?: string
  status?: string
  // Direction as recorded by the API (SMSType), which sends it uppercase.
  // Optional because rows written before it existed do not carry it.
  type?: 'SENT' | 'RECEIVED'
  sender?: string
  recipient?: string
  recipients?: string[]
  requestedAt?: string
  receivedAt?: string
  createdAt?: string
  gatewayMessageId?: string
  // The current failure. Present only while status is failed, except that an
  // unknown message can carry a note that the phone did not report in time.
  errorCode?: string
  // From the API error catalog. Absent on older APIs and unknown codes.
  errorName?: string
  errorMessage?: string
  // The phone's original text, when it differs from the catalog text
  deviceMessage?: string
  docsUrl?: string
  failedAt?: string
  // Every failure, kept after the message recovers. Oldest first; past 15,
  // only the first 5 and the newest 10.
  issueHistory?: ErrorHistoryEntry[]
  device?: Device
  // Batch id of the send this message came from.
  smsBatch?: string
  // SIM the caller requested, not necessarily the one used. A slot request
  // sets simSlotIndex (zero-based); an older ID request sets simSubscriptionId.
  simSlotIndex?: number
  simSubscriptionId?: number
  // SIM the phone reports it used. Absent from older app versions, and
  // every part is optional because Android does not always expose it.
  simUsed?: SimUsed
}

export type ErrorHistoryEntry = {
  code: string
  // name, deviceMessage and docsUrl come from the API error catalog
  name?: string
  message?: string
  deviceMessage?: string
  docsUrl?: string
  at: string
  source: 'device' | 'push' | 'server'
  backfilled?: boolean
  // A delivery report that did not confirm delivery. The message was sent,
  // so this is not a failure.
  deliveryReport?: boolean
}

export type SimUsed = {
  subscriptionId?: number
  slotIndex?: number
  carrierName?: string
  displayName?: string
  countryIso?: string
  mcc?: string
  mnc?: string
}

export type MessagesPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}
