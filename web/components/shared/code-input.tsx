'use client'

import {
  forwardRef,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import { Input } from '@/components/ui/input'
import {
  CONFUSABLE_TEXT,
  codeCharsFrom,
  formatCodeChars,
} from '@/lib/device-link'
import { cn } from '@/lib/utils'

type CodeInputProps = {
  id: string
  // The code characters, without the hyphen
  chars: string
  onChars: (chars: string) => void
  invalid?: boolean
  // Ids of the error or help texts the parent shows for this field
  describedBy?: string
  readOnly?: boolean
  placeholder?: string
  className?: string
}

// The caret in the shown value after n code characters: past the hyphen
// once there are four
function caretAfter(count: number, chars: string): number {
  return count >= 4 && chars.length >= 4 ? count + 1 : count
}

/**
 * The field for the code the textbee app shows. It keeps only the code's
 * alphabet in upper case, at most 8 characters, and shows the hyphen by
 * itself after the fourth. A pasted code or link gives its code.
 */
const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(
  function CodeInput(
    {
      id,
      chars,
      onChars,
      invalid = false,
      describedBy,
      readOnly = false,
      placeholder = 'K7QX-2M9P',
      className,
    },
    ref
  ) {
    const inputRef = useRef<HTMLInputElement>(null)
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement)
    const pendingCaret = useRef<number | null>(null)
    // Every edit renders again, also when the code stays the same, so the
    // field never keeps a character it should drop
    const [, rerender] = useReducer((count: number) => count + 1, 0)
    const [confusable, setConfusable] = useState(false)
    const hintId = useId()

    useLayoutEffect(() => {
      const input = inputRef.current
      const caret = pendingCaret.current
      if (!input || caret === null) return
      pendingCaret.current = null
      if (document.activeElement === input) input.setSelectionRange(caret, caret)
    })

    const apply = (next: string, before: number, dropped: boolean) => {
      setConfusable(dropped)
      pendingCaret.current = caretAfter(Math.min(before, next.length), next)
      rerender()
      onChars(next)
    }

    // A raw value with the caret at rawCaret, as typing or pasting left it
    const applyRaw = (raw: string, rawCaret: number) => {
      const { chars: next, droppedConfusable } = codeCharsFrom(raw)
      // A link gives its whole code; the caret goes to the end
      const before = /code=/i.test(raw)
        ? next.length
        : codeCharsFrom(raw.slice(0, rawCaret)).chars.length
      apply(next, before, droppedConfusable)
    }

    const onChange = (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target
      applyRaw(input.value, input.selectionStart ?? input.value.length)
    }

    // The field is short, so a pasted link would be cut before onChange
    // sees it; a paste is read here instead
    const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
      if (readOnly) return
      const text = event.clipboardData.getData('text')
      if (!text) return
      event.preventDefault()
      const input = event.currentTarget
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      if (/code=/i.test(text)) {
        applyRaw(text, text.length)
        return
      }
      const raw = input.value.slice(0, start) + text + input.value.slice(end)
      applyRaw(raw, start + text.length)
    }

    // The hyphen is not a character of the code: deleting next to it
    // deletes the code character on its other side
    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
      if (readOnly) return
      const input = event.currentTarget
      const start = input.selectionStart
      if (start === null || start !== input.selectionEnd) return
      const value = input.value
      if (event.key === 'Backspace' && value[start - 1] === '-') {
        event.preventDefault()
        apply(chars.slice(0, 3) + chars.slice(4), 3, false)
      } else if (event.key === 'Delete' && value[start] === '-') {
        event.preventDefault()
        apply(chars.slice(0, 4) + chars.slice(5), 4, false)
      }
    }

    const described = [describedBy, confusable ? hintId : undefined]
      .filter(Boolean)
      .join(' ')

    return (
      <>
        <Input
          ref={inputRef}
          id={id}
          value={formatCodeChars(chars)}
          onChange={onChange}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          placeholder={placeholder}
          autoComplete='one-time-code'
          autoCapitalize='characters'
          autoCorrect='off'
          spellCheck={false}
          inputMode='text'
          maxLength={9}
          aria-invalid={invalid}
          aria-describedby={described || undefined}
          data-clarity-mask='true'
          className={cn(
            'font-mono uppercase aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus-visible:ring-destructive/20',
            className
          )}
        />
        {confusable && (
          <p id={hintId} className='text-xs text-muted-foreground'>
            {CONFUSABLE_TEXT}
          </p>
        )}
      </>
    )
  }
)

export default CodeInput
