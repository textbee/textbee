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
  errorCode?: string
  errorMessage?: string
  device?: Device
  // Batch id of the send this message came from.
  smsBatch?: string
}

export type MessagesPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}
