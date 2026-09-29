'use client'

import { Button } from '@/components/ui/button'
import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  /** What is being copied, e.g. "Message". Names the button for assistive tech. */
  label: string
  className?: string
}

export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast({
        title: 'Copied!',
        description: `${label} copied to clipboard`,
      })
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      toast({
        title: 'Failed to copy',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  return (
    <Button
      type='button'
      variant='ghost'
      size='icon'
      // Icon-only buttons carried no accessible name, so several of them in
      // one view were indistinguishable to a screen reader.
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      className={cn('shrink-0', className)}
      onClick={copyToClipboard}
    >
      {copied ? (
        <Check className='h-4 w-4 text-success' />
      ) : (
        <Copy className='h-4 w-4' />
      )}
    </Button>
  )
}
