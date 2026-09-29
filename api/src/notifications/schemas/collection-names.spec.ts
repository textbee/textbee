import { DashboardNotificationSchema } from './dashboard-notification.schema'
import { NotificationSettingsSchema } from './notification-settings.schema'
import { NotificationStateSchema } from './notification-state.schema'

// These three names are a contract. The same collections are read and written
// outside this service, through its own lean mirrors. The two apps never call each
// other, so nothing at runtime would report a mismatch: each would simply operate
// on a different collection and look correct in its own codebase. The engine flag
// would be set where this API never reads it.
//
// Mongoose derives a name from the class when none is given, and two of these
// classes pluralise to something the other side does not use. The same literals are
// asserted on the other side. If you rename a collection, change it in both.
const EXPECTED: Array<[string, string, any]> = [
  ['DashboardNotification', 'dashboardnotifications', DashboardNotificationSchema],
  ['NotificationState', 'dashboardnotificationstates', NotificationStateSchema],
  [
    'NotificationSettings',
    'dashboardnotificationsettings',
    NotificationSettingsSchema,
  ],
]

describe('notification collection names', () => {
  it.each(EXPECTED.map(([name, collection]) => [name, collection]))(
    '%s is stored in %s',
    (name, collection) => {
      const schema = EXPECTED.find(([n]) => n === name)![2]
      expect(schema.options.collection).toBe(collection)
    },
  )

  it('names every collection explicitly rather than by pluralisation', () => {
    for (const [, , schema] of EXPECTED) {
      expect(schema.options.collection).toBeDefined()
    }
  })
})
