import { Logger } from '@nestjs/common'

const logger = new Logger('JobMonitor')
const PING_TIMEOUT_MS = 10_000

/** Check names a monitoring service expects, one per scheduled job. */
export const MonitoredJob = {
  heartbeatCheck: 'api-heartbeat-check',
  verificationReminder: 'api-verification-reminder',
  smsStatusSweep: 'api-sms-status-sweep',
  webhookRetrySweep: 'api-webhook-retry-sweep',
  userRollup: 'api-user-rollup',
  webhookAutoDisable: 'api-webhook-auto-disable',
  queueWatchdog: 'api-queue-watchdog',
} as const

export type MonitoredJobSlug = (typeof MonitoredJob)[keyof typeof MonitoredJob]

/**
 * Base URL for success pings, for example a healthchecks.io
 * `https://hc-ping.com/<project-ping-key>`. Unset turns pings off.
 */
export function monitoringPingBase(): string | null {
  const raw = process.env.MONITORING_PING_URL?.trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

/**
 * Reports one successful run of a scheduled job as GET `<base>/<slug>`.
 * A missed ping is what raises the alert, so this never throws and never
 * delays the job.
 */
export function pingJob(slug: MonitoredJobSlug): void {
  const base = monitoringPingBase()
  if (!base) return

  fetch(`${base}/${slug}`, { signal: AbortSignal.timeout(PING_TIMEOUT_MS) })
    .then((res) => {
      if (!res.ok) logger.warn(`Monitoring ping ${slug} returned ${res.status}`)
    })
    .catch((error) => {
      logger.warn(`Monitoring ping ${slug} failed: ${error?.message ?? error}`)
    })
}
