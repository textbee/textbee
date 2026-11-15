import { Types } from 'mongoose'
import { classifyClient } from '../auth/access-footprint'

export const BATCH_SOURCES = [
  'dashboard',
  'api',
  'sdk-js',
  'sdk-python',
  'mcp',
  'mcp-hosted',
  'n8n',
] as const
export type BatchSource = (typeof BATCH_SOURCES)[number]

export type BatchRequestDetails = {
  source: BatchSource
  client?: string
  clientVersion?: string
  apiKey?: Types.ObjectId
}

const NAMED_CLIENTS: Record<string, BatchSource> = {
  'textbee-mcp-remote': 'mcp-hosted',
  'textbee-mcp': 'mcp',
  'textbee-n8n': 'n8n',
  'textbee-js': 'sdk-js',
  'textbee-python': 'sdk-python',
}

const CLIENT_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9a-z.]{1,20})?$/
const MAX_TOKENS = 8

function headerValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' ? first : undefined
}

function namedClient(sdkClient?: string) {
  const tokens = (sdkClient ?? '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .slice(0, MAX_TOKENS)
  for (const token of tokens) {
    const [name, ...rest] = token.split('/')
    if (!Object.hasOwn(NAMED_CLIENTS, name)) continue
    const version =
      rest.length === 1 && CLIENT_VERSION.test(rest[0]) ? rest[0] : undefined
    return { name, version, source: NAMED_CLIENTS[name] }
  }
  return undefined
}

function apiKeyId(value: unknown): Types.ObjectId | undefined {
  const id = String((value as { _id?: unknown })?._id ?? '')
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : undefined
}

export function batchRequestDetails(request: any): BatchRequestDetails {
  const headers = request?.headers ?? {}
  if (headerValue(headers.authorization)?.startsWith('Bearer ')) {
    return { source: 'dashboard' }
  }

  const sdkClient = headerValue(headers['x-sdk-client'])
  const apiKey = apiKeyId(request?.apiKey)
  const named = namedClient(sdkClient)
  if (named) {
    return {
      source: named.source,
      client: named.name,
      ...(named.version && { clientVersion: named.version }),
      ...(apiKey && { apiKey }),
    }
  }

  return {
    source: 'api',
    client: classifyClient({
      sdkClient,
      userAgent: headerValue(headers['user-agent']),
    }),
    ...(apiKey && { apiKey }),
  }
}
