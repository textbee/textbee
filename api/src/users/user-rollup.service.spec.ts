import { Types } from 'mongoose'
import { UserRollupService } from './user-rollup.service'

const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011')

const chain = (result: any) => {
  const node: any = {}
  node.select = jest.fn().mockReturnValue(node)
  node.sort = jest.fn().mockReturnValue(node)
  node.limit = jest.fn().mockReturnValue(node)
  node.lean = jest.fn().mockResolvedValue(result)
  return node
}

const build = (devices: any[] = [], apiKeyCount = 0) => {
  const userModel: any = {
    updateOne: jest.fn().mockResolvedValue(undefined),
    bulkWrite: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn().mockImplementation(() => chain([])),
  }
  const deviceModel: any = {
    find: jest.fn().mockImplementation(() => chain(devices)),
    findOne: jest.fn().mockImplementation(() => chain(null)),
    aggregate: jest.fn().mockResolvedValue([]),
  }
  const apiKeyModel: any = {
    countDocuments: jest.fn().mockResolvedValue(apiKeyCount),
    findOne: jest.fn().mockImplementation(() => chain(null)),
    aggregate: jest.fn().mockResolvedValue([]),
  }
  const smsModel: any = {
    findOne: jest.fn().mockImplementation(() => chain(null)),
    aggregate: jest.fn().mockResolvedValue([]),
  }
  const subscriptionModel: any = {
    find: jest.fn().mockImplementation(() => chain([])),
    aggregate: jest.fn().mockResolvedValue([]),
  }

  const service = new UserRollupService(
    userModel,
    deviceModel,
    apiKeyModel,
    smsModel,
    subscriptionModel,
  )
  return {
    service,
    userModel,
    deviceModel,
    apiKeyModel,
    smsModel,
    subscriptionModel,
  }
}

const setOf = (t: ReturnType<typeof build>) =>
  t.userModel.updateOne.mock.calls[0][1].$set

describe('UserRollupService.recomputeForUser', () => {
  it('sums the device counters and counts live API keys', async () => {
    const t = build(
      [
        { sentSMSCount: 40, appVersionCode: 19 },
        { sentSMSCount: 2, appVersionCode: 20 },
      ],
      3,
    )

    await t.service.recomputeForUser(USER_ID)

    expect(setOf(t)).toMatchObject({
      'rollup.deviceCount': 2,
      'rollup.apiKeyCount': 3,
      'rollup.totalSentSms': 42,
    })
    // A derived write must not masquerade as a change to the account.
    expect(t.userModel.updateOne.mock.calls[0][2]).toEqual({ timestamps: false })
    expect(t.apiKeyModel.countDocuments).toHaveBeenCalledWith({
      user: USER_ID,
      revokedAt: null,
    })
  })

  it('keeps the oldest app build across the account', async () => {
    const t = build([
      { sentSMSCount: 0, appVersionCode: 20 },
      { sentSMSCount: 0, appVersionCode: 17 },
      { sentSMSCount: 0, appVersionCode: 19 },
    ])

    await t.service.recomputeForUser(USER_ID)

    expect(setOf(t)['rollup.minAppVersionCode']).toBe(17)
  })

  it('prefers the heartbeat version over the registration one', async () => {
    const t = build([
      { sentSMSCount: 0, appVersionCode: 14, appVersionInfo: { versionCode: 20 } },
    ])

    await t.service.recomputeForUser(USER_ID)

    // The dashboard resolves the effective version the same way round.
    expect(setOf(t)['rollup.minAppVersionCode']).toBe(20)
  })

  it('records no version at all rather than zero when none was reported', async () => {
    const t = build([{ sentSMSCount: 5 }])

    await t.service.recomputeForUser(USER_ID)

    // Zero would read as an ancient build and wrongly demand an update.
    expect(setOf(t)['rollup.minAppVersionCode']).toBeNull()
  })

  it('handles an account with nothing on it', async () => {
    const t = build([], 0)

    await t.service.recomputeForUser(USER_ID)

    expect(setOf(t)).toMatchObject({
      'rollup.deviceCount': 0,
      'rollup.apiKeyCount': 0,
      'rollup.totalSentSms': 0,
    })
    expect(setOf(t)['rollup.computedAt']).toBeInstanceOf(Date)
  })

  it('projects the device read, since device documents are large now', async () => {
    const t = build([])
    await t.service.recomputeForUser(USER_ID)
    const node = t.deviceModel.find.mock.results[0].value
    expect(node.select).toHaveBeenCalledWith(
      'sentSMSCount appVersionCode appVersionInfo.versionCode',
    )
  })
})

describe('UserRollupService.recomputeAll', () => {
  const twoAccounts = () => [
    { _id: new Types.ObjectId() },
    { _id: new Types.ObjectId() },
  ]

  it('walks every account in id order and stops at the end', async () => {
    const t = build()
    const first = twoAccounts()
    t.userModel.find
      .mockImplementationOnce(() => chain(first))
      .mockImplementationOnce(() => chain([]))

    const processed = await t.service.recomputeAll({ batchSize: 2 })

    expect(processed).toBe(2)
    expect(t.userModel.bulkWrite).toHaveBeenCalledTimes(1)
    expect(t.userModel.bulkWrite.mock.calls[0][0]).toHaveLength(2)
  })

  it('reads each collection once per batch, not once per account', async () => {
    const t = build()
    t.userModel.find
      .mockImplementationOnce(() => chain(twoAccounts()))
      .mockImplementationOnce(() => chain([]))

    await t.service.recomputeAll({ batchSize: 2 })

    // The application and the database are in different regions, so a round trip
    // per account is the difference between minutes and hours over the base.
    expect(t.deviceModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.apiKeyModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.deviceModel.find).not.toHaveBeenCalled()
    expect(t.apiKeyModel.countDocuments).not.toHaveBeenCalled()
  })

  it('applies the grouped counts to the right account', async () => {
    const t = build()
    const [a, b] = twoAccounts()
    t.userModel.find
      .mockImplementationOnce(() => chain([a, b]))
      .mockImplementationOnce(() => chain([]))
    t.deviceModel.aggregate.mockResolvedValue([
      { _id: a._id, deviceCount: 2, totalSentSms: 42, minAppVersionCode: 17 },
    ])
    t.apiKeyModel.aggregate.mockResolvedValue([
      { _id: b._id, apiKeyCount: 3 },
    ])

    await t.service.recomputeAll({ batchSize: 2 })

    const ops = t.userModel.bulkWrite.mock.calls[0][0]
    const forA = ops.find((o: any) => String(o.updateOne.filter._id) === String(a._id))
    const forB = ops.find((o: any) => String(o.updateOne.filter._id) === String(b._id))
    expect(forA.updateOne.update.$set).toMatchObject({
      'rollup.deviceCount': 2,
      'rollup.totalSentSms': 42,
      'rollup.minAppVersionCode': 17,
      'rollup.apiKeyCount': 0,
    })
    // An account absent from a group has none of that thing, not unknown.
    expect(forB.updateOne.update.$set).toMatchObject({
      'rollup.deviceCount': 0,
      'rollup.apiKeyCount': 3,
      'rollup.minAppVersionCode': null,
    })
  })

  it('can be narrowed to accounts never computed', async () => {
    const t = build()
    t.userModel.find.mockImplementation(() => chain([]))

    await t.service.recomputeAll({ onlyMissing: true })

    expect(t.userModel.find).toHaveBeenCalledWith({
      'rollup.computedAt': { $exists: false },
    })
  })

  it('repairs the never-measured and the stale together', async () => {
    const t = build()
    t.userModel.find.mockImplementation(() => chain([]))

    await t.service.recomputeAll({ staleAfterDays: 30 })

    const filter = t.userModel.find.mock.calls[0][0]
    expect(filter.$or[0]).toEqual({ 'rollup.computedAt': { $exists: false } })
    expect(filter.$or[1]['rollup.computedAt'].$lt).toBeInstanceOf(Date)
  })

  it('stops at maxAccounts so a nightly repair stays bounded', async () => {
    const t = build()
    t.userModel.find.mockImplementation(() => chain(twoAccounts()))

    const processed = await t.service.recomputeAll({
      batchSize: 2,
      maxAccounts: 2,
    })

    expect(processed).toBe(2)
    // Would otherwise loop forever on a mock that always returns a page.
    expect(t.userModel.find).toHaveBeenCalledTimes(1)
  })
})

describe('UserRollupService.backfillMilestones', () => {
  it('writes derived dates with $min so an earlier real date always wins', async () => {
    const t = build()
    const firstSms = new Date('2026-02-01T00:00:00.000Z')
    t.userModel.find
      .mockImplementationOnce(() => chain([{ _id: USER_ID, milestones: {} }]))
      .mockImplementationOnce(() => chain([]))
    t.smsModel.aggregate.mockResolvedValue([{ _id: USER_ID, at: firstSms }])

    const processed = await t.service.backfillMilestones({ batchSize: 1 })

    expect(processed).toBe(1)
    const update = t.userModel.bulkWrite.mock.calls[0][0][0].updateOne.update
    // $min, not $set: re-running must never move a milestone forward, and a
    // genuine earlier date must survive.
    expect(update.$min).toEqual({ 'milestones.firstSmsAt': firstSms })
  })

  it('reads each collection once per batch, not once per account', async () => {
    const t = build()
    t.userModel.find
      .mockImplementationOnce(() =>
        chain([
          { _id: new Types.ObjectId(), milestones: {} },
          { _id: new Types.ObjectId(), milestones: {} },
        ]),
      )
      .mockImplementationOnce(() => chain([]))

    await t.service.backfillMilestones({ batchSize: 2 })

    // The message pass is the expensive one; per account it was a round trip
    // each, which over the whole base was hours rather than minutes.
    expect(t.smsModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.deviceModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.apiKeyModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.subscriptionModel.aggregate).toHaveBeenCalledTimes(1)
    expect(t.smsModel.findOne).not.toHaveBeenCalled()
  })

  it('reports what changed, not what was attempted', async () => {
    const t = build()
    t.userModel.find
      .mockImplementationOnce(() => chain([{ _id: USER_ID, milestones: {} }]))
      .mockImplementationOnce(() => chain([]))
    t.smsModel.findOne.mockImplementation(() => chain({ createdAt: new Date() }))
    // A re-run issues the same $min and changes nothing.
    t.userModel.bulkWrite.mockResolvedValue({ modifiedCount: 0 })

    expect(await t.service.backfillMilestones({ batchSize: 1 })).toBe(0)
  })

  /**
   * The database now computes the minimum, so these drive what the aggregation
   * returns. The expression itself (start date preferred over recorded date,
   * minimum across paid rows) is asserted separately below.
   */
  const withFirstPaidAt = (at: Date | undefined) => {
    const t = build()
    t.userModel.find
      .mockImplementationOnce(() => chain([{ _id: USER_ID, milestones: {} }]))
      .mockImplementationOnce(() => chain([]))
    t.subscriptionModel.aggregate.mockResolvedValue(
      at ? [{ _id: USER_ID, at }] : [],
    )
    return t
  }

  const paidAtOf = (t: ReturnType<typeof build>) =>
    t.userModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$min[
      'milestones.firstPaidAt'
    ]

  it('derives the first payment date, which predates the milestone', async () => {
    const startedPaying = new Date('2026-03-01T00:00:00.000Z')
    const t = withFirstPaidAt(startedPaying)

    await t.service.backfillMilestones({ batchSize: 1 })

    // Otherwise every account that paid before the milestone existed reads as
    // never having paid.
    expect(paidAtOf(t)).toEqual(startedPaying)
  })

  it('asks only about paid subscriptions, and for the earliest effective date', async () => {
    const t = withFirstPaidAt(new Date())

    await t.service.backfillMilestones({ batchSize: 1 })

    const [pipeline] = t.subscriptionModel.aggregate.mock.calls[0]
    expect(pipeline[0].$match.amount).toEqual({ $gt: 0 })
    // Start date preferred over when we recorded the row, minimum across rows:
    // the two orderings can disagree, so reading one chosen row is not enough.
    expect(pipeline[1].$group.at).toEqual({
      $min: { $ifNull: ['$subscriptionStartDate', '$createdAt'] },
    })
  })

  it('derives no payment date for an account with no paid subscription', async () => {
    const t = withFirstPaidAt(undefined)

    await t.service.backfillMilestones({ batchSize: 1 })

    expect(t.userModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('skips an account with nothing to derive', async () => {
    const t = build()
    t.userModel.find
      .mockImplementationOnce(() => chain([{ _id: USER_ID, milestones: {} }]))
      .mockImplementationOnce(() => chain([]))

    const processed = await t.service.backfillMilestones({ batchSize: 1 })

    expect(processed).toBe(0)
    expect(t.userModel.bulkWrite).not.toHaveBeenCalled()
  })
})

describe('UserRollupService.countMissing', () => {
  it('counts accounts with no rollup yet', async () => {
    const t = build()
    t.userModel.countDocuments.mockResolvedValue(17)

    expect(await t.service.countMissing()).toBe(17)
    expect(t.userModel.countDocuments).toHaveBeenCalledWith({
      'rollup.computedAt': { $exists: false },
    })
  })
})
