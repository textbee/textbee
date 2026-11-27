'use client'

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from 'react'
import { Input } from '@/components/ui/input'
import {
  CODE_LENGTH,
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

// A submit button that waits for a complete code: neutral, so it does not
// read as a button that is loading
export const incompleteCodeButtonClass =
  'disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 disabled:shadow-none'

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
    // The raw value while a keyboard composes text. It is formatted when
    // the composition ends, as some keyboards repeat or lose characters if
    // the value changes under them; the code itself is reported at once.
    const [draft, setDraft] = useState<string | null>(null)
    const composing = useRef(false)
    const hintId = useId()
    const shown = formatCodeChars(chars)

    useLayoutEffect(() => {
      const input = inputRef.current
      const caret = pendingCaret.current
      if (!input || caret === null) return
      pendingCaret.current = null
      if (document.activeElement === input) input.setSelectionRange(caret, caret)
    })

    // caret is the place in the shown value; by default after `before`
    // code characters
    const apply = (
      next: string,
      before: number,
      dropped: boolean,
      caret = caretAfter(Math.min(before, next.length), next)
    ) => {
      setConfusable(dropped)
      pendingCaret.current = caret
      rerender()
      onChars(next)
    }

    // The hyphen is not a character of the code: deleting it deletes the
    // code character before it
    const deleteBeforeHyphen = () =>
      apply(chars.slice(0, 3) + chars.slice(4), 3, false)

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
      const raw = input.value
      const before = draft ?? shown
      // Only the hyphen is gone: a Backspace the keyboard did not report as
      // one, as many phone keyboards do
      if (before[4] === '-' && raw === before.slice(0, 4) + before.slice(5)) {
        setDraft(null)
        deleteBeforeHyphen()
        return
      }
      if (composing.current) {
        setDraft(raw)
        onChars(codeCharsFrom(raw).chars)
        return
      }
      applyRaw(raw, input.selectionStart ?? raw.length)
    }

    // Deleting next to the hyphen, read from the input type, which phone
    // keyboards report even when the key itself is unknown. A keyboard
    // that does not send it is caught in onChange.
    useEffect(() => {
      const input = inputRef.current
      if (!input) return
      const onBeforeInput = (event: InputEvent) => {
        if (readOnly || event.isComposing) return
        const start = input.selectionStart
        if (start === null || start !== input.selectionEnd) return
        if (
          event.inputType === 'deleteContentBackward' &&
          input.value[start - 1] === '-'
        ) {
          event.preventDefault()
          deleteBeforeHyphen()
        } else if (
          event.inputType === 'deleteContentForward' &&
          input.value[start] === '-'
        ) {
          // The 5th character goes; the caret stays before the hyphen
          event.preventDefault()
          apply(chars.slice(0, 4) + chars.slice(5), 4, false, 4)
        }
      }
      input.addEventListener('beforeinput', onBeforeInput)
      return () => input.removeEventListener('beforeinput', onBeforeInput)
    })

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
      // A link, or a whole code on its own, replaces what the field holds
      if (
        /code=/i.test(text) ||
        codeCharsFrom(text).chars.length === CODE_LENGTH
      ) {
        applyRaw(text, text.length)
        return
      }
      const raw = input.value.slice(0, start) + text + input.value.slice(end)
      applyRaw(raw, start + text.length)
    }

    const described = [describedBy, confusable ? hintId : undefined]
      .filter(Boolean)
      .join(' ')

    return (
      <>
        <Input
          ref={inputRef}
          id={id}
          value={draft ?? shown}
          onChange={onChange}
          onPaste={onPaste}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(event) => {
            composing.current = false
            setDraft(null)
            const input = event.currentTarget
            applyRaw(input.value, input.selectionStart ?? input.value.length)
          }}
          readOnly={readOnly}
          // An empty field with an error shows no example code, which
          // would read as the code that was refused
          placeholder={invalid ? undefined : placeholder}
          autoComplete='one-time-code'
          autoCapitalize='characters'
          autoCorrect='off'
          spellCheck={false}
          inputMode='text'
          maxLength={9}
          aria-invalid={invalid}
          aria-describedby={described || undefined}
          data-clarity-mask='true'
          // One look wherever a code is typed: large, monospaced, centred
          className={cn(
            'h-14 text-center font-mono text-xl uppercase tracking-[0.2em] sm:h-12 sm:text-lg',
            'aria-[invalid=true]:border-destructive/60 aria-[invalid=true]:focus-visible:ring-destructive/20',
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
