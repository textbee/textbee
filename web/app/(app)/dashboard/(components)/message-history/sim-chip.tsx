'use client'

import { CardSim } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { simDetails, simLabel } from './sim-label'
import type { SmsMessage } from './types'

type SimChipProps = {
  message: SmsMessage
  // Shown in the chip; the full label and IDs go in the tooltip.
  text: string
  className?: string
}

export function SimChip({ message, text, className }: SimChipProps) {
  const details = simDetails(message)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
            <CardSim className='h-3 w-3 shrink-0' aria-hidden />
            <span className='sr-only'>SIM: </span>
            <span className='truncate'>{text}</span>
            {/* The tooltip is hover only, so its details reach screen readers here */}
            {details.length > 0 && (
              <span className='sr-only'>. {details.join('. ')}</span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent className='text-xs'>
          <p className='font-medium'>{simLabel(message)}</p>
          {details.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
