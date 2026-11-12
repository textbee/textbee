package com.vernu.sms.dtos

import com.google.gson.JsonElement

class HeartbeatResponseDTO {
    @JvmField var success: Boolean = false
    @JvmField var fcmTokenUpdated: Boolean = false
    // ISO date string from the API. A numeric type here fails the whole parse.
    @JvmField var lastHeartbeat: String? = null
    @JvmField var name: String? = null
    @JvmField var pendingCount: Int = 0
    // Raw, so one bad key cannot fail the whole reply. Read by DeviceConfig.read.
    @JvmField var config: JsonElement? = null
}
