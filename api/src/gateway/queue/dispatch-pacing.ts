import { DEFAULT_SMS_SEND_DELAY_SECONDS } from '../schemas/device.schema'

export const DEFAULT_BULK_DISPATCH_WINDOW = 50
export const DEFAULT_BULK_DISPATCH_MAX_SPREAD_HOURS = 72

export interface DispatchWave {
  // [start, end) index range into the message list
  start: number
  end: number
  delayMs: number
}

export interface DispatchPlan {
  waves: DispatchWave[]
  sendDelaySeconds: number
  // Time from now until the device is expected to finish the last wave
  projectedCompletionMs: number
}

export function resolveSendDelaySeconds(sendDelaySeconds?: number): number {
  const value = Number(sendDelaySeconds)
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SMS_SEND_DELAY_SECONDS
}

// Read on every call so the switch works without a code change
export function isDispatchPacingEnabled(): boolean {
  const raw = process.env.DEVICE_DISPATCH_PACING_ENABLED?.trim().toLowerCase()
  if (raw === undefined || raw === '') return true
  return raw === 'true' || raw === '1'
}

function remainingMs(until: Date | null | undefined, now: Date): number {
  const time = until ? new Date(until).getTime() : NaN
  return Number.isFinite(time) ? Math.max(0, time - now.getTime()) : 0
}

// How long to hold a new request so the device holds at most about one wave
// beyond what it already has. A single recipient skips the line while the
// priority backlog fits in one wave.
export function resolvePacingDelay(input: {
  count: number
  now: Date
  waveSpanMs: number
  previousBusyUntil?: Date | null
  previousPriorityBusyUntil?: Date | null
}): { backlogMs: number; pacingDelayMs: number } {
  const backlogMs = remainingMs(input.previousBusyUntil, input.now)
  const priorityBacklogMs = remainingMs(input.previousPriorityBusyUntil, input.now)
  if (input.count === 1 && priorityBacklogMs <= input.waveSpanMs) {
    return { backlogMs, pacingDelayMs: 0 }
  }
  return { backlogMs, pacingDelayMs: Math.max(0, backlogMs - input.waveSpanMs) }
}

// Pipeline that adds a request to the device's projected busy time
export function reserveDispatchUpdate(
  now: Date,
  count: number,
  delayMs: number,
  waveSpanMs: number,
) {
  return [
    {
      $set: {
        dispatchBusyUntil: {
          $add: [{ $max: ['$dispatchBusyUntil', now] }, count * delayMs],
        },
        ...(count === 1 && {
          dispatchPriorityBusyUntil: {
            $min: [
              { $add: [{ $max: ['$dispatchPriorityBusyUntil', now] }, delayMs] },
              { $add: [now, waveSpanMs + delayMs] },
            ],
          },
        }),
      },
    },
  ]
}

// Pipeline that gives back busy time for messages that never reached the device
export function releaseDispatchUpdate(now: Date, releaseMs: number) {
  return [
    {
      $set: {
        dispatchBusyUntil: {
          $max: [now, { $subtract: ['$dispatchBusyUntil', releaseMs] }],
        },
      },
    },
  ]
}

// Releases messages in waves spaced by the time the device needs to send the
// previous wave, so in-flight pushes never pile up beyond one wave.
export function planDispatchWaves(
  messageCount: number,
  opts: {
    waveSize: number
    sendDelaySeconds?: number
    baseDelayMs?: number
  },
): DispatchPlan {
  const waveSize = Math.max(1, Math.floor(Number(opts.waveSize) || 1))
  const sendDelaySeconds = resolveSendDelaySeconds(opts.sendDelaySeconds)
  const baseDelayMs = Math.max(0, Number(opts.baseDelayMs) || 0)
  const waveSpacingMs = waveSize * sendDelaySeconds * 1000

  const waves: DispatchWave[] = []
  for (let start = 0, i = 0; start < messageCount; start += waveSize, i++) {
    waves.push({
      start,
      end: Math.min(start + waveSize, messageCount),
      delayMs: baseDelayMs + i * waveSpacingMs,
    })
  }

  const last = waves[waves.length - 1]
  const projectedCompletionMs = last
    ? last.delayMs + (last.end - last.start) * sendDelaySeconds * 1000
    : baseDelayMs

  return { waves, sendDelaySeconds, projectedCompletionMs }
}
