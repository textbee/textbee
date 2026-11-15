package com.vernu.sms.dtos

import com.google.gson.JsonElement
import com.vernu.sms.models.SMSPayload

class ClaimMessagesInputDTO(
    @JvmField val limit: Int,
    @JvmField val source: String,
    @JvmField val installId: String,
)

class ClaimMessagesResponseDTO {
    @JvmField var data: List<SMSPayload>? = null
    @JvmField var more: Boolean? = null
    // Any JSON number parses, so an odd value cannot lose the claimed messages
    @JvmField var retryAfterSeconds: Double? = null
    // Raw, so one bad key cannot lose the claimed messages
    @JvmField var config: JsonElement? = null
}
