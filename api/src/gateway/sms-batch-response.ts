import { SMSBatchSchema } from './schemas/sms-batch.schema'

// Only fields this API defines. Other writers share the collection.
const PRIVATE_FIELDS = new Set(['source', 'client', 'clientVersion', 'apiKey'])
const RESPONSE_FIELDS = new Set(
  [...Object.keys(SMSBatchSchema.paths), '__v'].filter(
    (key) => !PRIVATE_FIELDS.has(key),
  ),
)

export function presentSmsBatch(batch: any): Record<string, unknown> {
  const source = typeof batch?.toJSON === 'function' ? batch.toJSON() : batch
  return Object.fromEntries(
    Object.entries(source ?? {}).filter(([key]) => RESPONSE_FIELDS.has(key)),
  )
}
