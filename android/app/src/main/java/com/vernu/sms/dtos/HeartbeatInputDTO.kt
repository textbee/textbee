package com.vernu.sms.dtos

class HeartbeatInputDTO {
    var fcmToken: String? = null
    var batteryPercentage: Int? = null
    var isCharging: Boolean? = null
    var networkType: String? = null
    var appVersionName: String? = null
    var appVersionCode: Int? = null
    var osVersion: String? = null
    var osApiLevel: Int? = null
    var deviceUptimeMillis: Long? = null
    var memoryFreeBytes: Long? = null
    var memoryTotalBytes: Long? = null
    var memoryMaxBytes: Long? = null
    var storageAvailableBytes: Long? = null
    var storageTotalBytes: Long? = null
    var timezone: String? = null
    var locale: String? = null
    var receiveSMSEnabled: Boolean? = null
    var smsSendDelaySeconds: Int? = null
    var isIgnoringBatteryOptimizations: Boolean? = null
    var isDeviceIdleMode: Boolean? = null
    var isPowerSaveMode: Boolean? = null
    var hasSendSmsPermission: Boolean? = null
    var hasReceiveSmsPermission: Boolean? = null
    var hasReadPhoneStatePermission: Boolean? = null
    var hasPostNotificationsPermission: Boolean? = null
    var stickyNotificationEnabled: Boolean? = null
    var usingLegacyUi: Boolean? = null
    var simInfo: SimInfoCollectionDTO? = null
    var installId: String? = null
    var pullCapable: Boolean? = null
    var lastPushReceivedAt: Long? = null
    var dedupeSkipCount: Long? = null
}
