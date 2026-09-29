import { readFileSync } from 'fs'
import { join } from 'path'
import {
  hoursSincePermissionFailure,
  needsSmsPermission,
} from './sms-permission'

// Shared with the mirrored copy and the Python twin; all must agree.
const fixture = JSON.parse(
  readFileSync(join(__dirname, 'sms-permission-cases.json'), 'utf8'),
)
const now = new Date(fixture.now)

describe('sms permission conformance', () => {
  it.each(fixture.cases.map((c: any) => [c.name, c]))('%s', (_name, c: any) => {
    expect(needsSmsPermission(c.last, c.device) ?? null).toBe(c.needs)
    expect(hoursSincePermissionFailure(c.last, c.device, now) ?? null).toBe(
      c.hours,
    )
  })
})
