'use client'

import { FormDescription } from '@/components/ui/form'

// Always mounted on a reserved line, so it is announced and never moves the form.
export default function EmailTypoHint({
  suggestion,
  onUse,
}: {
  suggestion: string | null
  onUse: (suggestion: string) => void
}) {
  return (
    <FormDescription aria-live='polite' className='min-h-5 leading-5'>
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
