package com.vernu.sms.dtos

class SMSDTO {
    var sender: String? = null
    var message: String = ""
    var receivedAtInMillis: Long = 0
    var fingerprint: String? = null
    var smsId: String? = null
    var smsBatchId: String? = null
    var status: String? = null
    var sentAtInMillis: Long = 0
    var deliveredAtInMillis: Long = 0
    var failedAtInMillis: Long = 0
    var errorCode: String? = null
    var errorMessage: String? = null

    // Reported so the server can split the wait into push, queue and radio
    var pushReceivedAtInMillis: Long = 0
    var sendAttemptedAtInMillis: Long = 0

    // Which attempt of this worker's retry loop filed the report
    var reportAttempt: Int = 0

    // The SIM the message went through, when the phone can tell
    var simUsed: SimUsedDTO? = null
    var simSelection: String? = null

    // Raw data of one sent or delivery callback. Null fields are left out.
    var partIndex: Int? = null
    var partCount: Int? = null
    var resultCode: Int? = null
    var radioErrorCode: Int? = null
    var deliveryReport: DeliveryReportDTO? = null
}
