/** A job counts as stuck once it has been active this long. */
export const ACTIVE_JOB_MAX_MS = 10 * 60 * 1000
/** The queue counts as backed up once a ready job has waited this long. */
export const WAITING_JOB_MAX_MS = 10 * 60 * 1000

export interface QueueSnapshot {
  name: string
  /** processedOn of each active job, in ms */
  activeStartedAt: number[]
  /** When the oldest waiting job became ready, in ms, or null when none wait */
  oldestWaitingReadyAt: number | null
}

/** Returns one line per problem; an empty list means every queue is healthy. */
export function findQueueProblems(
  snapshots: QueueSnapshot[],
  now: number,
): string[] {
  const problems: string[] = []

  for (const queue of snapshots) {
    const stuck = queue.activeStartedAt.filter(
      (startedAt) => now - startedAt > ACTIVE_JOB_MAX_MS,
    )
    if (stuck.length > 0) {
      problems.push(
        `${queue.name}: ${stuck.length} job(s) active for over ${ACTIVE_JOB_MAX_MS / 60000} min`,
      )
    }

    if (
      queue.oldestWaitingReadyAt !== null &&
      now - queue.oldestWaitingReadyAt > WAITING_JOB_MAX_MS
    ) {
      const minutes = Math.round((now - queue.oldestWaitingReadyAt) / 60000)
      problems.push(`${queue.name}: oldest waiting job has waited ${minutes} min`)
    }
  }

  return problems
}
