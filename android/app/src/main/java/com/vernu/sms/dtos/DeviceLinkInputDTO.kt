package com.vernu.sms.dtos

// The phone's facts for a sign-in request. The server ignores fields it does not use yet.
class DeviceLinkInputDTO {
    var deviceName: String? = null
    var brand: String? = null
    var manufacturer: String? = null
    var model: String? = null
    var appVersionCode: Int? = null
    var appVersionName: String? = null
    var osApiLevel: Int? = null
    var locale: String? = null
    var deviceId: String? = null
    var installerPackage: String? = null
    var playServicesStatus: Int? = null
    var hasStoredKey: Boolean? = null
    var keyRejected: Boolean? = null
    var clientProtocol: Int? = null
}
