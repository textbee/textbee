import { createConnection, Types } from 'mongoose'
import { AuthController } from '../auth/auth.controller'
import { BillingService } from '../billing/billing.service'
import { PlanSchema } from '../billing/schemas/plan.schema'
import { SubscriptionSchema } from '../billing/schemas/subscription.schema'
import { UserSchema } from '../users/schemas/user.schema'

// The reply shapes that released app builds read. Each build parses these
// fields with fixed types, so a field that changes type or disappears
// breaks the greeting, the account row or the plan card on every phone.

// Real documents, without a database, so the replies go through the same
// conversion to JSON as a live request
const connection = createConnection()
const Users = connection.model('User', UserSchema)
const Plans = connection.model('Plan', PlanSchema)
const Subscriptions = connection.model('Subscription', SubscriptionSchema)

const asSent = (value: unknown) => JSON.parse(JSON.stringify(value))
const INT_MAX = 2 ** 31 - 1
const isInt32 = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= -INT_MAX - 1 && (value as number) <= INT_MAX
const stringOrNull = (value: unknown) => value === null || typeof value === 'string'

describe('app replies: GET /auth/who-am-i', () => {
  const controller = new AuthController({} as any, {} as any, {} as any, {} as any)
  const user = new Users({
    name: 'Sam Example',
    email: 'sam@example.com',
    phone: '+15555550123',
  })

  it('a hand-made key: name and email are strings, accountLabel is the email', async () => {
    const { data } = asSent(await controller.whoAmI({ user, apiKey: { _id: new Types.ObjectId() } }))
    expect(stringOrNull(data.name)).toBe(true)
    expect(stringOrNull(data.email)).toBe(true)
    expect(data).toMatchObject({ name: 'Sam Example', email: 'sam@example.com' })
    expect(typeof data.accountLabel).toBe('string')
    // The same text as the sign-in poll answer's accountEmail
    expect(data.accountLabel).toBe('sam@example.com')
    // Exactly the answer of today plus the one new field
    expect(data).toEqual({ ...asSent(user), accountLabel: 'sam@example.com' })
  })

  it('a sign-in key: exactly name, email and accountLabel, all strings', async () => {
    const apiKey = { _id: new Types.ObjectId(), source: 'device-link', linkedDevice: new Types.ObjectId() }
    const { data } = asSent(await controller.whoAmI({ user, apiKey }))
    expect(Object.keys(data).sort()).toEqual(['accountLabel', 'email', 'name'])
    expect(data).toEqual({
      name: 'Sam Example',
      email: 'sam@example.com',
      accountLabel: 'sam@example.com',
    })
  })

  it('a login session: name and email are strings, no accountLabel', async () => {
    const { data } = asSent(await controller.whoAmI({ user }))
    expect(stringOrNull(data.name)).toBe(true)
    expect(stringOrNull(data.email)).toBe(true)
    expect(data).toMatchObject({ name: 'Sam Example', email: 'sam@example.com' })
    expect(data).not.toHaveProperty('accountLabel')
    expect(data).toEqual(asSent(user))
  })
})

describe('app replies: GET /billing/current-subscription', () => {
  const user = { _id: new Types.ObjectId(), createdAt: new Date('2026-01-17T10:00:00Z') }
  const free = new Plans({
    name: 'free',
    dailyLimit: 50,
    monthlyLimit: 300,
    bulkSendLimit: 50,
    monthlyPrice: 0,
  })
  const pro = new Plans({
    name: 'pro',
    dailyLimit: -1,
    monthlyLimit: 5000,
    bulkSendLimit: -1,
    monthlyPrice: 990,
  })

  const service = (subscription: unknown) =>
    new BillingService(
      { findOne: jest.fn().mockResolvedValue(free) } as any,
      { findOne: jest.fn(() => ({ populate: jest.fn().mockResolvedValue(subscription) })) } as any,
      {} as any,
      { countDocuments: jest.fn().mockResolvedValue(12) } as any,
      {} as any,
      {} as any,
      { notifyOnce: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      { getLivePromotion: async () => null } as any,
    )

  // What the app reads, with the types it parses
  const expectAppShape = (reply: any) => {
    expect(typeof reply.plan).toBe('object')
    expect(reply.plan).not.toBeNull()
    expect(typeof reply.plan.name).toBe('string')
    if ('displayName' in reply.plan) expect(stringOrNull(reply.plan.displayName)).toBe(true)
    if ('currentPeriodStart' in reply) expect(stringOrNull(reply.currentPeriodStart)).toBe(true)
    if ('currentPeriodEnd' in reply) expect(stringOrNull(reply.currentPeriodEnd)).toBe(true)
    expect(typeof reply.isActive).toBe('boolean')
    expect(typeof reply.usage).toBe('object')
    for (const field of [
      'processedSmsToday',
      'processedSmsLastMonth',
      'dailyLimit',
      'monthlyLimit',
      'dailyRemaining',
      'monthlyRemaining',
      'dailyUsagePercentage',
      'monthlyUsagePercentage',
    ]) {
      expect([field, isInt32(reply.usage[field])]).toEqual([field, true])
    }
  }

  it('an account without a subscription gets the free plan named "free"', async () => {
    const reply = asSent(await service(null).getCurrentSubscription(user))
    expectAppShape(reply)
    expect(reply.plan.name).toBe('free')
    expect(reply.isActive).toBe(true)
    expect(reply.usage).toMatchObject({ processedSmsToday: 12, dailyLimit: 50, monthlyLimit: 300 })
  })

  it('a paid subscription: plan object, period end as a date string, -1 for unlimited', async () => {
    const subscription = new Subscriptions({
      user: user._id,
      plan: pro,
      isActive: true,
      currentPeriodStart: new Date('2026-11-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    })
    const reply = asSent(await service(subscription).getCurrentSubscription(user))
    expectAppShape(reply)
    expect(reply.plan.name).toBe('pro')
    expect(reply.currentPeriodEnd).toBe('2026-12-01T00:00:00.000Z')
    expect(reply.usage).toMatchObject({ dailyLimit: -1, dailyRemaining: -1, monthlyLimit: 5000 })
  })
})
