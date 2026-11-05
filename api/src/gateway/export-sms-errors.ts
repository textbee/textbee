import { writeFileSync } from 'fs'
import { join } from 'path'
import { SMS_ERRORS, smsErrorCatalogJson } from './sms-errors'

// api/sms-errors.json, whether this runs from src via ts-node or from dist.
const OUTPUT_PATH = join(__dirname, '..', '..', 'sms-errors.json')

writeFileSync(OUTPUT_PATH, smsErrorCatalogJson())
console.log(`Wrote ${SMS_ERRORS.length} error codes to ${OUTPUT_PATH}`)
