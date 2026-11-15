// App version history of a device: each app version it ran and how that version was installed.

import { deviceFacts } from './device-config'
import { InstallSource, installSourceFor } from './install-source'

export const MAX_APP_VERSION_HISTORY = 100
export const APP_VERSION_FLAP_WINDOW_MS = 24 * 60 * 60 * 1000
// A device created this recently is registering with this request
export const NEW_DEVICE_WINDOW_MS = 10 * 60 * 1000

// Installer part of the key when the app build does not report an installer
const NO_INSTALLER_FIELD = '~'
const MAX_PACKAGE_LENGTH = 255
// Segments of letters, digits and underscores joined by single dots; empty means no installer
const PACKAGE_NAME_PATTERN = /^(?:[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)?$/
const MAX_VERSION_NAME_LENGTH = 255
const MIN_UPDATE_TIME_MS = Date.UTC(2008, 0, 1)
const MAX_UPDATE_TIME_DRIFT_MS = 24 * 60 * 60 * 1000

// The newest entries a device load needs for the rules below
export const APP_VERSION_HISTORY_PROJECTION = {
  '+appVersionKey': 1,
  appVersionHistory: { $slice: -2 },
} as const

export type AppVersionHistoryEntry = {
  versionCode: number
  versionName?: string
  installSource: InstallSource
  installerPackage?: string
  installedAt?: Date
  firstSeenAt: Date
  lastSeenAt?: Date
  seeded: boolean
}

export type AppInstallReport = {
  installerPackage?: string
  initiatingPackage?: string
  appLastUpdateTime?: Date
}

export type AppVersionReport = AppInstallReport & {
  versionCode?: unknown
  versionName?: unknown
  // A heartbeat that reports no version may start the history from the stored version
  useStoredVersion?: boolean
}

export type AppVersionHistoryDevice = {
  _id?: unknown
  createdAt?: Date
  appVersionKey?: string
  // Newest last; the newest two entries are enough
  appVersionHistory?: Array<Partial<AppVersionHistoryEntry>>
  appVersionCode?: number
  appVersionName?: string
  appVersionInfo?: { versionCode?: number; versionName?: string } | null
}

export type AppVersionFields = {
  appVersionKey: string
  installSource: InstallSource
  installerPackage?: string
  initiatingPackage?: string
}

export type AppVersionHistoryWrite = {
  filter: Record<string, unknown>
  update: Record<string, unknown>[]
}

// flap carries no write: the caller counts it in the write the request already does
export type AppVersionHistoryChange =
  | { kind: 'none'; seen: boolean }
  | { kind: 'flap'; seen: false }
  | ({ kind: 'append'; seen: true; entry: AppVersionHistoryEntry; fields: AppVersionFields } & AppVersionHistoryWrite)
  | ({ kind: 'complete'; seen: true; fields: AppVersionFields } & AppVersionHistoryWrite)

/** Bad values are dropped, never rejected. */
export function cleanAppInstallReport(input: unknown, now: Date = new Date()): AppInstallReport {
  if (typeof input !== 'object' || input === null) return {}
  const source = input as Record<string, unknown>
  const report: AppInstallReport = {}

  const installer = cleanPackageName(source.installerPackage)
  if (installer !== undefined) report.installerPackage = installer

  const initiating = cleanPackageName(source.initiatingPackage)
  if (initiating) report.initiatingPackage = initiating

  const updatedAt = cleanUpdateTime(source.appLastUpdateTime, now)
  if (updatedAt) report.appLastUpdateTime = updatedAt

  return report
}

function cleanPackageName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length > MAX_PACKAGE_LENGTH) return undefined
  return PACKAGE_NAME_PATTERN.test(trimmed) ? trimmed : undefined
}

function cleanUpdateTime(value: unknown, now: Date): Date | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  if (value < MIN_UPDATE_TIME_MS) return undefined
  if (value > now.getTime() + MAX_UPDATE_TIME_DRIFT_MS) return undefined
  return new Date(value)
}

function cleanVersionCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function cleanVersionName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, MAX_VERSION_NAME_LENGTH)
  return trimmed === '' ? undefined : trimmed
}

// A key without a readable installer part counts as one with no installer field
function installerOfKey(key: string): string {
  const separator = key.lastIndexOf('|')
  if (separator === -1) return NO_INSTALLER_FIELD
  const installer = key.slice(separator + 1)
  return installer === NO_INSTALLER_FIELD || cleanPackageName(installer) === installer
    ? installer
    : NO_INSTALLER_FIELD
}

function entryKey(entry: Partial<AppVersionHistoryEntry>): string {
  const installer =
    entry.installSource === 'unknown' ? NO_INSTALLER_FIELD : entry.installerPackage ?? ''
  return `${entry.versionCode}|${entry.versionName ?? ''}|${installer}`
}

/** Decides what one request does to the device's app version history; seen means the main write sets appVersionLastSeenAt. */
export function appVersionHistoryChange(
  device: AppVersionHistoryDevice,
  report: AppVersionReport,
  now: Date = new Date(),
): AppVersionHistoryChange {
  const storedKey =
    typeof device.appVersionKey === 'string' && device.appVersionKey !== ''
      ? device.appVersionKey
      : undefined
  const facts = deviceFacts(device)
  const storedName = cleanVersionName(facts.versionName)

  let versionCode = cleanVersionCode(report.versionCode)
  let versionName = cleanVersionName(report.versionName)
  if (versionCode !== undefined && versionName === undefined && facts.versionCode === versionCode) {
    versionName = storedName
  }

  let seeded: boolean
  if (versionCode !== undefined) {
    seeded = storedKey === undefined && !isNewDevice(device.createdAt, now)
  } else {
    if (!report.useStoredVersion) return { kind: 'none', seen: false }
    // Only the first entry can come from the stored version
    if (storedKey !== undefined) return { kind: 'none', seen: true }
    if (facts.versionCode <= 0) return { kind: 'none', seen: false }
    versionCode = facts.versionCode
    versionName = storedName
    seeded = true
  }

  // No installer field keeps the installer of the current key
  const installerReported = report.installerPackage !== undefined
  const storedInstaller =
    storedKey !== undefined ? installerOfKey(storedKey) : NO_INSTALLER_FIELD
  const installer = installerReported ? report.installerPackage : storedInstaller
  const key = `${versionCode}|${versionName ?? ''}|${installer}`

  if (key === storedKey) return { kind: 'none', seen: true }

  const filter = {
    _id: device._id,
    appVersionKey: storedKey !== undefined ? storedKey : { $exists: false },
  }
  const installSource =
    installer === NO_INSTALLER_FIELD ? 'unknown' : installSourceFor(installer)
  const fields: AppVersionFields = {
    appVersionKey: key,
    installSource,
    ...(installer !== NO_INSTALLER_FIELD && { installerPackage: installer }),
    ...(installerReported &&
      report.initiatingPackage !== undefined && {
        initiatingPackage: report.initiatingPackage,
      }),
  }

  const history = device.appVersionHistory ?? []
  const last = history[history.length - 1]
  const previous = history[history.length - 2]

  // The installer of the newest version arrives after the version itself
  if (
    installerReported &&
    storedKey !== undefined &&
    storedInstaller === NO_INSTALLER_FIELD &&
    last?.installSource === 'unknown' &&
    last.versionCode === versionCode &&
    (last.versionName ?? '') === (versionName ?? '')
  ) {
    const patch: Record<string, unknown> = {
      installSource: { $literal: installSource },
      installerPackage: { $literal: installer },
    }
    if (report.appLastUpdateTime && !last.installedAt) {
      patch.installedAt = { $literal: report.appLastUpdateTime }
    }
    return {
      kind: 'complete',
      seen: true,
      fields,
      filter,
      update: [{ $set: { appVersionHistory: patchNewest(patch), ...deviceSet(fields, installerReported, now) } }],
    }
  }

  if (
    storedKey !== undefined &&
    previous &&
    entryKey(previous) === key &&
    isWithin(last?.firstSeenAt, now, APP_VERSION_FLAP_WINDOW_MS)
  ) {
    return { kind: 'flap', seen: false }
  }

  const entry: AppVersionHistoryEntry = {
    versionCode,
    ...(versionName !== undefined && { versionName }),
    installSource,
    ...(installer !== NO_INSTALLER_FIELD && { installerPackage: installer }),
    ...(report.appLastUpdateTime && { installedAt: report.appLastUpdateTime }),
    firstSeenAt: now,
    seeded,
  }
  // The entry being closed was last seen when the device last reported its version
  const lastSeenAt = {
    $ifNull: ['$appVersionLastSeenAt', { $ifNull: ['$lastHeartbeat', '$$REMOVE'] }],
  }

  return {
    kind: 'append',
    seen: true,
    entry,
    fields,
    filter,
    update: [
      {
        $set: {
          appVersionHistory: {
            $slice: [
              { $concatArrays: [patchNewest({ lastSeenAt }), [{ $literal: entry }]] },
              -MAX_APP_VERSION_HISTORY,
            ],
          },
          ...deviceSet(fields, installerReported, now),
        },
      },
    ],
  }
}

// The stored history with the patch merged into its newest entry
function patchNewest(patch: Record<string, unknown>) {
  const history = { $ifNull: ['$appVersionHistory', []] }
  return {
    $map: {
      input: { $range: [0, { $size: history }] },
      as: 'i',
      in: {
        $cond: [
          { $eq: ['$$i', { $subtract: [{ $size: history }, 1] }] },
          { $mergeObjects: [{ $arrayElemAt: [history, '$$i'] }, patch] },
          { $arrayElemAt: [history, '$$i'] },
        ],
      },
    },
  }
}

function deviceSet(
  fields: AppVersionFields,
  installerReported: boolean,
  now: Date,
): Record<string, unknown> {
  const set: Record<string, unknown> = {
    appVersionKey: { $literal: fields.appVersionKey },
    installSource: { $literal: fields.installSource },
    appVersionLastSeenAt: now,
  }
  if (fields.installerPackage !== undefined) {
    set.installerPackage = { $literal: fields.installerPackage }
  }
  // A reported install replaces the initiating package of the previous one
  if (installerReported) {
    set.initiatingPackage =
      fields.initiatingPackage !== undefined
        ? { $literal: fields.initiatingPackage }
        : '$$REMOVE'
  }
  return set
}

function isNewDevice(createdAt: Date | undefined, now: Date): boolean {
  return isWithin(createdAt, now, NEW_DEVICE_WINDOW_MS)
}

function isWithin(time: Date | undefined, now: Date, windowMs: number): boolean {
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) return false
  return now.getTime() - time.getTime() < windowMs
}
