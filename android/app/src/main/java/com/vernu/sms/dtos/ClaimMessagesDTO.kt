package com.vernu.sms.dtos

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
    @JvmField var config: DeviceConfigDTO? = null
}
