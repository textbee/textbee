export const ApiEndpoints = {
  auth: {
    login: () => '/auth/login',
    register: () => '/auth/register',
    signInWithGoogle: () => '/auth/google-login',
    updateProfile: () => '/auth/update-profile',
    changePassword: () => '/auth/change-password',

    whoAmI: () => '/auth/who-am-i',
    updateOnboarding: () => '/auth/onboarding',

    sendEmailVerificationEmail: () => '/auth/send-email-verification-email',
    verifyEmail: () => '/auth/verify-email',

    requestPasswordReset: () => '/auth/request-password-reset',
    resetPassword: () => '/auth/reset-password',

    generateApiKey: () => '/auth/api-keys',
    listApiKeys: (status?: 'active' | 'revoked' | 'all') =>
      status
        ? `/auth/api-keys?status=${encodeURIComponent(status)}`
        : '/auth/api-keys',
    revokeApiKey: (id: string) => `/auth/api-keys/${id}/revoke`,
    renameApiKey: (id: string) => `/auth/api-keys/${id}/rename`,
    deleteApiKey: (id: string) => `/auth/api-keys/${id}`,
  },
  gateway: {
    listDevices: () => '/gateway/devices',
    deleteDevice: (id: string) => `/gateway/devices/${id}`,
    setDefaultDevice: (id: string) => `/gateway/devices/${id}/set-default`,
    // Device-agnostic: the id now travels in the body, optionally, and the API
    // falls back to the account's default device when it is absent.
    sendSMS: () => '/gateway/send-sms',
    sendBulkSMS: () => '/gateway/send-bulk-sms',
    // Account-level: device selection travels as a deviceIds query param,
    // absent means every live device on the account.
    getMessages: () => '/gateway/messages',

    getWebhooks: () => '/webhooks',
    getWebhookNotifications: () => '/webhooks/notifications',
    createWebhook: () => '/webhooks',
    updateWebhook: (id: string) => `/webhooks/${id}`,
    deleteWebhook: (id: string) => `/webhooks/${id}`,
    getStats: () => '/gateway/stats',
    smsPermissionStatus: () => '/gateway/sms-permission-status',
  },
  billing: {
    currentSubscription: () => '/billing/current-subscription',
    checkout: () => '/billing/checkout',
    changePlan: () => '/billing/change-plan',
    plans: () => '/billing/plans',
  },
  support: {
    customerSupport: () => '/support/customer-support',
    requestAccountDeletion: () => '/support/request-account-deletion',
  },
  notifications: {
    feed: () => '/notifications/feed',
    events: () => '/notifications/events',
    dismiss: (id: string) => `/notifications/${id}/dismiss`,
  },
}
