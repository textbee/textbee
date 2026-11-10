package com.vernu.sms.dtos

class DeviceConfigDTO {
    var sendSchedulerV2Enabled: Boolean? = null
    var recoveryPollEnabled: Boolean? = null
    var directUploadEnabled: Boolean? = null
    var updateNotificationsEnabled: Boolean? = null
    var latestVersionCode: Int? = null
    var latestVersionName: String? = null
}
