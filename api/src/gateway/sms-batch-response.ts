import { SMSBatchSchema } from './schemas/sms-batch.schema'

// Only fields this API defines. Other writers share the collection.
const RESPONSE_FIELDS = new Set([...Object.keys(SMSBatchSchema.paths), '__v'])

export function presentSmsBatch(batch: any): Record<string, unknown> {
  const source = typeof batch?.toJSON === 'function' ? batch.toJSON() : batch
  return Object.fromEntries(
    Object.entries(source ?? {}).filter(([key]) => RESPONSE_FIELDS.has(key)),
  )
}
