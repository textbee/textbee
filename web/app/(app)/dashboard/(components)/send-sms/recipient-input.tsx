'use client'

import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  hasLetters,
  isPlausiblePhone,
  MAX_RECIPIENT_DIGITS,
  MIN_FULL_NUMBER_DIGITS,
  MIN_RECIPIENT_DIGITS,
  normalizePhone,
} from '@/lib/sms'

const digitCount = (value: string) => value.replace(/\D/g, '').length
import { cn } from '@/lib/utils'

// Numbers commit on Enter, comma or blur, and paste splits on separators, so a
// list copied from a spreadsheet becomes chips in one action. Replaces a
// growing stack of full-width inputs, each with its own remove button.
export default function RecipientInput({
  recipients,
  onChange,
  error,
}: {
  recipients: string[]
  onChange: (next: string[]) => void
  error?: string
}) {
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const commit = (raw: string): boolean => {
    // Split only on unambiguous separators first. Splitting on whitespace up
    // front would shred "+1 (415) 555-0101" into three fragments, since spaces
    // are also formatting inside a single number.
    const tokens = raw
      .split(/[,;\n\t]+/)
      .map((v) => v.trim())
      .filter(Boolean)

    const candidates: string[] = []
    for (const token of tokens) {
      if (isPlausiblePhone(token) || hasLetters(token)) {
        candidates.push(token)
        continue
      }
      // Only a token that cannot be one number gets split on whitespace,
      // which is how "+14155550101 +16475550187" becomes two chips. Every
      // part must be a full number: "415 555 0101 647 555 0187" must not
      // turn into six short codes.
      const parts = token.split(/\s+/).filter(Boolean)
      if (parts.some((part) => digitCount(part) < MIN_FULL_NUMBER_DIGITS)) {
        setLocalError(
          `"${token}" is not one phone number. Separate numbers with commas.`
        )
        return false
      }
      candidates.push(...parts)
    }

    if (candidates.length === 0) return true

    const accepted: string[] = []
    for (const candidate of candidates) {
      if (hasLetters(candidate)) {
        setLocalError(
          `"${candidate}" contains letters. Enter a phone number or short code. Sender names such as MYBANK cannot receive SMS.`
        )
        return false
      }
      if (!isPlausiblePhone(candidate)) {
        setLocalError(
          `"${candidate}" is not a phone number or short code. Use ${MIN_RECIPIENT_DIGITS} to ${MAX_RECIPIENT_DIGITS} digits.`
        )
        return false
      }
      // The API schema accepts digits with an optional leading plus, so
      // formatting is stripped before the value reaches the form.
      const normalized = normalizePhone(candidate)
      if (!recipients.includes(normalized) && !accepted.includes(normalized)) {
        accepted.push(normalized)
      }
    }

    setLocalError(null)
    if (accepted.length) onChange([...recipients, ...accepted])
    return true
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      if (commit(draft)) setDraft('')
      return
    }
    // Backspace on an empty field removes the last chip, as in every other
    // token input people have used.
    if (event.key === 'Backspace' && draft === '' && recipients.length > 0) {
      onChange(recipients.slice(0, -1))
    }
  }

  const remove = (value: string) =>
    onChange(recipients.filter((r) => r !== value))

  const shownError = localError ?? error

  return (
    <div className='space-y-1.5'>
      <Label htmlFor='sms-recipient'>To</Label>

      {recipients.length > 0 && (
        <ul className='flex flex-wrap gap-1.5'>
          {recipients.map((recipient) => (
            <li key={recipient}>
              <span className='inline-flex items-center gap-1 rounded-full bg-muted py-1 pl-2.5 pr-1 text-sm'>
                {recipient}
                <button
                  type='button'
                  onClick={() => remove(recipient)}
                  aria-label={`Remove ${recipient}`}
                  className='rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground'
                >
                  <X className='h-3 w-3' />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Input
        id='sms-recipient'
        type='tel'
        inputMode='tel'
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (localError) setLocalError(null)
        }}
        onKeyDown={handleKeyDown}
        // Commit on blur too: people type a number then click Send, and losing
        // it silently would be the worst possible outcome.
        onBlur={() => {
          if (commit(draft)) setDraft('')
        }}
        placeholder={
          recipients.length ? 'Add another number' : '+14155550101'
        }
        aria-describedby='sms-recipient-hint'
        className={cn(shownError && 'border-destructive')}
      />

      <p id='sms-recipient-hint' className='text-xs text-muted-foreground'>
        Press Enter or comma to add. Paste a list to add several at once.
      </p>

      {shownError && <p className='text-sm text-destructive'>{shownError}</p>}
    </div>
  )
}
