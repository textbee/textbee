import { NotificationMetricsService } from '../notification-metrics.service'
import { NotificationHealthTask } from './notification-health.task'

describe('NotificationHealthTask', () => {
  const build = () => {
    const userModel: any = {
      countDocuments: jest
        .fn()
        .mockResolvedValueOnce(40_000)
        .mockResolvedValueOnce(31_000)
        .mockResolvedValueOnce(9_500),
    }
    const stateModel: any = {
      estimatedDocumentCount: jest.fn().mockResolvedValue(120_000),
    }
    const statsModel: any = {
      updateOne: jest.fn().mockResolvedValue(undefined),
    }
    const metrics = new NotificationMetricsService(statsModel)
    const task = new NotificationHealthTask(userModel, stateModel, metrics)
    return { task, userModel, stateModel, statsModel }
  }

  it('records four counts against today in one write', async () => {
    const t = build()

    await t.task.recordCoverage()

    expect(t.userModel.countDocuments).toHaveBeenCalledTimes(3)
    expect(t.stateModel.estimatedDocumentCount).toHaveBeenCalledTimes(1)
    expect(t.statsModel.updateOne).toHaveBeenCalledTimes(1)

    const [filter, update, options] = t.statsModel.updateOne.mock.calls[0]
    expect(filter).toEqual({ day: new Date().toISOString().slice(0, 10) })
    expect(options).toEqual({ upsert: true })
    expect(update.$set.coverage).toMatchObject({
      accounts: 40_000,
      rollupComputed: 31_000,
      milestoneFirstSms: 9_500,
      stateRows: 120_000,
    })
    expect(update.$set.coverage.at).toBeInstanceOf(Date)
  })

  it('does not take the process down when a count fails', async () => {
    const t = build()
    t.userModel.countDocuments = jest
      .fn()
      .mockRejectedValue(new Error('atlas is away'))

    await expect(t.task.recordCoverage()).resolves.toBeUndefined()
    expect(t.statsModel.updateOne).not.toHaveBeenCalled()
  })
})
