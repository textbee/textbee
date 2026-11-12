package com.vernu.sms.dtos

// The carrier's status report for one part, as Android handed it over
class DeliveryReportDTO {
    var format: String? = null
    var status: Int? = null
    var pdu: String? = null
}
