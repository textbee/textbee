package com.vernu.sms.workers

import com.vernu.sms.dtos.DeliveryReportDTO
import com.vernu.sms.dtos.SMSDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StatusWorkNameTest {
    private fun dto(status: String, partIndex: Int? = null, carrierStatus: Int? = null, pdu: Boolean = false) =
        SMSDTO().apply {
            smsId = "m1"
            this.status = status
            this.partIndex = partIndex
            partCount = partIndex?.let { 3 }
            if (pdu || carrierStatus != null) {
                deliveryReport = DeliveryReportDTO().apply { format = "3gpp"; this.status = carrierStatus }
            }
        }

    @Test
    fun offKeepsTheOldNameForEveryPart() {
        assertEquals("sms_status_m1_SENT", SMSStatusUpdateWorker.workName(dto("SENT", 0), false))
        assertEquals("sms_status_m1_SENT", SMSStatusUpdateWorker.workName(dto("SENT", 2), false))
        assertEquals("sms_status_m1_DELIVERED", SMSStatusUpdateWorker.workName(dto("DELIVERED", 1, 0x20), false))
        assertEquals("sms_status_m1_FAILED", SMSStatusUpdateWorker.workName(dto("FAILED"), false))
    }

    @Test
    fun onNamesThePartStatusAndCarrierStatus() {
        assertEquals("sms_status_m1_2_SENT_none", SMSStatusUpdateWorker.workName(dto("SENT", 2), true))
        assertEquals("sms_status_m1_1_DELIVERED_0", SMSStatusUpdateWorker.workName(dto("DELIVERED", 1, 0), true))
        assertEquals("sms_status_m1_1_DELIVERED_32", SMSStatusUpdateWorker.workName(dto("DELIVERED", 1, 0x20), true))
    }

    @Test
    fun onUsesXForAnUnknownPartAndNoneForAnUnreadableReport() {
        assertEquals("sms_status_m1_x_FAILED_none", SMSStatusUpdateWorker.workName(dto("FAILED"), true))
        assertEquals("sms_status_m1_0_DELIVERED_none", SMSStatusUpdateWorker.workName(dto("DELIVERED", 0, pdu = true), true))
    }

    @Test
    fun onTellsUnreadableReportsApartByTheirPdu() {
        fun withPdu(hex: String) = dto("DELIVERED", 1, pdu = true).apply { deliveryReport!!.pdu = hex }
        val trying = SMSStatusUpdateWorker.workName(withPdu("0601aa20"), true)
        val final = SMSStatusUpdateWorker.workName(withPdu("0601aa00"), true)

        assertTrue(trying, Regex("sms_status_m1_1_DELIVERED_none_[0-9a-f]{8}").matches(trying))
        assertNotEquals(trying, final)
        assertEquals(trying, SMSStatusUpdateWorker.workName(withPdu("0601aa20"), true))
        assertEquals("sms_status_m1_DELIVERED", SMSStatusUpdateWorker.workName(withPdu("0601aa20"), false))
    }
}
