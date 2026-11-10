package com.vernu.sms.models

class SMSPayload {
    var recipients: Array<String>? = null
    var message: String? = null
    var smsId: String? = null
    var smsBatchId: String? = null
    var simSubscriptionId: Int? = null
    // Zero-based. Null when the request names no slot; it wins over simSubscriptionId.
    var simSlotIndex: Int? = null

    // Legacy fields — no longer actively used but kept for backward compatibility
    var receivers: Array<String>? = null
    var smsBody: String? = null
}
