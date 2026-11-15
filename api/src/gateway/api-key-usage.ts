import { Types } from 'mongoose'

// A key reports the devices that sent a heartbeat within this window
export const API_KEY_DEVICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// The $set that records the request's API key, empty when there is none or it is already stored
export function apiKeyUsageUpdate(
  device: { apiKey?: Types.ObjectId | string | null } | null | undefined,
  apiKeyId: Types.ObjectId | string | null | undefined,
): { apiKey?: Types.ObjectId } {
  if (!apiKeyId || !Types.ObjectId.isValid(String(apiKeyId))) return {}
  if (device?.apiKey != null && String(device.apiKey) === String(apiKeyId)) {
    return {}
  }
  return { apiKey: new Types.ObjectId(String(apiKeyId)) }
}
