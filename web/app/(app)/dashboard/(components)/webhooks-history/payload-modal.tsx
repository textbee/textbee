'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Copy,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatTimestamp } from '@/lib/format'

interface SmsData {
  _id: string
  createdAt: string
  device: string
  encrypted: boolean
  message: string
  receivedAt: string
  sender: string
  status: string
  type: string
  updatedAt: string
  webhookStatus: string
  __v: number
}

interface WebhookPayloadModalProps {
  isOpen: boolean
  onClose: () => void
  smsData: SmsData | null
  payload?: any
}

export function WebhookPayloadModal({ isOpen, onClose, smsData, payload }: WebhookPayloadModalProps) {
  const { toast } = useToast()
  
  if (!smsData) return null
  
  const copyPayloadToClipboard = async () => {
    if (!payload) return
    try {
      const jsonString = JSON.stringify(payload, null, 2)
      await navigator.clipboard.writeText(jsonString)
      toast({
        title: "Copied!",
        description: "Payload copied to clipboard",
        duration: 2000,
      })
    } catch (err) {
      console.error('Failed to copy payload:', err)
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = JSON.stringify(payload, null, 2)
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      toast({
        title: "Copied!",
        description: "Payload copied to clipboard",
        duration: 2000,
      })
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <DialogTitle className="flex items-center gap-2">
            Webhook Notification
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {payload && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg">Payload</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPayloadToClipboard}
                  className="h-8"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy
                </Button>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900 rounded-md border p-4 overflow-auto max-h-64">
                <pre className="text-xs font-mono whitespace-pre-wrap text-gray-800 dark:text-gray-200">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status */}
            <div className="space-y-2">
              <h3 className="font-semibold text-sm">Webhook Notification Status</h3>
              <p className="text-sm bg-muted/30 rounded-md p-2 capitalize">
                {smsData.webhookStatus}
              </p>
            </div>
            
            <div className="space-y-2">
              <h3 className="font-semibold text-sm flex items-center gap-x-2">
                Created At
              </h3>
              <p className="text-sm bg-muted/30 rounded-md p-2 capitalize">
                {formatTimestamp(smsData.createdAt)}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
