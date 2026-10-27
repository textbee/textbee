import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import { NotificationMetricsService } from './notification-metrics.service'
import { NotificationsService } from './notifications.service'

const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011')
const OTHER_USER_ID = new Types.ObjectId('507f1f77bcf86cd799439022')
const NOTIFICATION_ID = new Types.ObjectId('507f1f77bcf86cd7994390aa')

const user = (id = USER_ID) => ({ _id: id }) as any

const chain = (result: any) => {
  const node: any = {}
  node.select = jest.fn().mockReturnValue(node)
  node.populate = jest.fn().mockReturnValue(node)
  node.sort = jest.fn().mockReturnValue(node)
  node.limit = jest.fn().mockReturnValue(node)
  node.lean = jest.fn().mockResolvedValue(result)
  return node
}

const activeRecord = (over: Record<string, any> = {}) => ({
  _id: NOTIFICATION_ID,
  key: 'example-campaign',
  kind: 'campaign',
  placement: 'tile',
  tone: 'promo',
  renderer: 'standard',
  priority: 1,
  weight: 1,
  group: null,
  audience: null,
  schedule: null,
  dismiss: { enabled: true, mode: 'permanent' },
  frequency: null,
  variants: [{ id: 'v1', title: 'Go Pro', weight: 1 }],
  stats: {},
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...over,
})

const build = (settingsOver: Record<string, any> = {}, records: any[] = []) => {
  const settings = {
    scope: 'default',
    engineEnabled: false,
    engineEnabledForUserIds: [],
    globalEnabled: true,
    maxTilesAtOnce: 2,
    maxSystemTilesAtOnce: 2,
    overflowTiles: 3,
    maxModalsPerLoad: 1,
    modalMinIntervalHours: 24,
    latestAppVersionCode: 20,
    ...settingsOver,
  }

  const notificationModel: any = {
    find: jest.fn().mockImplementation(() => chain(records)),
    findById: jest.fn().mockImplementation(() => chain(records[0] ?? null)),
    updateOne: jest.fn().mockResolvedValue(undefined),
    bulkWrite: jest.fn().mockResolvedValue(undefined),
  }
  const stateModel: any = {
    find: jest.fn().mockImplementation(() => chain([])),
    updateOne: jest.fn().mockResolvedValue(undefined),
    // Returns the row as it was, so a repeat dismissal is recognisable.
    findOneAndUpdate: jest.fn().mockImplementation(() => chain(null)),
    bulkWrite: jest.fn().mockResolvedValue(undefined),
    estimatedDocumentCount: jest.fn().mockResolvedValue(0),
  }
  const settingsModel: any = {
    findOne: jest.fn().mockResolvedValue(settings),
    findOneAndUpdate: jest.fn().mockResolvedValue(settings),
  }
  const contextLoader: any = { build: jest.fn().mockResolvedValue({}) }

  // The real accumulator over a fake collection, so the counters a feed
  // produces are asserted as they would be written.
  const statsModel: any = { updateOne: jest.fn().mockResolvedValue(undefined) }
  const metrics = new NotificationMetricsService(statsModel)

  const service = new NotificationsService(
    notificationModel,
    stateModel,
    settingsModel,
    contextLoader,
    metrics,
  )

  return {
    service,
    notificationModel,
    stateModel,
    settingsModel,
    contextLoader,
    settings,
    metrics,
    statsModel,
  }
}

/** The merged $inc of the one write a flush sends. */
const flushedInc = async (t: {
  metrics: NotificationMetricsService
  statsModel: any
}): Promise<Record<string, number>> => {
  await t.metrics.flush()
  expect(t.statsModel.updateOne).toHaveBeenCalledTimes(1)
  return t.statsModel.updateOne.mock.calls[0][1].$inc ?? {}
}

describe('NotificationsService feed and the engine flag', () => {
  it('does no work at all when the engine is off', async () => {
    const t = build({ engineEnabled: false }, [activeRecord()])

    const feed = await t.service.getFeed(user())

    expect(feed).toEqual({
      engineEnabled: false,
      settings: null,
      notifications: [],
    })
    // The dashboard renders its original banners on this answer, so nothing
    // beyond the settings read should have happened.
    expect(t.notificationModel.find).not.toHaveBeenCalled()
    expect(t.stateModel.find).not.toHaveBeenCalled()
    expect(t.contextLoader.build).not.toHaveBeenCalled()
  })

  it('reads settings without caching them, so a rollback applies at once', async () => {
    const t = build({ engineEnabled: false })

    await t.service.getFeed(user())
    await t.service.getFeed(user())
    await t.service.getFeed(user())

    expect(t.settingsModel.findOne).toHaveBeenCalledTimes(3)
  })

  it('turns the engine on for an allowlisted account only', async () => {
    const t = build(
      { engineEnabled: false, engineEnabledForUserIds: [String(USER_ID)] },
      [activeRecord()],
    )

    const allowlisted = await t.service.getFeed(user(USER_ID))
    expect(allowlisted.engineEnabled).toBe(true)
    expect(allowlisted.notifications.map((n) => n.key)).toEqual([
      'example-campaign',
    ])

    const control = await t.service.getFeed(user(OTHER_USER_ID))
    expect(control.engineEnabled).toBe(false)
    expect(control.notifications).toEqual([])
  })

  it('serves nothing but stays on the engine when globally silenced', async () => {
    const t = build({ engineEnabled: true, globalEnabled: false }, [
      activeRecord(),
    ])

    const feed = await t.service.getFeed(user())

    // Distinct from the rollback: the dashboard must not fall back to its own
    // banners here, because silence was the instruction.
    expect(feed.engineEnabled).toBe(true)
    expect(feed.notifications).toEqual([])
    expect(t.notificationModel.find).not.toHaveBeenCalled()
  })

  it('serves a finished, ranked list', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])

    const feed = await t.service.getFeed(user())

    expect(feed.notifications).toHaveLength(1)
    expect(feed.notifications[0]).toMatchObject({
      key: 'example-campaign',
      rank: 1,
      variantId: 'v1',
      title: 'Go Pro',
      dismissible: true,
    })
    expect(feed.settings).toEqual({ maxTilesAtOnce: 2, maxModalsPerLoad: 1 })
  })

  it('asks the loader only for the attributes some audience mentions', async () => {
    const t = build({ engineEnabled: true }, [
      activeRecord({
        audience: {
          all: [
            { attr: 'subscription.planName', op: 'eq', value: 'free' },
            { attr: 'user.accountAgeDays', op: 'gte', value: 30 },
          ],
        },
      }),
    ])

    await t.service.getFeed(user())

    const referenced = [...t.contextLoader.build.mock.calls[0][0].referenced]
    expect(referenced.sort()).toEqual(
      ['subscription.planName', 'user.accountAgeDays'].sort(),
    )
    // Nothing referenced usage, so the loader must not be told to count messages.
    expect(referenced).not.toContain('usage.monthlyPercent')
  })

  it('caches the candidate list but not across a manual clear', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])

    await t.service.getFeed(user())
    await t.service.getFeed(user())
    expect(t.notificationModel.find).toHaveBeenCalledTimes(1)

    t.service.clearCandidateCache()
    await t.service.getFeed(user())
    expect(t.notificationModel.find).toHaveBeenCalledTimes(2)
  })

  it('creates the settings document with the engine off when none exists', async () => {
    const t = build()
    t.settingsModel.findOne.mockResolvedValueOnce(null)

    await t.service.getSettings()

    expect(t.settingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { scope: 'default' },
      { $setOnInsert: { scope: 'default', engineEnabled: false } },
      expect.objectContaining({ upsert: true }),
    )
  })
})

describe('NotificationsService.recordEvents', () => {
  const knownRecord = { _id: NOTIFICATION_ID }

  const withKnown = (
    records: any[] = [activeRecord()],
    dismiss: any = { enabled: true, mode: 'permanent' },
  ) => {
    const t = build({ engineEnabled: true }, records)
    t.notificationModel.find.mockImplementation(() =>
      chain([{ ...knownRecord, dismiss }]),
    )
    return t
  }

  it('accepts nothing when given nothing', async () => {
    const t = withKnown()
    expect(await t.service.recordEvents(user(), [])).toEqual({ recorded: 0 })
    expect(t.stateModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('refuses an oversized batch', async () => {
    const t = withKnown()
    const events = Array.from({ length: 21 }, () => ({
      notificationId: String(NOTIFICATION_ID),
      type: 'impression' as const,
    }))
    await expect(t.service.recordEvents(user(), events)).rejects.toThrow(
      BadRequestException,
    )
  })

  it('records an impression against the account and the record', async () => {
    const t = withKnown()

    const result = await t.service.recordEvents(user(), [
      {
        notificationId: String(NOTIFICATION_ID),
        type: 'impression',
        variantId: 'v1',
      },
    ])

    expect(result).toEqual({ recorded: 1 })

    const stateOp = t.stateModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(stateOp.upsert).toBe(true)
    expect(stateOp.update.$inc).toEqual({ impressions: 1 })
    expect(stateOp.update.$set.lastVariantId).toBe('v1')
    expect(stateOp.update.$setOnInsert.firstSeenAt).toBeInstanceOf(Date)

    const statsOp = t.notificationModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(statsOp.update.$inc).toEqual({
      'stats.impressions': 1,
      'stats.byVariant.v1.impressions': 1,
    })
  })

  it('collapses repeat events for one record into a single write', async () => {
    const t = withKnown()

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
      { notificationId: String(NOTIFICATION_ID), type: 'click' },
    ])

    expect(t.stateModel.bulkWrite.mock.calls[0][0]).toHaveLength(1)
    const statsOp = t.notificationModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(statsOp.update.$inc['stats.impressions']).toBe(1)
    expect(statsOp.update.$inc['stats.clicks']).toBe(1)
  })

  it('ignores events for records that do not exist', async () => {
    const t = withKnown()
    t.notificationModel.find.mockImplementation(() => chain([]))

    const result = await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
    ])

    expect(result).toEqual({ recorded: 0 })
    expect(t.stateModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('skips malformed ids and unknown types without failing the batch', async () => {
    const t = withKnown()

    const result = await t.service.recordEvents(user(), [
      { notificationId: 'not-an-id', type: 'impression' },
      { notificationId: String(NOTIFICATION_ID), type: 'nonsense' as any },
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
    ])

    expect(result).toEqual({ recorded: 1 })
  })

  it('records a dismissal event for a record that allows dismissing', async () => {
    const t = withKnown()

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'dismiss' },
    ])

    const stateOp = t.stateModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(stateOp.update.$set.dismissedAt).toBeInstanceOf(Date)
  })

  it('ignores a dismissal event for a record that cannot be dismissed', async () => {
    const t = withKnown([activeRecord()], { enabled: false })

    const result = await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'dismiss' },
    ])

    // Otherwise one request could permanently hide an operational alert: the
    // ranker treats dismissedAt in permanent mode as cleared for good, so a
    // past-due or verification warning would never be shown again.
    expect(result).toEqual({ recorded: 0 })
    expect(t.stateModel.bulkWrite).not.toHaveBeenCalled()
    expect(t.notificationModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('still records an impression for a record that cannot be dismissed', async () => {
    const t = withKnown([activeRecord()], { enabled: false })

    const result = await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
    ])

    expect(result).toEqual({ recorded: 1 })
  })

  it('snoozes a dismissal event on a snooze-mode record, not just stamps it', async () => {
    const t = withKnown([activeRecord()], {
      enabled: true,
      mode: 'snooze',
      snoozeHours: 24,
    })

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'dismiss' },
    ])

    const update = t.stateModel.bulkWrite.mock.calls[0][0][0].updateOne.update
    // The ranker reads snoozedUntil for this mode, so stamping only dismissedAt
    // would record a dismissal that hid nothing. This is the path the legacy
    // migration uses.
    expect(update.$set.dismissedAt).toBeInstanceOf(Date)
    expect(update.$set.snoozedUntil).toBeInstanceOf(Date)
    expect(update.$set.snoozedUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('leaves no snooze on a permanent record', async () => {
    const t = withKnown()

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'dismiss' },
    ])

    const update = t.stateModel.bulkWrite.mock.calls[0][0][0].updateOne.update
    expect(update.$set.snoozedUntil).toBeUndefined()
  })

  it('refuses to build an update path out of an unsafe variant id', async () => {
    const t = withKnown()

    await t.service.recordEvents(user(), [
      {
        notificationId: String(NOTIFICATION_ID),
        type: 'impression',
        // A dotted or dollar-prefixed id would otherwise rewrite an unintended
        // part of the document.
        variantId: 'a.b.$set',
      },
    ])

    const statsOp = t.notificationModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(Object.keys(statsOp.update.$inc)).toEqual(['stats.impressions'])
  })
})

describe('NotificationsService.dismiss', () => {
  it('rejects an unknown id', async () => {
    const t = build()
    await expect(t.service.dismiss(user(), 'nope')).rejects.toThrow(
      BadRequestException,
    )
  })

  it('refuses a record that is not dismissible', async () => {
    const t = build({}, [activeRecord({ dismiss: { enabled: false } })])
    await expect(
      t.service.dismiss(user(), String(NOTIFICATION_ID)),
    ).rejects.toThrow('cannot be dismissed')
  })

  it('records a permanent dismissal', async () => {
    const t = build({}, [
      activeRecord({ dismiss: { enabled: true, mode: 'permanent' } }),
    ])

    await t.service.dismiss(user(), String(NOTIFICATION_ID))

    const update = t.stateModel.findOneAndUpdate.mock.calls[0][1]
    expect(update.$set.dismissedAt).toBeInstanceOf(Date)
    expect(update.$set.snoozedUntil).toBeUndefined()
    expect(update.$inc).toEqual({ dismissCount: 1 })
    expect(t.notificationModel.updateOne).toHaveBeenCalledWith(
      { _id: String(NOTIFICATION_ID) },
      { $inc: { 'stats.dismisses': 1 } },
    )
  })

  it('counts stats.dismisses once when the same account dismisses twice', async () => {
    const t = build({}, [
      activeRecord({ dismiss: { enabled: true, mode: 'snooze', snoozeHours: 6 } }),
    ])
    // First call inserts the row, so there is no earlier dismissal. The second
    // sees the one the first left behind.
    t.stateModel.findOneAndUpdate
      .mockImplementationOnce(() => chain(null))
      .mockImplementationOnce(() => chain({ dismissedAt: new Date() }))

    await t.service.dismiss(user(), String(NOTIFICATION_ID))
    await t.service.dismiss(user(), String(NOTIFICATION_ID))

    // A snooze-mode record comes back and can be cleared again every visit.
    // Counting each pass would inflate the one number copy is judged by.
    expect(t.notificationModel.updateOne).toHaveBeenCalledTimes(1)
    expect(t.stateModel.findOneAndUpdate).toHaveBeenCalledTimes(2)
    // The raw count per account still moves both times.
    expect(t.stateModel.findOneAndUpdate.mock.calls[1][1].$inc).toEqual({
      dismissCount: 1,
    })

    const inc = await flushedInc(t)
    expect(inc[`dismissesById.${NOTIFICATION_ID}`]).toBe(1)
  })

  it('sets a snooze window when the record snoozes', async () => {
    const t = build({}, [
      activeRecord({ dismiss: { enabled: true, mode: 'snooze', snoozeHours: 6 } }),
    ])

    await t.service.dismiss(user(), String(NOTIFICATION_ID))

    const update = t.stateModel.findOneAndUpdate.mock.calls[0][1]
    expect(update.$set.snoozedUntil).toBeInstanceOf(Date)
    expect(update.$set.snoozedUntil.getTime()).toBeGreaterThan(Date.now())
  })

  it('clamps an absurd caller-supplied snooze', async () => {
    const t = build({}, [
      activeRecord({ dismiss: { enabled: true, mode: 'snooze', snoozeHours: 6 } }),
    ])

    await t.service.dismiss(user(), String(NOTIFICATION_ID), 10_000_000)

    const update = t.stateModel.findOneAndUpdate.mock.calls[0][1]
    const years =
      (update.$set.snoozedUntil.getTime() - Date.now()) /
      (365 * 24 * 60 * 60 * 1000)
    expect(years).toBeLessThanOrEqual(1.01)
  })
})

// Four of the five ways a feed can end return an empty list, and from outside
// they are identical. Each has to be countable on its own, or an empty
// dashboard cannot be explained.
describe('NotificationsService feed counters', () => {
  const SECOND_ID = new Types.ObjectId('507f1f77bcf86cd7994390bb')

  it('counts the engine being off for this account', async () => {
    const t = build({ engineEnabled: false }, [activeRecord()])

    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    expect(inc.feeds).toBe(1)
    expect(inc.feedsEngineOff).toBe(1)
    expect(inc.feedsGlobalOff).toBeUndefined()
    expect(inc.feedsNoCandidates).toBeUndefined()
    expect(inc.feedsZeroServed).toBeUndefined()
  })

  it('counts the kill switch apart from the rollback', async () => {
    const t = build({ engineEnabled: true, globalEnabled: false }, [
      activeRecord(),
    ])

    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    expect(inc.feeds).toBe(1)
    expect(inc.feedsGlobalOff).toBe(1)
    expect(inc.feedsEngineOff).toBeUndefined()
  })

  it('counts having nothing active to choose from', async () => {
    const t = build({ engineEnabled: true }, [])

    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    expect(inc.feeds).toBe(1)
    expect(inc.feedsNoCandidates).toBe(1)
    expect(inc.feedsZeroServed).toBeUndefined()
  })

  it('counts an engine that held everything back separately', async () => {
    const t = build({ engineEnabled: true }, [
      activeRecord({
        audience: {
          all: [{ attr: 'user.accountAgeDays', op: 'gte', value: 30 }],
        },
      }),
    ])

    const feed = await t.service.getFeed(user())
    expect(feed.notifications).toEqual([])

    const inc = await flushedInc(t)
    // The dangerous one: the engine was on and there was something to show.
    expect(inc.feedsZeroServed).toBe(1)
    expect(inc.feedsNoCandidates).toBeUndefined()
    expect(inc[`filteredByIdReason.${NOTIFICATION_ID}:audience_failed`]).toBe(1)
    expect(inc['filteredByReason.audience_failed']).toBe(1)
  })

  it('counts an error and still rethrows it', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])
    t.settingsModel.findOne.mockRejectedValueOnce(new Error('atlas is away'))

    await expect(t.service.getFeed(user())).rejects.toThrow('atlas is away')

    const inc = await flushedInc(t)
    // A 500 drops the dashboard back to its built-in messages, which is what a
    // switched-off engine looks like too.
    expect(inc.feeds).toBe(1)
    expect(inc.feedsErrored).toBe(1)
  })

  it('counts a served feed, its latency and the candidate cache', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])

    await t.service.getFeed(user())
    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    expect(inc.feeds).toBe(2)
    expect(inc[`servedById.${NOTIFICATION_ID}`]).toBe(2)
    expect(inc.candidateCacheMisses).toBe(1)
    expect(inc.candidateCacheHits).toBe(1)
    expect(inc.latencyMsTotal).toBeGreaterThanOrEqual(0)
    const buckets = Object.keys(inc).filter((path) =>
      path.startsWith('latencyBuckets.'),
    )
    expect(buckets).toHaveLength(1)
    expect(inc[buckets[0]]).toBe(2)
  })

  it('counts an unknown attribute once per feed, not once per node', async () => {
    const t = build({ engineEnabled: true }, [
      activeRecord({
        // The loader returns nothing for this account, so both leaves are
        // unjudgeable. That is one account we cannot judge, not two.
        audience: {
          all: [
            { attr: 'stats.deviceCount', op: 'gte', value: 1 },
            { attr: 'stats.deviceCount', op: 'lte', value: 5 },
          ],
        },
      }),
    ])

    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    // Dots are swapped for underscores: an attribute key would otherwise read
    // as a path and write into the wrong part of the document.
    expect(inc['unknownAttrs.stats_deviceCount']).toBe(1)
    expect(inc['unknownAttrs.stats.deviceCount']).toBeUndefined()
  })

  const systemRecord = (
    id: Types.ObjectId,
    key: string,
    dismissible: boolean,
  ) =>
    activeRecord({
      _id: id,
      key,
      kind: 'system',
      placement: 'tile',
      dismiss: { enabled: dismissible, mode: 'permanent' },
    })

  it('counts an account whose budget went entirely to undismissable alerts', async () => {
    const t = build({ engineEnabled: true, maxSystemTilesAtOnce: 1 }, [
      systemRecord(NOTIFICATION_ID, 'past-due', false),
      systemRecord(SECOND_ID, 'example-verify', false),
    ])

    const feed = await t.service.getFeed(user())
    expect(feed.notifications).toHaveLength(1)

    const inc = await flushedInc(t)
    expect(inc.capBlockedBySystem).toBe(1)
    expect(inc['filteredByReason.capped']).toBe(1)
    const sample = t.statsModel.updateOne.mock.calls[0][1].$addToSet
    expect(sample).toEqual({ capBlockedSample: { $each: [String(USER_ID)] } })
  })

  it('does not count it when the account could clear the tile itself', async () => {
    const t = build({ engineEnabled: true, maxSystemTilesAtOnce: 1 }, [
      systemRecord(NOTIFICATION_ID, 'past-due', true),
      systemRecord(SECOND_ID, 'example-verify', true),
    ])

    await t.service.getFeed(user())

    const inc = await flushedInc(t)
    expect(inc['filteredByReason.capped']).toBe(1)
    expect(inc.capBlockedBySystem).toBeUndefined()
    expect(t.statsModel.updateOne.mock.calls[0][1].$addToSet).toBeUndefined()
  })

  it('sends one write for the whole window, with the counters merged', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])

    await t.service.getFeed(user())
    await t.service.getFeed(user(OTHER_USER_ID))
    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
    ])

    await t.metrics.flush()

    // 1,440 writes a day whatever the traffic, and none of them on the feed
    // request path.
    expect(t.statsModel.updateOne).toHaveBeenCalledTimes(1)
    const [filter, update, options] = t.statsModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ day: new Date().toISOString().slice(0, 10) })
    expect(options).toEqual({ upsert: true })
    expect(update.$setOnInsert).toEqual({ day: filter.day })
    expect(update.$inc.feeds).toBe(2)
    expect(update.$inc[`servedById.${NOTIFICATION_ID}`]).toBe(2)
    expect(update.$inc[`impressionsById.${NOTIFICATION_ID}`]).toBe(1)

    // Nothing left to send, so the next tick writes nothing at all.
    await t.metrics.flush()
    expect(t.statsModel.updateOne).toHaveBeenCalledTimes(1)
  })

  it('counts a replayed dismissal apart from a real one', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])
    t.notificationModel.find.mockImplementation(() =>
      chain([{ _id: NOTIFICATION_ID, dismiss: { enabled: true } }]),
    )

    await t.service.recordEvents(user(), [
      {
        notificationId: String(NOTIFICATION_ID),
        type: 'dismiss',
        source: 'migration',
      },
    ])

    const statsOp = t.notificationModel.bulkWrite.mock.calls[0][0][0].updateOne
    // No impression was ever recorded for these, so counting them as
    // dismissals would read as a dismiss rate above 100%.
    expect(statsOp.update.$inc).toEqual({ 'stats.migratedDismisses': 1 })

    const inc = await flushedInc(t)
    expect(inc[`migratedDismissesById.${NOTIFICATION_ID}`]).toBe(1)
    expect(inc[`dismissesById.${NOTIFICATION_ID}`]).toBeUndefined()
  })

  it('stamps first and last impression on the write already going out', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])
    t.notificationModel.find.mockImplementation(() =>
      chain([{ _id: NOTIFICATION_ID, dismiss: { enabled: true } }]),
    )

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'impression' },
    ])

    const statsOp = t.notificationModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(statsOp.update.$max['stats.lastImpressionAt']).toBeInstanceOf(Date)
    expect(statsOp.update.$min['stats.firstImpressionAt']).toBeInstanceOf(Date)
  })

  it('counts a click per account as well as stamping the time', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])
    t.notificationModel.find.mockImplementation(() =>
      chain([{ _id: NOTIFICATION_ID, dismiss: { enabled: true } }]),
    )

    await t.service.recordEvents(user(), [
      { notificationId: String(NOTIFICATION_ID), type: 'click' },
      { notificationId: String(NOTIFICATION_ID), type: 'click' },
    ])

    const stateOp = t.stateModel.bulkWrite.mock.calls[0][0][0].updateOne
    expect(stateOp.update.$inc).toEqual({ clicks: 2 })
  })

  it('flushes the open window on shutdown', async () => {
    const t = build({ engineEnabled: true }, [activeRecord()])

    await t.service.getFeed(user())
    // A pm2 reload would otherwise drop up to 60 seconds of counters.
    await t.metrics.onApplicationShutdown()

    expect(t.statsModel.updateOne).toHaveBeenCalledTimes(1)
    expect(t.statsModel.updateOne.mock.calls[0][1].$inc.feeds).toBe(1)
  })
})
