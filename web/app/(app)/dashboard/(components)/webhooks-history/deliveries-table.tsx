'use client'

import { Button } from '@/components/ui/button'
import { DataTable } from './data-table'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { Eye } from 'lucide-react'
import { formatDeviceName } from '@/lib/utils'

// This interface was declared but never applied to the component, which
// destructured its props untyped, so none of it was enforced. isLoading and
// status were missing from it too.
interface WebhookDeliveriesTableProps {
  data: ProductColumns[]
  isLoading?: boolean
  status?: string
}

export type ProductColumns = {
  event?: string
  // buildDeviceLabel returns two lines (device name plus SMS id) when it has
  // both, and the Device cell already renders that array case. The type said
  // string, so the shape the code actually produces was never described here.
  deviceName?: string | string[]
  webhookEvent?: string
  deliveryUrl?: string
  webhookSubscription?: {
    deliveryUrl: string
  }
  createdAt?: string
  status: string
  computedStatus?: string
  payload?: any
}


export const columns: ColumnDef<ProductColumns>[] = [
  {
    accessorKey: 'event',
    header: 'Event',
  },
  {
    accessorKey: 'deviceName',
    header: 'Device',
    cell: ({ row }) => {
      const deviceName = row.original.deviceName
      // If deviceName is an array with two lines
      if (Array.isArray(deviceName) && deviceName.length === 2) {
        return (
          <div className="flex flex-col">
            <span className="font-medium">{deviceName[0]}</span>
            <span className="text-xs text-muted-foreground">
              {deviceName[1]}
            </span>
          </div>
        )
      }
      // Fallback for single line
      return <span>{deviceName}</span>
    },
  },
  {
    accessorKey: 'status',
    header: 'Status',
  },
  {
    accessorKey: 'webhookSubscriptionData.deliveryUrl',
    header: 'Delivery Url',
  },
  {
    accessorKey: 'createdAt',
    header: 'Created At',
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" disabled={!row.original.payload}>
        <Eye className="h-4 w-4" />
      </Button>
    ),
  },
]
const formatDate = (dateString?: string) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return ''
  return format(date, 'MMM dd, yyyy h:mm a')
}

const buildDeviceLabel = (d: any): string | string[] => {
  const device = d?.deviceData
  const sms = d?.smsData
  const deviceLabel = device ? formatDeviceName(device) : ''
  const smsLine = sms?._id ? `  ${sms._id}` : ''

  if (deviceLabel && smsLine) {
    return [deviceLabel, smsLine]
  }
  if (deviceLabel) {
    return deviceLabel
  }
  if (smsLine) {
    return smsLine.trim()
  }
  return 'Unknown device'
}

const WebhookDeliveriesTable = ({
  data,
  isLoading = false,
  status = 'delivered',
}: WebhookDeliveriesTableProps) => {
  const formatted = data.map((d) => ({
    ...d,
    deviceName: buildDeviceLabel(d),
    createdAt: formatDate(d?.createdAt?.toString?.()),
    status: d.computedStatus || status,
    payload: d.payload,
  }))

  return (
    <>
      <DataTable
        searchKey="event"
        columns={columns}
        data={formatted}
        isLoading={isLoading}
      />
    </>
  )
}

export default WebhookDeliveriesTable
