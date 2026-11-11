import { z } from 'zod'
import { MAX_SIM_ID, SIM_ID_ERROR } from '@/lib/sim-id'
import {
  MAX_RECIPIENT_DIGITS,
  MIN_RECIPIENT_DIGITS,
  stripPhoneFormatting,
} from '@/lib/sms'

// Normalized form: digits with an optional leading plus. Covers international
// numbers, local numbers and short codes.
const RECIPIENT_PATTERN = new RegExp(
  `^\\+?\\d{${MIN_RECIPIENT_DIGITS},${MAX_RECIPIENT_DIGITS}}$`
)

export const sendSmsSchema = z.object({
  // `error` covers an unset device; zod 4 would otherwise show its own text
  deviceId: z.string({ error: 'Please select a device' }).min(1, {
    message: 'Please select a device',
  }),
  recipients: z
    .array(
      // The reply composer is free text, so formatting is stripped first.
      z
        .string()
        .transform(stripPhoneFormatting)
        .pipe(
          z.string().regex(RECIPIENT_PATTERN, {
            message: `Enter a phone number or short code (${MIN_RECIPIENT_DIGITS} to ${MAX_RECIPIENT_DIGITS} digits)`,
          })
        )
    )
    .min(1, {
      message: 'At least one recipient is required',
    }),
  message: z
    .string()
    .min(1, {
      message: 'Message is required',
    })
    .max(1600, {
      message: 'Message cannot exceed 1600 characters',
    }),
  // Zero-based slot from the SIM control: 0 is SIM 1
  simSlotIndex: z.number().int().min(0).max(7).optional(),
  // NaN, from text that is not a whole number, fails as invalid_type
  simSubscriptionId: z
    .number({ error: SIM_ID_ERROR })
    .int({ message: SIM_ID_ERROR })
    .nonnegative({ message: SIM_ID_ERROR })
    .max(MAX_SIM_ID, { message: SIM_ID_ERROR })
    .optional(),
})

export type SendSmsFormData = z.infer<typeof sendSmsSchema>

// export const bulkSmsSchema = z.object({
//   deviceId: z.string().uuid({
//     message: 'Please select a device',
//   }),
//   file: z.instanceof(File, {
//     message: 'Please upload a CSV file',
//   }),
//   messageTemplate: z
//     .string()
//     .min(1, {
//       message: 'Message template is required',
//     })
//     .max(1600, {
//       message: 'Message template cannot exceed 1600 characters',
//     }),
// })

// export type BulkSmsFormData = z.infer<typeof bulkSmsSchema>
