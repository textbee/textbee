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

  // The row carries no claim time, so the push age rules apply
  const [timing, attempts, handed] = filter.$and
  const [byClaimTime, byPushAge] = timing.$or
  const [dispatched, due] = byPushAge.$and

  it('waits 30 minutes after a dispatch before offering it again', () => {
    expect(byPushAge['metadata.claimableAt']).toEqual({ $exists: false })
    expect(dispatched.$or[0].dispatchedAt.$lt).toEqual(new Date('2026-09-20T11:30:00Z'))
    expect(dispatched.$or[1].requestedAt.$lt).toEqual(new Date('2026-09-20T11:30:00Z'))
  })

  it('never offers a message scheduled for the future', () => {
    expect(due.$or[0]).toEqual({ dispatchDueAt: { $exists: false } })
    expect(due.$or[1].dispatchDueAt.$lte.getTime()).toBeLessThan(now.getTime())
  })

  it('leaves a paced message to its queue job until it is 30 minutes overdue', () => {
    const claimable = (minutesAgo: number) =>
      new Date(now.getTime() - minutesAgo * 60_000) <= due.$or[1].dispatchDueAt.$lte

    expect(claimable(10)).toBe(false)
    expect(claimable(31)).toBe(true)
  })

  it('offers a row from its claim time on, whatever its push age', () => {
    expect(byClaimTime).toEqual({ 'metadata.claimableAt': { $lte: now } })
  })

  it('caps the number of dispatch attempts', () => {
    expect(attempts.$or[1].dispatchAttempts.$lt).toBe(MAX_DISPATCH_ATTEMPTS)
  })

  it('never offers a message whose push was withheld', () => {
    expect(filter.errorCode).toEqual({ $ne: 'FCM_SEND_SKIPPED' })
  })

  it('offers the old endpoint only rows not handed to a known install', () => {
    expect(handed.$or).toEqual([
      { 'metadata.handedTo': { $exists: false } },
      { 'metadata.handedTo': 'fcm' },
    ])
  })

  it('offers an install only rows handed to nobody or to itself', () => {
    const forInstall = pendingRecoveryFilter(deviceId, now, 'install-a') as any
    expect(forInstall.$and[2].$or).toEqual([
      { 'metadata.handedTo': { $exists: false } },
      { 'metadata.handedTo': 'install-a' },
    ])
    expect(forInstall['metadata.appVersionCode']).toEqual({ $gte: 20 })
    expect(forInstall.requestedAt.$gte).toEqual(new Date('2026-09-17T12:00:00Z'))
  })

  it('offers an install only rows that carry a claim time', () => {
    const forInstall = pendingRecoveryFilter(deviceId, now, 'install-a') as any
    expect(forInstall.$and[0].$or).toEqual([{ 'metadata.claimableAt': { $lte: now } }])
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

  it('rebuilds a slot request with the subscription id mapped when it was queued', () => {
    const payload = toRecoveryPayload({
      _id: new Types.ObjectId(),
      message: 'hi',
      recipient: '+15550100',
      simSlotIndex: 1,
      metadata: { simMappedSubscriptionId: 7, appVersionCode: 20 },
    })
    expect(payload).toMatchObject({ simSlotIndex: 1, simSubscriptionId: 7 })
    expect(Object.keys(payload)).toEqual([
      'smsId',
      'smsBatchId',
      'message',
      'recipients',
      'simSlotIndex',
      'simSubscriptionId',
    ])
  })

  it('sends only the slot when nothing was mapped', () => {
    const payload = toRecoveryPayload({
      _id: new Types.ObjectId(),
      message: 'hi',
      recipient: '+15550100',
      simSlotIndex: 0,
      metadata: { appVersionCode: 22 },
    })
    expect(payload).toMatchObject({ simSlotIndex: 0 })
    expect(payload).not.toHaveProperty('simSubscriptionId')
  })

  it('keeps an id-only message exactly as before', () => {
    const id = new Types.ObjectId()
    const payload = toRecoveryPayload({
      _id: id,
      message: 'hi',
      recipient: '+15550100',
      simSubscriptionId: 0,
      metadata: { appVersionCode: 20 },
    })
    expect(JSON.stringify(payload)).toBe(
      JSON.stringify({
        smsId: id.toHexString(),
        message: 'hi',
        recipients: ['+15550100'],
        simSubscriptionId: 0,
      }),
    )
  })

  it('omits the SIM when the message has none', () => {
    const payload = toRecoveryPayload({ _id: new Types.ObjectId(), message: 'hi', recipient: '+15550100' })
    expect(payload).not.toHaveProperty('simSubscriptionId')
    expect(payload.smsBatchId).toBeUndefined()
  })
})
