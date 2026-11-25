'use client'

import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowData,
  columnFilteringFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  flexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { WebhookPayloadModal } from './payload-modal'

export const webhookTableFeatures = tableFeatures({
  columnFilteringFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
})

export type WebhookTableFeatures = typeof webhookTableFeatures

// A row can open the payload modal only when the modal has SMS data to show
// (it renders nothing without it) and there is a payload to display.
export const canOpenDetails = (row: any): boolean =>
  !!(row?.original?.smsData && row?.original?.payload)

// Lets cells (the Actions button) open the modal through the same handler the
// row uses.
export const OpenDetailsContext = React.createContext<(row: any) => void>(
  () => {}
)

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<WebhookTableFeatures, TData>[]
  data: TData[]
  searchKey: string
  isLoading: boolean
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  searchKey,
  isLoading,
}: DataTableProps<TData>) {
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [selectedSms, setSelectedSms] = React.useState<any>(null)
  const [selectedPayload, setSelectedPayload] = React.useState<any>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const table = useTable({
    features: webhookTableFeatures,
    data,
    columns,
    onColumnFiltersChange: setColumnFilters,
    state: {
      columnFilters,
    },
  })

  const handleRowClick = (row: any) => {
    if (canOpenDetails(row)) {
      setSelectedSms({...row.original.smsData, webhookStatus: row.original.status})
      setSelectedPayload(row.original.payload)
      setIsModalOpen(true)
    }
  }

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: any
  ) => {
    // Ignore keys pressed on the inner button so it keeps its own behaviour.
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleRowClick(row)
    }
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedSms(null)
    setSelectedPayload(null)
  }

  return (
    <OpenDetailsContext.Provider value={handleRowClick}>
      <div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            {isLoading ? (
              <TableBody>
                {Array.from({ length: 10 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={6}>
                      <Skeleton className="w-full h-8" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ) : (
              <TableBody>
                {table.getRowModel().rows?.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && 'selected'}
                      onClick={() => handleRowClick(row)}
                      onKeyDown={(event) => handleRowKeyDown(event, row)}
                      tabIndex={canOpenDetails(row) ? 0 : undefined}
                      aria-disabled={canOpenDetails(row) ? undefined : true}
                      className={
                        canOpenDetails(row)
                          ? 'cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
                          : 'transition-colors'
                      }
                    >
                      {row.getAllCells().map((cell) => (
                        <TableCell key={cell.id} className="h-16">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-36 text-center"
                    >
                      No results.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            )}
          </Table>
        </div>

        {/* Webhook Payload Modal */}
        <WebhookPayloadModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          smsData={selectedSms}
          payload={selectedPayload}
        />
      </div>
    </OpenDetailsContext.Provider>
  )
}
