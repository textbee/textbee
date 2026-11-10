import { Types } from 'mongoose'
import {
  MAX_DISPATCH_ATTEMPTS,
  pendingRecoveryFilter,
  toRecoveryPayload,
} from './pending-recovery'

describe('pending recovery filter', () => {
  const now = new Date('2026-09-20T12:00:00Z')
  const deviceId = new Types.ObjectId().toHexString()
  const filter = pendingRecoveryFilter(deviceId, now) as any

  it('only looks at outbound messages that are still waiting', () => {
    expect(filter.type).toBe('SENT')
    expect(filter.status).toEqual({ $in: ['pending', 'dispatched', 'unknown'] })
    expect(filter.device).toEqual(new Types.ObjectId(deviceId))
  })

  it('skips messages queued for a build that does not remember what it sent', () => {
    expect(filter['metadata.appVersionCode']).toEqual({ $gte: 20 })
  })

  it('keeps messages requested in the last 72 hours', () => {
    expect(filter.requestedAt.$gte).toEqual(new Date('2026-09-17T12:00:00Z'))
  })

  it('waits 30 minutes after a dispatch before offering it again', () => {
    const [dispatched] = filter.$and
    expect(dispatched.$or[0].dispatchedAt.$lt).toEqual(new Date('2026-09-20T11:30:00Z'))
    expect(dispatched.$or[1].requestedAt.$lt).toEqual(new Date('2026-09-20T11:30:00Z'))
  })

  it('never offers a message scheduled for the future', () => {
    const [, due] = filter.$and
    expect(due.$or[0]).toEqual({ dispatchDueAt: { $exists: false } })
    expect(due.$or[1].dispatchDueAt.$lte.getTime()).toBeLessThan(now.getTime())
  })

  it('leaves a paced message to its queue job until it is 30 minutes overdue', () => {
    const [, due] = filter.$and
    const claimable = (minutesAgo: number) =>
      new Date(now.getTime() - minutesAgo * 60_000) <= due.$or[1].dispatchDueAt.$lte

    expect(claimable(10)).toBe(false)
    expect(claimable(31)).toBe(true)
  })

  it('caps the number of dispatch attempts', () => {
    const [, , attempts] = filter.$and
    expect(attempts.$or[1].dispatchAttempts.$lt).toBe(MAX_DISPATCH_ATTEMPTS)
  })
})

describe('recovery payload', () => {
  it('matches the push payload shape', () => {
    const id = new Types.ObjectId()
    const batch = new Types.ObjectId()
    expect(
      toRecoveryPayload({ _id: id, smsBatch: batch, message: 'hi', recipient: '+15550100', simSubscriptionId: 2 }),
    ).toEqual({
      smsId: id.toHexString(),
      smsBatchId: batch.toHexString(),
      message: 'hi',
      recipients: ['+15550100'],
      simSubscriptionId: 2,
    })
  })

  it('omits the SIM when the message has none', () => {
    const payload = toRecoveryPayload({ _id: new Types.ObjectId(), message: 'hi', recipient: '+15550100' })
    expect(payload).not.toHaveProperty('simSubscriptionId')
    expect(payload.smsBatchId).toBeUndefined()
  })
})
