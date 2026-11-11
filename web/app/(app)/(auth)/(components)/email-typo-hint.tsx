'use client'

import { FormDescription } from '@/components/ui/form'

// Stays mounted (visually hidden when empty) so screen readers hear it appear.
export default function EmailTypoHint({
  suggestion,
  onUse,
}: {
  suggestion: string | null
  onUse: (suggestion: string) => void
}) {
  return (
    <FormDescription aria-live='polite' className='empty:sr-only'>
      {suggestion && (
        <>
          Did you mean {suggestion}?{' '}
          <button
            type='button'
            className='font-medium text-primary underline-offset-4 hover:underline'
            onClick={() => onUse(suggestion)}
          >
            Use this
          </button>
        </>
      )}
    </FormDescription>
  )
}
