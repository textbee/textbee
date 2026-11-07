import {
  ACTIVE_JOB_MAX_MS,
  findQueueProblems,
  WAITING_JOB_MAX_MS,
} from './queue-health'

const NOW = 1_700_000_000_000
const minutes = (n: number) => n * 60 * 1000

describe('findQueueProblems', () => {
  it('reports nothing for idle queues', () => {
    expect(
      findQueueProblems(
        [{ name: 'sms', activeStartedAt: [], oldestWaitingReadyAt: null }],
        NOW,
      ),
    ).toEqual([])
  })

  it('accepts jobs that are active or waiting within the limits', () => {
    expect(
      findQueueProblems(
        [
          {
            name: 'sms',
            activeStartedAt: [NOW - ACTIVE_JOB_MAX_MS + 1000, NOW - minutes(1)],
            oldestWaitingReadyAt: NOW - WAITING_JOB_MAX_MS + 1000,
          },
        ],
        NOW,
      ),
    ).toEqual([])
  })

  it('flags a job stuck in active', () => {
    const problems = findQueueProblems(
      [
        {
          name: 'sms',
          activeStartedAt: [NOW - minutes(45), NOW - minutes(1)],
          oldestWaitingReadyAt: null,
        },
      ],
      NOW,
    )
    expect(problems).toEqual(['sms: 1 job(s) active for over 10 min'])
  })

  it('flags a backlog whose oldest ready job has waited too long', () => {
    const problems = findQueueProblems(
      [
        {
          name: 'webhook-delivery',
          activeStartedAt: [],
          oldestWaitingReadyAt: NOW - minutes(25),
        },
      ],
      NOW,
    )
    expect(problems).toEqual([
      'webhook-delivery: oldest waiting job has waited 25 min',
    ])
  })

  it('reports every queue with a problem', () => {
    const problems = findQueueProblems(
      [
        { name: 'sms', activeStartedAt: [NOW - minutes(30)], oldestWaitingReadyAt: null },
        { name: 'webhook-delivery', activeStartedAt: [], oldestWaitingReadyAt: null },
        {
          name: 'billing-notifications',
          activeStartedAt: [],
          oldestWaitingReadyAt: NOW - minutes(60),
        },
      ],
      NOW,
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(/^sms:/)
    expect(problems[1]).toMatch(/^billing-notifications:/)
  })
})
