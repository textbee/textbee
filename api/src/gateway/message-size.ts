import { HttpException, HttpStatus } from '@nestjs/common'

// The phone's send job input holds 10,240 bytes; the rest is for the recipient and ids
export const MAX_MESSAGE_BYTES = 9000

// Bytes as the phone stores the text (modified UTF-8): an emoji takes 6, U+0000 takes 2
export function messageByteLength(message: string): number {
  let bytes = 0
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i)
    if (code >= 0x0001 && code <= 0x007f) bytes += 1
    else if (code <= 0x07ff) bytes += 2
    else bytes += 3
  }
  return bytes
}

export function messageTooLongError(bytes: number, field = 'message'): string {
  return `${field} is ${bytes} bytes long. The limit is ${MAX_MESSAGE_BYTES} bytes in UTF-8, where an emoji counts as 6 bytes. Split the text into several messages.`
}

// Rejects a text the phone cannot queue, before anything is billed or created
export function assertMessageFits(message: unknown, field = 'message'): void {
  if (typeof message === 'object' && message !== null) {
    throw new HttpException(
      { success: false, error: `${field} must be text.` },
      HttpStatus.BAD_REQUEST,
    )
  }
  // A number or a boolean is stored and sent as its text form
  if (!['string', 'number', 'boolean'].includes(typeof message)) return
  const bytes = messageByteLength(String(message))
  if (bytes <= MAX_MESSAGE_BYTES) return
  throw new HttpException(
    { success: false, error: messageTooLongError(bytes, field) },
    HttpStatus.BAD_REQUEST,
  )
}
