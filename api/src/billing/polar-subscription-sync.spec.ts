import { Types } from 'mongoose'
import { BillingService, PolarSubscriptionSync } from './billing.service'
import { decideSync, snapshotHasEnded } from './polar-subscription-sync'

// A small in-memory stand-in for the subscriptions collection, enough for the
// queries switchPlan runs, so event sequences can be replayed against it. It
// enforces the unique { polarSubscriptionId, plan } index like Mongo does.

type Row = Record<string, any>

const same = (a: unknown, b: unknown) => String(a) === String(b)

const isMissing = (value: unknown) => value === null || value === undefined

function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([field, condition]) => {
    if (field === '$or') return condition.some((branch: Row) => matches(row, branch))
    const value = row[field]
    if (condition === null) return isMissing(value)
    if (
      condition &&
      typeof condition === 'object' &&
      !(condition instanceof Types.ObjectId) &&
      !(condition instanceof Date)
    ) {
      if ('$ne' in condition) return !same(value, condition.$ne)
      if ('$lte' in condition) return !isMissing(value) && value <= condition.$lte
      if ('$in' in condition) return condition.$in.some((x: unknown) => same(value, x))
      if ('$nin' in condition) {
        return !condition.$nin.some((x: unknown) =>
          x === null ? isMissing(value) : same(value, x),
        )
      }
      throw new Error(`fake model: unsupported condition on ${field}`)
    }
    return !isMissing(value) && same(value, condition)
  })
}

function apply(row: Row, update: Row) {
  Object.assign(row, update.$set ?? {})
  for (const [field, value] of Object.entries(update.$max ?? {})) {
    if (isMissing(row[field]) || (value as any) > row[field]) row[field] = value
  }
  for (const field of Object.keys(update.$unset ?? {})) delete row[field]
}

class FakeSubscriptionModel {
  rows: Row[] = []

  seed(...rows: Row[]) {
    for (const row of rows) this.rows.push({ _id: new Types.ObjectId(), ...row })
    return this
  }

  private checkUnique(candidate: Row) {
    if (typeof candidate.polarSubscriptionId !== 'string') return
    const clash = this.rows.find(
      (row) =>
        row !== candidate &&
        row.polarSubscriptionId === candidate.polarSubscriptionId &&
        same(row.plan, candidate.plan),
    )
    if (clash) {
      throw Object.assign(new Error('E11000 duplicate key'), {
        code: 11000,
        keyPattern: { polarSubscriptionId: 1, plan: 1 },
      })
    }
  }

  async find(query: Row) {
    return this.rows.filter((row) => matches(row, query)).map((row) => ({ ...row }))
  }

  async findOneAndUpdate(query: Row, update: Row, options: Row = {}) {
    let row = this.rows.find((r) => matches(r, query))
    if (!row) {
      if (!options.upsert) return null
      row = { _id: new Types.ObjectId() }
      for (const [field, value] of Object.entries(query)) {
        if (value === null || typeof value !== 'object' || value instanceof Types.ObjectId) {
          if (value !== null) row[field] = value
        }
      }
      apply(row, update)
      this.checkUnique(row)
      this.rows.push(row)
      return { ...row }
    }
    const before = { ...row }
    apply(row, update)
    try {
      this.checkUnique(row)
    } catch (error) {
      Object.keys(row).forEach((key) => delete row[key])
      Object.assign(row, before)
      throw error
    }
    return { ...(options.new ? row : before) }
  }

  async updateMany(query: Row, update: Row) {
    const hits = this.rows.filter((row) => matches(row, query))
    hits.forEach((row) => apply(row, update))
    return { modifiedCount: hits.length }
  }

  active(user: unknown) {
    return this.rows.filter((row) => row.isActive && same(row.user, user))
  }
}

const t = (iso: string) => new Date(iso)
const now = new Date()
const past = (days: number) => new Date(now.getTime() - days * 86400000)

describe('decideSync', () => {
  const row = (fields: Record<string, any> = {}) => ({ plan: 'pro', isActive: true, ...fields })

  it.each([
    ['a revoke, whatever the status', { revoked: true, status: 'past_due' }],
    ['a canceled status', { status: 'canceled' }],
    ['an expired incomplete status', { status: 'incomplete_expired' }],
    ['an end time that passed', { status: 'active', endedAt: past(1) }],
  ])('ends on %s', (_label, snapshot) => {
    expect(decideSync({ snapshot, rows: [row()], now }).action).toBe('end')
  })

  it.each([
    ['active', { status: 'active' }],
    ['past due, while Polar retries the card', { status: 'past_due' }],
    ['trialing', { status: 'trialing' }],
    ['unpaid, while the card can still be fixed', { status: 'unpaid' }],
    ['scheduled to cancel', { status: 'active', endedAt: null }],
  ])('keeps access when %s', (_label, snapshot) => {
    expect(snapshotHasEnded(snapshot, now)).toBe(false)
  })

  it('never revives an ended subscription', () => {
    for (const ended of [row({ polarEndedAt: past(1), isActive: false }), row({ status: 'canceled' })]) {
      expect(decideSync({ snapshot: { status: 'active' }, rows: [ended], now })).toEqual({
        action: 'ignore',
        reason: 'ended',
      })
    }
  })

  it('ignores an event older than the newest one applied', () => {
    const rows = [row({ polarEventAt: t('2031-10-04T10:00:00Z') })]
    expect(
      decideSync({ snapshot: { status: 'active', modifiedAt: t('2031-10-04T09:59:59Z') }, rows, now }),
    ).toEqual({ action: 'ignore', reason: 'stale' })
    expect(
      decideSync({ snapshot: { status: 'active', modifiedAt: t('2031-10-04T10:00:00Z') }, rows, now }).action,
    ).toBe('activate')
  })

  it('never lets an event without a time override one that has one', () => {
    const rows = [row({ polarEventAt: t('2031-10-04T10:00:00Z') })]
    expect(decideSync({ snapshot: { status: 'active', modifiedAt: null }, rows, now })).toEqual({
      action: 'ignore',
      reason: 'stale',
    })
    expect(decideSync({ snapshot: { status: 'active' }, rows: [row()], now }).action).toBe('activate')
    expect(decideSync({ snapshot: { status: 'canceled' }, rows, now }).action).toBe('end')
  })

  it('keeps the plan of a row that already holds the product', () => {
    const rows = [row({ plan: 'custom0', polarProductId: 'prod_pro_y' })]
    expect(decideSync({ snapshot: { status: 'active', productId: 'prod_pro_y' }, rows, now })).toEqual({
      action: 'activate',
      keepPlan: 'custom0',
    })
    expect(decideSync({ snapshot: { status: 'active', productId: 'prod_scale_y' }, rows, now })).toEqual({
      action: 'activate',
    })
  })
})

describe('BillingService.switchPlan - Polar event sequences', () => {
  const userId = '507f1f77bcf86cd799439011'
  const plans = [
    { _id: new Types.ObjectId(), name: 'pro', polarMonthlyProductId: 'prod_pro_m', polarYearlyProductId: 'prod_pro_y' },
    { _id: new Types.ObjectId(), name: 'scale', polarMonthlyProductId: 'prod_scale_m', polarYearlyProductId: 'prod_scale_y' },
    { _id: new Types.ObjectId(), name: 'custom0' },
  ]
  const plan = (name: string) => plans.find((p) => p.name === name)!
  const planModel = {
    findOne: jest.fn(async (query: any) => {
      if (query.name) return plans.find((p) => p.name === query.name) ?? null
      const product = query.$or?.[0]?.polarMonthlyProductId
      return plans.find((p) => p.polarMonthlyProductId === product || p.polarYearlyProductId === product) ?? null
    }),
  }
  let subs: FakeSubscriptionModel
  let service: BillingService

  const event = (fields: Partial<PolarSubscriptionSync> = {}): PolarSubscriptionSync => ({
    userId,
    newPlanPolarProductId: 'prod_pro_m',
    status: 'active',
    amount: 1499,
    currency: 'usd',
    recurringInterval: 'month',
    polarSubscriptionId: 'sub_A',
    polarCustomerId: 'cus_1',
    cancelAtPeriodEnd: false,
    subscriptionStartDate: t('2031-08-13T04:12:41Z'),
    currentPeriodStart: t('2031-09-13T04:12:41Z'),
    currentPeriodEnd: t('2031-10-13T04:12:41Z'),
    modifiedAt: t('2031-09-13T06:37:00Z'),
    ...fields,
  })
  const revoked = (fields: Partial<PolarSubscriptionSync> = {}) =>
    event({ status: 'canceled', endedAt: t('2031-10-04T09:41:17Z'), modifiedAt: t('2031-10-04T09:41:18Z'), revoked: true, ...fields })
  const activeRows = () => subs.active(userId)
  const rowsOf = (id: string) => subs.rows.filter((r) => r.polarSubscriptionId === id)

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    subs = new FakeSubscriptionModel()
    service = new BillingService(
      planModel as any,
      subs as any,
      { findById: jest.fn().mockResolvedValue(null) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { markMilestone: jest.fn().mockResolvedValue(false) } as any,
      { purchase: jest.fn() } as any,
    )
  })

  afterEach(() => jest.restoreAllMocks())

  it('creates one active row from created, active and updated in any order', async () => {
    await service.switchPlan(event({ modifiedAt: t('2031-08-13T06:36:05Z') }))
    await service.switchPlan(event({ modifiedAt: t('2031-08-13T06:36:03Z') }))
    await service.switchPlan(event({ modifiedAt: t('2031-08-13T06:36:04Z') }))

    expect(subs.rows).toHaveLength(1)
    expect(activeRows()).toHaveLength(1)
    expect(subs.rows[0]).toMatchObject({ polarProductId: 'prod_pro_m', polarEventAt: t('2031-08-13T06:36:05Z') })
  })

  it('keeps one row when the same events race each other', async () => {
    await Promise.all([service.switchPlan(event()), service.switchPlan(event()), service.switchPlan(event())])

    expect(subs.rows).toHaveLength(1)
    expect(activeRows()).toHaveLength(1)
  })

  it('stays ended when a canceled update arrives after the revoke', async () => {
    await service.switchPlan(event())
    await service.switchPlan(revoked())
    await service.switchPlan(event({ status: 'canceled', endedAt: t('2031-10-04T09:41:17Z'), modifiedAt: t('2031-10-04T09:41:52Z') }))

    expect(activeRows()).toHaveLength(0)
    expect(subs.rows[0]).toMatchObject({ status: 'canceled', polarEndedAt: t('2031-10-04T09:41:17Z'), subscriptionEndDate: t('2031-10-04T09:41:17Z') })
  })

  it('stays ended when an older active update arrives after the revoke', async () => {
    await service.switchPlan(event())
    await service.switchPlan(revoked())
    await service.switchPlan(event({ status: 'past_due', modifiedAt: t('2031-10-04T10:05:00Z') }))

    expect(activeRows()).toHaveLength(0)
  })

  it('ends on an update that carries the end before the revoke arrives', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ status: 'canceled', endedAt: t('2031-10-04T09:41:17Z'), modifiedAt: t('2031-10-04T09:41:18Z') }))

    expect(activeRows()).toHaveLength(0)
  })

  it('keeps access while past due', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ status: 'past_due', modifiedAt: t('2031-09-13T06:37:25Z') }))

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].status).toBe('past_due')
  })

  it('keeps access until a scheduled cancellation ends, and clears it on uncancel', async () => {
    await service.switchPlan(event())
    subs.rows[0].churnCause = 'customer'
    await service.switchPlan(event({ cancelAtPeriodEnd: true, endsAt: t('2031-10-13T04:12:41Z'), modifiedAt: t('2031-09-20T00:00:00Z') }))
    expect(activeRows()[0]).toMatchObject({ cancelAtPeriodEnd: true, subscriptionEndDate: t('2031-10-13T04:12:41Z'), churnCause: 'customer' })

    await service.switchPlan(event({ cancelAtPeriodEnd: false, modifiedAt: t('2031-09-21T00:00:00Z') }))
    expect(activeRows()[0]).toMatchObject({ cancelAtPeriodEnd: false, subscriptionEndDate: null })
    expect(activeRows()[0].churnCause).toBeUndefined()
  })

  it('moves Pro to Scale on the same subscription and keeps the Pro row as history', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-09-20T00:00:00Z') }))

    expect(activeRows()).toHaveLength(1)
    expect(String(activeRows()[0].plan)).toBe(String(plan('scale')._id))
    expect(rowsOf('sub_A')).toHaveLength(2)
    // The subscription start, and so the billing period, does not move.
    expect(activeRows()[0].subscriptionStartDate).toEqual(t('2031-08-13T04:12:41Z'))
  })

  it('ignores a late event that still carries the old product', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-09-20T00:00:00Z') }))
    await service.switchPlan(event({ modifiedAt: t('2031-09-19T23:59:00Z') }))

    expect(String(activeRows()[0].plan)).toBe(String(plan('scale')._id))
  })

  it('moves back from Scale to Pro on the existing Pro row', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-09-20T00:00:00Z') }))
    await service.switchPlan(event({ modifiedAt: t('2031-09-25T00:00:00Z') }))

    expect(rowsOf('sub_A')).toHaveLength(2)
    expect(String(activeRows()[0].plan)).toBe(String(plan('pro')._id))
  })

  it('changes monthly to yearly on the same row', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_pro_y', recurringInterval: 'year', amount: 14999, modifiedAt: t('2031-09-20T00:00:00Z') }))

    expect(subs.rows).toHaveLength(1)
    expect(activeRows()[0]).toMatchObject({ recurringInterval: 'year', polarProductId: 'prod_pro_y', amount: 14999 })
  })

  it('changes monthly Pro to yearly Scale', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_y', recurringInterval: 'year', modifiedAt: t('2031-09-20T00:00:00Z') }))

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0]).toMatchObject({ recurringInterval: 'year', polarProductId: 'prod_scale_y' })
    expect(String(activeRows()[0].plan)).toBe(String(plan('scale')._id))
  })

  it('gives a new purchase its own row that late events of the old one cannot touch', async () => {
    await service.switchPlan(event())
    await service.switchPlan(revoked())
    await service.switchPlan(event({ polarSubscriptionId: 'sub_B', subscriptionStartDate: t('2031-10-05T00:00:00Z'), modifiedAt: t('2031-10-05T00:00:01Z') }))
    await service.switchPlan(event({ status: 'canceled', modifiedAt: t('2031-10-04T09:41:52Z') }))
    await service.switchPlan(revoked())

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].polarSubscriptionId).toBe('sub_B')
  })

  it('records an end that arrives before the start, so the start cannot revive it', async () => {
    await service.switchPlan(revoked())
    await service.switchPlan(event({ modifiedAt: t('2031-08-13T06:36:05Z') }))

    expect(activeRows()).toHaveLength(0)
    expect(rowsOf('sub_A')).toHaveLength(1)
    expect(rowsOf('sub_A')[0]).toMatchObject({ isActive: false, polarEndedAt: t('2031-10-04T09:41:17Z') })
  })

  it('ends a row stored before ids were kept, and links it', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('pro')._id, isActive: true, status: 'active', subscriptionStartDate: t('2031-08-13T04:13:05Z') })

    await service.switchPlan(revoked())

    expect(activeRows()).toHaveLength(0)
    expect(subs.rows).toHaveLength(1)
    expect(subs.rows[0]).toMatchObject({ polarSubscriptionId: 'sub_A', polarEndedAt: t('2031-10-04T09:41:17Z') })
  })

  it('replaces a plan set by hand when the user buys one', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: true, assignedBy: 'admin@example.com' })

    await service.switchPlan(event())

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].polarSubscriptionId).toBe('sub_A')
  })

  it('keeps a plan an admin set on a Polar subscription through renewals', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: true, status: 'active', polarSubscriptionId: 'sub_A', polarProductId: 'prod_pro_y' })

    await service.switchPlan(event({ newPlanPolarProductId: 'prod_pro_y', recurringInterval: 'year', currentPeriodEnd: t('2032-12-25T00:00:00Z') }))

    expect(activeRows()).toHaveLength(1)
    expect(String(activeRows()[0].plan)).toBe(String(plan('custom0')._id))
    expect(activeRows()[0].currentPeriodEnd).toEqual(t('2032-12-25T00:00:00Z'))
  })

  it('drops the hand-set plan when the user changes product', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: true, status: 'active', polarSubscriptionId: 'sub_A', polarProductId: 'prod_pro_y' })

    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_y' }))

    expect(String(activeRows()[0].plan)).toBe(String(plan('scale')._id))
  })

  it('ends a hand-set plan when its Polar subscription ends', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: true, status: 'active', polarSubscriptionId: 'sub_A', polarProductId: 'prod_pro_y' })

    await service.switchPlan(revoked({ newPlanPolarProductId: 'prod_pro_y' }))

    expect(activeRows()).toHaveLength(0)
  })

  it('lets the newest of two live subscriptions win, whichever renews', async () => {
    await service.switchPlan(event({ polarSubscriptionId: 'sub_new', newPlanPolarProductId: 'prod_scale_m', subscriptionStartDate: t('2031-06-13T00:00:00Z') }))
    await service.switchPlan(event({ polarSubscriptionId: 'sub_old', subscriptionStartDate: t('2030-02-15T00:00:00Z') }))

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].polarSubscriptionId).toBe('sub_new')
    expect(rowsOf('sub_old')[0].isActive).toBe(false)
  })

  it('finds the user from the stored row when the event has none', async () => {
    await service.switchPlan(event())
    await service.switchPlan(revoked({ userId: undefined }))

    expect(activeRows()).toHaveLength(0)
  })

  it('rejects an event it cannot place', async () => {
    await expect(service.switchPlan(event({ userId: undefined }))).rejects.toThrow('No user')
    await expect(service.switchPlan(event({ newPlanPolarProductId: 'prod_unknown' }))).rejects.toThrow('Plan not found')
  })

  it('still ends a subscription whose product is unknown', async () => {
    await service.switchPlan(event())
    await service.switchPlan(revoked({ newPlanPolarProductId: 'prod_retired' }))

    expect(activeRows()).toHaveLength(0)
  })

  it('ignores a late event without a time and keeps the newest one recorded', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-09-20T00:00:00Z') }))
    await service.switchPlan(event({ modifiedAt: null }))
    await service.switchPlan(event({ modifiedAt: undefined }))

    expect(String(activeRows()[0].plan)).toBe(String(plan('scale')._id))
    expect(subs.rows.every((r) => r.polarEventAt instanceof Date)).toBe(true)
  })

  it('hands over to the other live subscription when the active one ends', async () => {
    await service.switchPlan(event({ polarSubscriptionId: 'sub_old', subscriptionStartDate: t('2030-02-15T00:00:00Z') }))
    await service.switchPlan(event({ polarSubscriptionId: 'sub_new', newPlanPolarProductId: 'prod_scale_m', subscriptionStartDate: t('2031-06-13T00:00:00Z') }))
    expect(activeRows()[0].polarSubscriptionId).toBe('sub_new')

    await service.switchPlan(revoked({ polarSubscriptionId: 'sub_new', newPlanPolarProductId: 'prod_scale_m' }))

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].polarSubscriptionId).toBe('sub_old')
  })

  it('does not hand over to an ended, hand-set or legacy history row', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: false, assignedBy: 'admin@example.com' })
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('custom0')._id, isActive: false, status: 'active', polarSubscriptionId: 'sub_history' })
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('pro')._id, isActive: false, status: 'canceled', polarSubscriptionId: 'sub_gone' })
    await service.switchPlan(event())
    await service.switchPlan(revoked())

    expect(activeRows()).toHaveLength(0)
  })

  it('does not take a live row without an id for an unrelated old purchase', async () => {
    subs.seed({ user: new Types.ObjectId(userId), plan: plan('pro')._id, isActive: true, status: 'active', subscriptionStartDate: t('2031-03-01T00:00:00Z') })

    await service.switchPlan(revoked({ polarSubscriptionId: 'sub_old' }))

    expect(activeRows()).toHaveLength(1)
    expect(activeRows()[0].polarSubscriptionId).toBeUndefined()
    expect(rowsOf('sub_old')[0]).toMatchObject({ isActive: false })
  })

  it('records the end cause on the current row, not on plan change history', async () => {
    await service.switchPlan(event())
    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-09-20T00:00:00Z') }))
    await service.switchPlan(revoked())
    await service.recordChurnCause({ polarSubscriptionId: 'sub_A', churnCause: 'payment_failed' })

    const withCause = rowsOf('sub_A').filter((r) => r.churnCause)
    expect(withCause).toHaveLength(1)
    expect(String(withCause[0].plan)).toBe(String(plan('scale')._id))
  })

  it('surfaces a duplicate key error that is not the race it expects', async () => {
    const other = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { user: 1, isActive: 1 } })
    jest.spyOn(subs, 'findOneAndUpdate').mockRejectedValueOnce(other)

    await expect(service.switchPlan(event())).rejects.toBe(other)
  })

  it('drops an update that read the rows before a concurrent revoke wrote', async () => {
    await service.switchPlan(event())
    const stale = await subs.find({ polarSubscriptionId: 'sub_A' })
    await service.switchPlan(revoked())
    jest.spyOn(subs, 'find').mockResolvedValueOnce(stale)

    await service.switchPlan(event({ modifiedAt: t('2031-10-04T09:41:30Z') }))

    expect(activeRows()).toHaveLength(0)
    expect(subs.rows).toHaveLength(1)
  })

  it('drops an older update that raced a newer one', async () => {
    await service.switchPlan(event())
    const stale = await subs.find({ polarSubscriptionId: 'sub_A' })
    await service.switchPlan(event({ amount: 2000, modifiedAt: t('2031-09-20T00:00:00Z') }))
    jest.spyOn(subs, 'find').mockResolvedValueOnce(stale)

    await service.switchPlan(event({ amount: 1000, modifiedAt: t('2031-09-15T00:00:00Z') }))

    expect(activeRows()[0].amount).toBe(2000)
  })

  it('ends a plan change that raced the revoke of the same subscription', async () => {
    await service.switchPlan(event())
    const stale = await subs.find({ polarSubscriptionId: 'sub_A' })
    await service.switchPlan(revoked())
    jest.spyOn(subs, 'find').mockResolvedValueOnce(stale)

    await service.switchPlan(event({ newPlanPolarProductId: 'prod_scale_m', modifiedAt: t('2031-10-04T09:41:30Z') }))

    expect(activeRows()).toHaveLength(0)
    expect(rowsOf('sub_A').every((r) => r.polarEndedAt)).toBe(true)
  })

  it('applies the same event twice without change', async () => {
    await service.switchPlan(event())
    const first = JSON.stringify(subs.rows)
    await service.switchPlan(event())

    expect(JSON.stringify(subs.rows)).toBe(first)
  })
})
