export interface WebhookData {
  // Required: it goes into the update and delete request paths, so an absent
  // one would PATCH /webhooks/undefined. Anything the API returns has one.
  _id: string
  name?: string
  deliveryUrl: string
  events: string[]
  // Set when the webhook only receives events for one device.
  deviceId?: string
  isActive: boolean
  signingSecret: string
}

export interface WebhookPayload {
  smsId: string
  sender: string
  message: string
  receivedAt: string
  deviceId: string
  webhookSubscriptionId: string
  webhookEvent: string
}
