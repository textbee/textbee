import { Types } from 'mongoose'
import { NotificationContextLoader } from './context-loader'

const USER_ID = new Types.ObjectId('507f1f77bcf86cd799439011')
const NOW = new Date('2026-09-27T12:00:00.000Z')

const chain = (result: any) => {
  const node: any = {}
  node.select = jest.fn().mockReturnValue(node)
  node.populate = jest.fn().mockReturnValue(node)
  node.sort = jest.fn().mockReturnValue(node)
  node.lean = jest.fn().mockResolvedValue(result)
  return node
}

const build = (
  over: {
    subscription?: any
    plan?: any
    waived?: boolean
    lastSent?: any
    device?: any
  } = {},
) => {
  const subscriptionModel: any = {
    findOne: jest.fn().mockImplementation(() => chain(over.subscription ?? null)),
  }
  const planModel: any = {
    findOne: jest
      .fn()
      .mockImplementation(() =>
        chain(over.plan ?? { name: 'free', monthlyPrice: 0, monthlyLimit: 500, dailyLimit: 50 }),
      ),
  }
  const userModel: any = {
    findById: jest
      .fn()
      .mockImplementation(() =>
        chain({ emailVerificationWaivedAt: over.waived ? NOW : undefined }),
      ),
  }
  const smsModel: any = {
    countDocuments: jest.fn().mockResolvedValue(7),
    findOne: jest.fn().mockImplementation(() => chain(over.lastSent ?? null)),
  }
  const deviceModel: any = {
    findById: jest.fn().mockImplementation(() => chain(over.device ?? null)),
  }

  const loader = new NotificationContextLoader(
    subscriptionModel,
    planModel,
    userModel,
    smsModel,
    deviceModel,
  )
  return { loader, subscriptionModel, planModel, userModel, smsModel, deviceModel }
}

const account = (over: Record<string, any> = {}) =>
  ({
    _id: USER_ID,
    createdAt: new Date('2026-08-28T12:00:00.000Z'),
    emailVerifiedAt: undefined,
    role: 'REGULAR',
    access: { countries: ['US', 'CA'] },
    milestones: {},
    onboarding: { currentStepId: 'verify_email' },
    rollup: {},
    ...over,
  }) as any

const settings = { latestAppVersionCode: 20 }

describe('attribute groups are loaded only when referenced', () => {
  it('reads nothing beyond the account for a plain audience', async () => {
    const t = build()

    await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['user.accountAgeDays', 'milestones.hasDevice'],
    })

    expect(t.subscriptionModel.findOne).not.toHaveBeenCalled()
    expect(t.smsModel.countDocuments).not.toHaveBeenCalled()
    expect(t.smsModel.findOne).not.toHaveBeenCalled()
    expect(t.userModel.findById).not.toHaveBeenCalled()
  })

  it('reads the subscription only when plan attributes are referenced', async () => {
    const t = build()

    await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['subscription.planName'],
    })

    expect(t.subscriptionModel.findOne).toHaveBeenCalledTimes(1)
    // Still no message counting: that is the expensive part.
    expect(t.smsModel.countDocuments).not.toHaveBeenCalled()
  })

  it('counts messages only when usage attributes are referenced', async () => {
    const t = build()

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['usage.monthlyPercent'],
    })

    expect(t.smsModel.countDocuments).toHaveBeenCalledTimes(2)
    expect(context['usage.monthlyCount']).toBe(7)
  })

  it('reads the waiver only when it is referenced, since it is select:false', async () => {
    const t = build({ waived: true })

    const without = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['user.emailVerified'],
    })
    expect(t.userModel.findById).not.toHaveBeenCalled()
    expect(without['user.verificationWaived']).toBeUndefined()

    const withWaiver = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['user.verificationWaived'],
    })
    expect(withWaiver['user.verificationWaived']).toBe(true)
  })
})

describe('account attributes', () => {
  it('turns an absent verification date into a real false', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({ emailVerifiedAt: undefined }),
      settings,
      now: NOW,
      referenced: [],
    })
    // Not undefined: unverified accounts have no date at all, and treating that
    // as unjudgeable would stop the verify-email notice reaching anyone.
    expect(context['user.emailVerified']).toBe(false)
  })

  it('computes account age in whole days', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: [],
    })
    expect(context['user.accountAgeDays']).toBe(30)
  })

  it('falls back to the signup client when none has been seen since', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({ client: { signup: { os: 'Android', browser: 'Chrome' } } }),
      settings,
      now: NOW,
      referenced: [],
    })
    expect(context['client.os']).toBe('Android')
    expect(context['client.daysSinceLastSeen']).toBeUndefined()
  })
})

describe('stats come from the rollup', () => {
  it('reports counts and an outdated app', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({
        rollup: {
          deviceCount: 2,
          apiKeyCount: 1,
          totalSentSms: 940,
          minAppVersionCode: 17,
          computedAt: NOW,
        },
      }),
      settings,
      now: NOW,
      referenced: [],
    })

    expect(context['stats.deviceCount']).toBe(2)
    expect(context['stats.totalSentSms']).toBe(940)
    expect(context['stats.hasOutdatedApp']).toBe(true)
  })

  it('leaves stats unjudgeable before the rollup has been computed', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({ rollup: {} }),
      settings,
      now: NOW,
      referenced: [],
    })

    // Unknown rather than zero: zero devices is a targetable fact, and claiming
    // it for an account nobody has measured would target the wrong people.
    expect(context['stats.deviceCount']).toBeUndefined()
    expect(context['stats.hasOutdatedApp']).toBeUndefined()
  })

  it('ignores zeroed counts that arrived without a computedAt', async () => {
    const t = build()
    const context = await t.loader.build({
      // What a hydrated document looked like when the schema defaulted these to
      // zero: indistinguishable from a measured account with nothing on it.
      user: account({
        rollup: { deviceCount: 0, apiKeyCount: 0, totalSentSms: 0 },
      }),
      settings,
      now: NOW,
      referenced: [],
    })

    expect(context['stats.deviceCount']).toBeUndefined()
    expect(context['stats.apiKeyCount']).toBeUndefined()
    expect(context['stats.totalSentSms']).toBeUndefined()
  })

  it('does not claim hasSentSms from an uncomputed rollup', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({ milestones: {}, rollup: { totalSentSms: 5 } }),
      settings,
      now: NOW,
      referenced: [],
    })
    expect(context['milestones.hasSentSms']).toBe(false)
  })

  it('treats a current app as not outdated', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({ rollup: { minAppVersionCode: 20, computedAt: NOW } }),
      settings,
      now: NOW,
      referenced: [],
    })
    expect(context['stats.hasOutdatedApp']).toBe(false)
  })

  it('trusts the rollup for hasSentSms even without a milestone', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account({
        milestones: {},
        rollup: { totalSentSms: 5, computedAt: NOW },
      }),
      settings,
      now: NOW,
      referenced: [],
    })
    // Milestones were added late and never backfilled, so this boolean must not
    // depend on one.
    expect(context['milestones.hasSentSms']).toBe(true)
  })
})

describe('usage is measured against the allowance that actually applies', () => {
  it('uses the plain limit on a free plan', async () => {
    const t = build({ plan: { name: 'free', monthlyPrice: 0, monthlyLimit: 100 } })
    t.smsModel.countDocuments.mockResolvedValue(50)

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['usage.monthlyPercent'],
    })

    expect(context['usage.monthlyPercent']).toBe(50)
  })

  it('allows a paid plan its overage, so 100% is not reported early', async () => {
    const t = build({
      subscription: {
        isActive: true,
        plan: { name: 'pro', monthlyPrice: 1499, monthlyLimit: 5000 },
      },
    })
    t.smsModel.countDocuments.mockResolvedValue(5000)

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['usage.monthlyPercent'],
    })

    // At the nominal limit a paid account can still send, so this must be under
    // 100 rather than exactly 100.
    expect(context['usage.monthlyPercent']).toBe(91)
  })

  it('honours a custom limit over the plan limit', async () => {
    const t = build({
      subscription: {
        isActive: true,
        customMonthlyLimit: 200,
        plan: { name: 'free', monthlyPrice: 0, monthlyLimit: 100 },
      },
    })
    t.smsModel.countDocuments.mockResolvedValue(100)

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['usage.monthlyPercent'],
    })

    expect(context['usage.monthlyPercent']).toBe(50)
  })

  it('leaves the percentage unjudgeable on an unlimited plan', async () => {
    const t = build({
      subscription: {
        isActive: true,
        plan: { name: 'custom-big', monthlyPrice: 9900, monthlyLimit: -1 },
      },
    })

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['usage.monthlyPercent'],
    })

    expect(context['usage.monthlyCount']).toBeDefined()
    expect(context['usage.monthlyPercent']).toBeUndefined()
  })
})

describe('subscription attributes', () => {
  it('treats an account with no subscription row as active on free', async () => {
    const t = build()
    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['subscription.planName'],
    })

    expect(context['subscription.planName']).toBe('free')
    expect(context['subscription.isPaid']).toBe(false)
    expect(context['subscription.status']).toBe('active')
  })

  it('reports a paid plan and its period', async () => {
    const t = build({
      subscription: {
        isActive: true,
        status: 'past_due',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date('2026-10-07T12:00:00.000Z'),
        plan: { name: 'pro', monthlyPrice: 1499, monthlyLimit: 5000 },
      },
    })

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['subscription.planName'],
    })

    expect(context['subscription.isPaid']).toBe(true)
    expect(context['subscription.status']).toBe('past_due')
    expect(context['subscription.cancelAtPeriodEnd']).toBe(true)
    expect(context['subscription.daysUntilPeriodEnd']).toBe(10)
  })
})

describe('sending attributes', () => {
  const failed = {
    status: 'failed',
    errorCode: 'PERMISSION_DENIED',
    failedAt: new Date('2026-09-27T09:30:00.000Z'),
    device: new Types.ObjectId(),
  }

  it('reads the latest outgoing message only when referenced', async () => {
    const t = build({ lastSent: failed, device: { enabled: true } })

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['sending.needsSmsPermission'],
    })

    expect(t.smsModel.findOne).toHaveBeenCalledWith({
      user: USER_ID,
      type: 'SENT',
    })
    expect(context['sending.needsSmsPermission']).toBe(true)
    expect(context['sending.hoursSinceLastPermissionFailure']).toBe(2)
  })

  it('clears once the phone reports the permission granted', async () => {
    const t = build({
      lastSent: failed,
      device: {
        appStateInfo: {
          hasSendSmsPermission: true,
          lastUpdated: new Date('2026-09-27T11:00:00.000Z'),
        },
      },
    })

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['sending.needsSmsPermission'],
    })

    expect(context['sending.needsSmsPermission']).toBe(false)
    expect(context['sending.hoursSinceLastPermissionFailure']).toBeUndefined()
  })

  it('does not read the device when the last send worked', async () => {
    const t = build({ lastSent: { status: 'delivered' } })

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['sending.needsSmsPermission'],
    })

    expect(t.deviceModel.findById).not.toHaveBeenCalled()
    expect(context['sending.needsSmsPermission']).toBe(false)
  })

  it('leaves an account that never sent unjudgeable', async () => {
    const t = build()

    const context = await t.loader.build({
      user: account(),
      settings,
      now: NOW,
      referenced: ['sending.needsSmsPermission'],
    })

    expect(context['sending.needsSmsPermission']).toBeUndefined()
  })
})
