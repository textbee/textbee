import {
  isDispatchPacingEnabled,
  planDispatchWaves,
  releaseDispatchUpdate,
  reserveDispatchUpdate,
  resolvePacingDelay,
  resolveSendDelaySeconds,
} from './dispatch-pacing'

describe('planDispatchWaves', () => {
  it('returns a single wave at the base delay when the batch fits the window', () => {
    const plan = planDispatchWaves(50, { waveSize: 50, sendDelaySeconds: 5 })

    expect(plan.waves).toEqual([{ start: 0, end: 50, delayMs: 0 }])
    expect(plan.projectedCompletionMs).toBe(50 * 5000)
  })

  it('splits 2000 messages at 5s into 40 waves spaced 250s apart', () => {
    const plan = planDispatchWaves(2000, { waveSize: 50, sendDelaySeconds: 5 })

    expect(plan.waves).toHaveLength(40)
    expect(plan.waves[0]).toEqual({ start: 0, end: 50, delayMs: 0 })
    expect(plan.waves[1].delayMs).toBe(250_000)
    expect(plan.waves[39]).toEqual({
      start: 1950,
      end: 2000,
      delayMs: 39 * 250_000,
    })
    expect(plan.projectedCompletionMs).toBe(40 * 250_000)
  })

  it('covers every message exactly once, including a short final wave', () => {
    const plan = planDispatchWaves(51, { waveSize: 50, sendDelaySeconds: 5 })

    expect(plan.waves).toEqual([
      { start: 0, end: 50, delayMs: 0 },
      { start: 50, end: 51, delayMs: 250_000 },
    ])
    expect(plan.projectedCompletionMs).toBe(250_000 + 5000)

    const seen = new Set<number>()
    for (const wave of plan.waves) {
      for (let i = wave.start; i < wave.end; i++) {
        expect(seen.has(i)).toBe(false)
        seen.add(i)
      }
    }
    expect(seen.size).toBe(51)
  })

  it('adds a scheduled base delay to every wave instead of replacing it', () => {
    const plan = planDispatchWaves(120, {
      waveSize: 50,
      sendDelaySeconds: 5,
      baseDelayMs: 60_000,
    })

    expect(plan.waves.map((w) => w.delayMs)).toEqual([
      60_000,
      310_000,
      560_000,
    ])
  })

  it.each([undefined, 0, -3, NaN])(
    'falls back to the default 5s send delay for %p',
    (sendDelaySeconds) => {
      const plan = planDispatchWaves(100, { waveSize: 50, sendDelaySeconds })

      expect(plan.sendDelaySeconds).toBe(5)
      expect(plan.waves[1].delayMs).toBe(250_000)
    },
  )

  it('uses the device delay when it is set', () => {
    const plan = planDispatchWaves(100, { waveSize: 50, sendDelaySeconds: 10 })

    expect(plan.waves[1].delayMs).toBe(500_000)
  })

  it('treats a wave size below 1 as 1', () => {
    const plan = planDispatchWaves(3, { waveSize: 0, sendDelaySeconds: 5 })

    expect(plan.waves.map((w) => [w.start, w.end, w.delayMs])).toEqual([
      [0, 1, 0],
      [1, 2, 5000],
      [2, 3, 10_000],
    ])
  })

  it('returns no waves for an empty batch', () => {
    const plan = planDispatchWaves(0, { waveSize: 50, sendDelaySeconds: 5 })

    expect(plan.waves).toEqual([])
    expect(plan.projectedCompletionMs).toBe(0)
  })
})

describe('resolveSendDelaySeconds', () => {
  it('keeps positive values and defaults everything else', () => {
    expect(resolveSendDelaySeconds(7)).toBe(7)
    expect(resolveSendDelaySeconds(0)).toBe(5)
    expect(resolveSendDelaySeconds(undefined)).toBe(5)
    expect(resolveSendDelaySeconds(-1)).toBe(5)
  })
})

describe('resolvePacingDelay', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const waveSpanMs = 250_000
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs)

  it.each([
    [0, 0],
    [250_000, 0],
    [500_000, 250_000],
    [9_250_000, 9_000_000],
  ])('holds a request behind a %d ms backlog for %d ms', (backlogMs, delayMs) => {
    expect(
      resolvePacingDelay({ count: 50, now, waveSpanMs, previousBusyUntil: at(backlogMs) }),
    ).toEqual({ backlogMs, pacingDelayMs: delayMs })
  })

  it('treats missing or past values as no backlog', () => {
    expect(resolvePacingDelay({ count: 50, now, waveSpanMs })).toEqual({
      backlogMs: 0,
      pacingDelayMs: 0,
    })
    expect(
      resolvePacingDelay({ count: 50, now, waveSpanMs, previousBusyUntil: null }),
    ).toEqual({ backlogMs: 0, pacingDelayMs: 0 })
    expect(
      resolvePacingDelay({ count: 50, now, waveSpanMs, previousBusyUntil: at(-60_000) }),
    ).toEqual({ backlogMs: 0, pacingDelayMs: 0 })
  })

  it('lets a single recipient skip the line while the priority backlog fits one wave', () => {
    expect(
      resolvePacingDelay({
        count: 1,
        now,
        waveSpanMs,
        previousBusyUntil: at(5_000_000),
        previousPriorityBusyUntil: at(250_000),
      }).pacingDelayMs,
    ).toBe(0)
  })

  it('paces a single recipient once the priority budget is used', () => {
    expect(
      resolvePacingDelay({
        count: 1,
        now,
        waveSpanMs,
        previousBusyUntil: at(5_000_000),
        previousPriorityBusyUntil: at(255_000),
      }).pacingDelayMs,
    ).toBe(4_750_000)
  })

  it('never lets a larger request skip the line', () => {
    expect(
      resolvePacingDelay({ count: 2, now, waveSpanMs, previousBusyUntil: at(5_000_000) })
        .pacingDelayMs,
    ).toBe(4_750_000)
  })

  // Applies the reserve pipeline the way the database does, one request at a time
  function simulate(requests: number[], initialBusyMs = 0) {
    const delayMs = 5_000
    let busyUntil: Date | undefined = initialBusyMs ? at(initialBusyMs) : undefined
    let priorityBusyUntil: Date | undefined
    const max = (d: Date | undefined) => Math.max(d?.getTime() ?? 0, now.getTime())
    return requests.map((count) => {
      const result = resolvePacingDelay({
        count,
        now,
        waveSpanMs,
        previousBusyUntil: busyUntil,
        previousPriorityBusyUntil: priorityBusyUntil,
      })
      busyUntil = new Date(max(busyUntil) + count * delayMs)
      if (count === 1) {
        priorityBusyUntil = new Date(
          Math.min(max(priorityBusyUntil) + delayMs, now.getTime() + waveSpanMs + delayMs),
        )
      }
      return result.pacingDelayMs
    })
  }

  it('keeps the device at about two waves when many requests of 50 arrive at once', () => {
    const delays = simulate(Array.from({ length: 38 }, () => 50))

    expect(delays.slice(0, 3)).toEqual([0, 0, 250_000])
    expect(delays[37]).toBe(9_000_000)
  })

  it('lets only about one wave of single recipients skip a large backlog', () => {
    const delays = simulate(Array.from({ length: 200 }, () => 1), 5_000_000)
    const skipped = delays.filter((delay) => delay === 0).length

    expect(skipped).toBeGreaterThanOrEqual(50)
    expect(skipped).toBeLessThanOrEqual(51)
    expect(delays[199]).toBeGreaterThan(4_750_000)
  })
})

describe('dispatch backlog updates', () => {
  const now = new Date('2026-11-10T12:00:00Z')

  it('adds the request to the busy time, starting from now when there is none', () => {
    const [stage] = reserveDispatchUpdate(now, 50, 5_000, 250_000)

    expect(stage.$set.dispatchBusyUntil).toEqual({
      $add: [{ $max: ['$dispatchBusyUntil', now] }, 250_000],
    })
    expect(stage.$set).not.toHaveProperty('dispatchPriorityBusyUntil')
  })

  it('caps the priority busy time at one wave for a single recipient', () => {
    const [stage] = reserveDispatchUpdate(now, 1, 5_000, 250_000)

    expect(stage.$set.dispatchPriorityBusyUntil).toEqual({
      $min: [
        { $add: [{ $max: ['$dispatchPriorityBusyUntil', now] }, 5_000] },
        { $add: [now, 255_000] },
      ],
    })
  })

  it('gives back busy time without going below now', () => {
    expect(releaseDispatchUpdate(now, 10_000)).toEqual([
      {
        $set: {
          dispatchBusyUntil: {
            $max: [now, { $subtract: ['$dispatchBusyUntil', 10_000] }],
          },
        },
      },
    ])
  })
})

describe('isDispatchPacingEnabled', () => {
  const env = { ...process.env }

  afterEach(() => {
    process.env = { ...env }
  })

  it('is on unless the environment turns it off', () => {
    delete process.env.DEVICE_DISPATCH_PACING_ENABLED
    expect(isDispatchPacingEnabled()).toBe(true)

    process.env.DEVICE_DISPATCH_PACING_ENABLED = 'false'
    expect(isDispatchPacingEnabled()).toBe(false)

    process.env.DEVICE_DISPATCH_PACING_ENABLED = '1'
    expect(isDispatchPacingEnabled()).toBe(true)
  })
})
