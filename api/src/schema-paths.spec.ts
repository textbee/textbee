import { Schema } from 'mongoose'
import { DeviceSchema } from './gateway/schemas/device.schema'
import { DeviceTombstoneSchema } from './gateway/schemas/device-tombstone.schema'
import { SMSSchema } from './gateway/schemas/sms.schema'
import { SMSBatchSchema } from './gateway/schemas/sms-batch.schema'
import { ApiKeySchema } from './auth/schemas/api-key.schema'
import { ApiKeyTombstoneSchema } from './auth/schemas/api-key-tombstone.schema'
import { AccessFootprintSchema } from './auth/schemas/access-footprint.schema'
import { PasswordResetSchema } from './auth/schemas/password-reset.schema'
import { EmailVerificationSchema } from './auth/schemas/email-verification.schema'
import { BillingNotificationSchema } from './billing/schemas/billing-notification.schema'
import { CheckoutSessionSchema } from './billing/schemas/checkout-session.schema'
import { SubscriptionSchema } from './billing/schemas/subscription.schema'
import { WebhookSubscriptionSchema } from './webhook/schemas/webhook-subscription.schema'
import { WebhookNotificationSchema } from './webhook/schemas/webhook-notification.schema'
import { SupportMessageSchema } from './support/schemas/support-message.schema'
import { NotificationStateSchema } from './notifications/schemas/notification-state.schema'

// Reference fields must compile to real ObjectId paths. A path that silently
// degrades to Mixed skips query casting, so any filter built from a string id
// (route params, request.user.id) matches nothing.
const REF_PATHS: Array<[string, Schema, string[]]> = [
  ['Device', DeviceSchema, ['user']],
  ['DeviceTombstone', DeviceTombstoneSchema, ['deviceId', 'userId']],
  ['SMS', SMSSchema, ['user', 'device', 'smsBatch']],
  ['SMSBatch', SMSBatchSchema, ['user', 'device']],
  ['ApiKey', ApiKeySchema, ['user']],
  ['ApiKeyTombstone', ApiKeyTombstoneSchema, ['apiKeyId', 'userId']],
  ['AccessFootprint', AccessFootprintSchema, ['apiKey', 'user']],
  ['PasswordReset', PasswordResetSchema, ['user']],
  ['EmailVerification', EmailVerificationSchema, ['user']],
  ['BillingNotification', BillingNotificationSchema, ['user']],
  ['CheckoutSession', CheckoutSessionSchema, ['user']],
  ['Subscription', SubscriptionSchema, ['user', 'plan']],
  ['WebhookSubscription', WebhookSubscriptionSchema, ['user']],
  ['WebhookNotification', WebhookNotificationSchema, ['webhookSubscription', 'sms']],
  ['SupportMessage', SupportMessageSchema, ['user']],
  ['NotificationState', NotificationStateSchema, ['user', 'notification']],
]

describe('schema reference paths', () => {
  describe.each(REF_PATHS)('%s', (_name, schema, fields) => {
    it.each(fields)('%s is an ObjectId path', (field) => {
      expect(schema.path(field)?.instance).toBe('ObjectId')
    })
  })
})
