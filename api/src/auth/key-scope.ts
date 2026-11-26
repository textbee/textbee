import { HttpException, HttpStatus } from '@nestjs/common'
import { DEVICE_LINK_KEY_SOURCE } from './schemas/api-key.schema'

export const KEY_SCOPE_ERROR = {
  error: 'This key works only for its own phone.',
  code: 'KEY_SCOPE',
} as const

// Routes a phone sign-in key may call, besides the routes of its own device
const ACCOUNT_ROUTES = new Set([
  'GET /auth/who-am-i',
  'GET /gateway/stats',
  'GET /billing/current-subscription',
])

const VERSION_PREFIX = /^\/api\/v\d+(?=\/)/i
const DEVICE_ROUTE = '/gateway/devices/:id'

type ScopedKey = { source?: string; linkedDevice?: unknown }

type RoutedRequest = {
  method?: string
  route?: { path?: unknown }
  params?: Record<string, unknown>
}

/**
 * Whether a sign-in key may call the route the request matched. Reads the
 * route pattern the router chose, not the raw path, so a path spelled
 * another way cannot pass as an allowed one.
 */
export function signInKeyAllows(request: RoutedRequest, linkedDevice: unknown): boolean {
  const pattern = request?.route?.path
  const method = String(request?.method ?? '').toUpperCase()
  if (typeof pattern !== 'string' || !method) return false
  const path = pattern.replace(VERSION_PREFIX, '')

  if (ACCOUNT_ROUTES.has(`${method} ${path}`)) return true

  const ownDevice =
    linkedDevice != null &&
    typeof request.params?.id === 'string' &&
    request.params.id.toLowerCase() === String(linkedDevice).toLowerCase()
  if (!ownDevice) return false
  if (path === DEVICE_ROUTE) return method === 'GET' || method === 'PATCH'
  return path.startsWith(`${DEVICE_ROUTE}/`)
}

/** Throws 403 KEY_SCOPE when a sign-in key calls a route outside its list. */
export function assertKeyScope(request: RoutedRequest, apiKey: ScopedKey): void {
  if (apiKey?.source !== DEVICE_LINK_KEY_SOURCE) return
  if (!signInKeyAllows(request, apiKey.linkedDevice)) {
    throw new HttpException(KEY_SCOPE_ERROR, HttpStatus.FORBIDDEN)
  }
}
