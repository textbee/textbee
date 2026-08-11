import { ConfigService } from '@nestjs/config'

// ConfigService.get<T>() does NOT coerce — the generic is only a type assertion.
// Env vars always arrive as strings, so read booleans/numbers through these helpers.

export function getBool(
  config: ConfigService,
  key: string,
  fallback: boolean,
): boolean {
  const raw = config.get<string | boolean>(key)
  if (raw === undefined || raw === null || raw === '') return fallback
  if (typeof raw === 'boolean') return raw
  return String(raw).trim().toLowerCase() === 'true'
}

export function getNumber(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(key)
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
