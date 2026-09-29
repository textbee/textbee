import { Types } from 'mongoose'
import { VerificationReminderTask } from './verification-reminder.task'

describe('VerificationReminderTask', () => {
  const now = new Date('2026-09-27T12:00:00Z')
  const account = () => ({ _id: new Types.ObjectId(), email: 'a@example.com' })

  const setup = (pages: any[][], history: any[] = []) => {
    const find = jest.fn()
    for (const page of [...pages, []]) {
      const chain: any = {
        sort: jest.fn(() => chain),
        select: jest.fn(() => chain),
        limit: jest.fn(() => chain),
        lean: jest.fn().mockResolvedValue(page),
      }
      find.mockImplementationOnce(() => chain)
    }
    const userModel: any = { find }
    const sentEmailModel: any = { aggregate: jest.fn().mockResolvedValue(history) }
    const authService: any = {
      mintEmailVerificationLink: jest.fn().mockResolvedValue('https://app.test/verify?c=1'),
    }
    const mailService: any = { sendTemplated: jest.fn().mockResolvedValue('sent') }
    const task = new VerificationReminderTask(userModel, sentEmailModel, authService, mailService)
    return { task, userModel, sentEmailModel, authService, mailService }
  }

  it('looks for unverified password accounts created 24 to 48 hours ago', async () => {
    const { task, userModel } = setup([])

    await task.sendDue(now)

    const filter = userModel.find.mock.calls[0][0]
    expect(filter._id.$gte.getTimestamp()).toEqual(new Date('2026-09-25T12:00:00Z'))
    expect(filter._id.$lt.getTimestamp()).toEqual(new Date('2026-09-26T12:00:00Z'))
    expect(filter).toMatchObject({
      googleId: null,
      emailVerifiedAt: null,
      emailVerificationWaivedAt: null,
      isBanned: { $ne: true },
    })
  })

  it('mints a 24 hour reminder link and sends V2', async () => {
    const a = account()
    const { task, authService, mailService } = setup([[a]])

    await expect(task.sendDue(now)).resolves.toBe(1)

    expect(authService.mintEmailVerificationLink).toHaveBeenCalledWith(a, {
      lifetimeMs: 24 * 3600 * 1000,
      source: 'reminder',
    })
    expect(mailService.sendTemplated).toHaveBeenCalledWith({
      key: 'V2',
      userId: a._id,
      vars: { verificationUrl: 'https://app.test/verify?c=1', linkTtl: '24 hours' },
      redactVars: ['verificationUrl'],
    })
  })

  it('skips accounts already sent or skipped, and those with three failures', async () => {
    const [sent, skipped, failedThrice, failedTwice] = [account(), account(), account(), account()]
    const { task, mailService } = setup(
      [[sent, skipped, failedThrice, failedTwice]],
      [
        { _id: sent._id, done: 1, failed: 0 },
        { _id: skipped._id, done: 1, failed: 0 },
        { _id: failedThrice._id, done: 0, failed: 3 },
        { _id: failedTwice._id, done: 0, failed: 2 },
      ],
    )

    await task.sendDue(now)

    expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
    expect(mailService.sendTemplated.mock.calls[0][0].userId).toBe(failedTwice._id)
  })

  it('pages past a full batch of finished accounts', async () => {
    const full = Array.from({ length: 500 }, account)
    const fresh = account()
    const { task, userModel, mailService } = setup(
      [full, [fresh]],
      full.map((u) => ({ _id: u._id, done: 1, failed: 0 })),
    )

    await task.sendDue(now)

    expect(userModel.find.mock.calls[1][0]._id.$gt).toBe(full[499]._id)
    expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
    expect(mailService.sendTemplated.mock.calls[0][0].userId).toBe(fresh._id)
  })

  describe('run lock', () => {
    const withRedis = (setResult: string | null | Error) => {
      const ctx = setup([[account()]])
      const redis = {
        set:
          setResult instanceof Error
            ? jest.fn().mockRejectedValue(setResult)
            : jest.fn().mockResolvedValue(setResult),
        eval: jest.fn().mockResolvedValue(1),
      }
      jest.spyOn(ctx.task as any, 'redisClient').mockReturnValue(redis)
      jest.spyOn((ctx.task as any).logger, 'log').mockImplementation(() => undefined)
      jest.spyOn((ctx.task as any).logger, 'error').mockImplementation(() => undefined)
      return { ...ctx, redis }
    }

    it('takes the lock for 55 minutes, runs, and releases it', async () => {
      const { task, redis, mailService } = withRedis('OK')

      await task.run()

      const [key, token, px, ttl, nx] = redis.set.mock.calls[0]
      expect([key, px, ttl, nx]).toEqual(['lock:verification-reminder', 'PX', 55 * 60 * 1000, 'NX'])
      expect(mailService.sendTemplated).toHaveBeenCalledTimes(1)
      expect(redis.eval).toHaveBeenCalledWith(expect.any(String), 1, key, token)
    })

    it('skips the run when another process holds the lock', async () => {
      const { task, redis, mailService } = withRedis(null)

      await task.run()

      expect(mailService.sendTemplated).not.toHaveBeenCalled()
      expect(redis.eval).not.toHaveBeenCalled()
    })

    it('skips the run when Redis is unreachable', async () => {
      const { task, mailService } = withRedis(new Error('down'))

      await task.run()

      expect(mailService.sendTemplated).not.toHaveBeenCalled()
    })

    it('releases the lock when the run fails', async () => {
      const { task, redis, authService } = withRedis('OK')
      authService.mintEmailVerificationLink.mockRejectedValue(new Error('db down'))

      await task.run()

      expect(redis.eval).toHaveBeenCalledTimes(1)
    })
  })
})
