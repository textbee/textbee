package com.vernu.sms.dtos

class RegisterDeviceInputDTO {
    var fcmToken: String? = null
    @get:JvmName("isEnabled") var enabled: Boolean? = null
    var brand: String? = null
    var manufacturer: String? = null
    var model: String? = null
    var name: String? = null
    var serial: String? = null
    var buildId: String? = null
    var os: String? = null
    var osVersion: String? = null
    var osApiLevel: Int? = null
    var osBuildFingerprint: String? = null
    var appVersionName: String? = null
    var appVersionCode: Int? = null
    var simInfo: SimInfoCollectionDTO? = null
    var installId: String? = null
    var installerPackage: String? = null
    var initiatingPackage: String? = null
    var appLastUpdateTime: Long? = null
}
