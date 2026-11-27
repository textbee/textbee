import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { render, screen, userEvent } from '@/test/render'
import CodeInput from './code-input'

function Harness({ initial = '' }: { initial?: string }) {
  const [chars, setChars] = useState(initial)
  return (
    <>
      <label htmlFor='code'>Code</label>
      <CodeInput id='code' chars={chars} onChars={setChars} />
      <output data-testid='chars'>{chars}</output>
    </>
  )
}

const field = () => screen.getByLabelText('Code') as HTMLInputElement
const HINT = 'Codes do not use the letters O, I or L.'

describe('code field', () => {
  it('upper-cases and adds the hyphen by itself', async () => {
    render(<Harness />)
    await userEvent.type(field(), 'k7qx2m9p')
    expect(field()).toHaveValue('K7QX-2M9P')
    expect(screen.getByTestId('chars')).toHaveTextContent('K7QX2M9P')
  })

  it('shows the hyphen once four characters are in', async () => {
    render(<Harness />)
    await userEvent.type(field(), 'k7q')
    expect(field()).toHaveValue('K7Q')
    await userEvent.type(field(), 'x')
    expect(field()).toHaveValue('K7QX-')
  })

  it('ignores a typed hyphen', async () => {
    render(<Harness />)
    await userEvent.type(field(), 'K7QX-2M9P')
    expect(field()).toHaveValue('K7QX-2M9P')
  })

  it('keeps at most 8 characters of the code alphabet', async () => {
    render(<Harness />)
    // What a user typed on the live page: 14 characters, one of them 0
    await userEvent.type(field(), '7TR9098GGGJGFJ')
    expect(field()).toHaveValue('7TR9-98GG')
    expect(field().value.length).toBeLessThanOrEqual(9)
  })

  it('drops O, I and L with a short hint, and the hint goes on the next key', async () => {
    render(<Harness />)
    await userEvent.type(field(), 'o')
    expect(field()).toHaveValue('')
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(field()).toHaveAccessibleDescription(HINT)
    await userEvent.type(field(), 'k')
    expect(field()).toHaveValue('K')
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it('drops other characters without a hint', async () => {
    render(<Harness />)
    await userEvent.type(field(), '0 1#k')
    expect(field()).toHaveValue('K')
    expect(screen.queryByText(HINT)).not.toBeInTheDocument()
  })

  it.each([
    'k7qx 2m9p',
    'K7QX-2M9P',
    ' k7qx2m9p ',
    'https://app.textbee.dev/link-device?code=K7QX-2M9P',
    'app.textbee.dev/link-device?code=k7qx2m9p&x=1',
  ])('reads the code from the paste %j', async (text) => {
    render(<Harness />)
    await userEvent.click(field())
    await userEvent.paste(text)
    expect(field()).toHaveValue('K7QX-2M9P')
  })

  it('keeps the first 8 characters of a longer paste', async () => {
    render(<Harness />)
    await userEvent.click(field())
    await userEvent.paste('K7QX2M9PABCD')
    expect(field()).toHaveValue('K7QX-2M9P')
  })

  it('deletes the character before the hyphen on Backspace after it', async () => {
    render(<Harness />)
    await userEvent.type(field(), 'K7QX')
    expect(field()).toHaveValue('K7QX-')
    await userEvent.keyboard('{Backspace}')
    expect(field()).toHaveValue('K7Q')
  })

  it('deletes the character after the hyphen on Delete before it', async () => {
    render(<Harness initial='K7QX2M9P' />)
    const input = field()
    input.focus()
    input.setSelectionRange(4, 4)
    await userEvent.keyboard('{Delete}')
    expect(input).toHaveValue('K7QX-M9P')
  })

  it('keeps the caret in place when typing in the middle', async () => {
    render(<Harness initial='K7QX2M' />)
    const input = field()
    await userEvent.type(input, 'a', {
      initialSelectionStart: 2,
      initialSelectionEnd: 2,
    })
    expect(input).toHaveValue('K7AQ-X2M')
    expect(input.selectionStart).toBe(3)
  })

  it('moves the caret past the hyphen when the fourth character is typed in the middle', async () => {
    render(<Harness initial='K7Q2M' />)
    const input = field()
    // "K7Q|-2M": the hyphen sits after the fourth character
    expect(input).toHaveValue('K7Q2-M')
    await userEvent.type(input, 'x', {
      initialSelectionStart: 3,
      initialSelectionEnd: 3,
    })
    expect(input).toHaveValue('K7QX-2M')
    expect(input.selectionStart).toBe(5)
  })

  it('deletes across the hyphen and keeps the caret', async () => {
    render(<Harness initial='K7QX2M9P' />)
    const input = field()
    // "K7Q[X-2]M9P"
    await userEvent.type(input, '{Backspace}', {
      initialSelectionStart: 3,
      initialSelectionEnd: 6,
    })
    expect(input).toHaveValue('K7QM-9P')
    expect(input.selectionStart).toBe(3)
  })

  it('has the attributes of a one-time code field', () => {
    render(<Harness />)
    const input = field()
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    expect(input).toHaveAttribute('autocapitalize', 'characters')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('inputmode', 'text')
    expect(input).toHaveAttribute('maxlength', '9')
  })
})
