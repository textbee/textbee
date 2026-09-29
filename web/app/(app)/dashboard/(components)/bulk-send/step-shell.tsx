'use client'

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// A numbered step block. Locked steps are hidden from assistive tech and the
// tab order via `inert`, unlike the previous implementation which used
// `pointer-events-none` plus `opacity-50` and left the controls focusable.
export default function StepShell({
  step,
  title,
  description,
  locked,
  complete,
  children,
}: {
  step: number
  title: string
  description?: string
  locked?: boolean
  complete?: boolean
  children: ReactNode
}) {
  return (
    <section
      // `inert` is a boolean attribute; React 19 passes it through natively.
      inert={locked || undefined}
      aria-labelledby={`bulk-step-${step}-title`}
      className={cn(
        'frame rounded-lg border border-border bg-card p-4 transition-opacity sm:p-5',
        locked && 'opacity-55'
      )}
    >
      <div className='mb-4 flex items-start gap-3'>
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            complete
              ? 'bg-primary text-primary-foreground'
              : locked
                ? 'bg-muted text-muted-foreground'
                : 'border-2 border-primary bg-background text-primary'
          )}
        >
          {complete ? <Check className='h-3.5 w-3.5' /> : step}
        </span>
        <div className='min-w-0'>
          <h3
            id={`bulk-step-${step}-title`}
            className='text-sm font-semibold leading-7'
          >
            {title}
          </h3>
          {description && (
            <p className='text-xs text-muted-foreground'>{description}</p>
          )}
        </div>
      </div>

      <div className='space-y-4'>{children}</div>
    </section>
  )
}
