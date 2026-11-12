package com.vernu.sms.helpers

import android.telephony.SmsMessage
import android.util.Log
import com.vernu.sms.dtos.DeliveryReportDTO

// Reads the "pdu" and "format" extras of a delivery callback; the server decides
object DeliveryReport {
    private const val TAG = "DeliveryReport"
    const val MAX_PDU_HEX_LENGTH = 600
    private val HEX_DIGITS = "0123456789abcdef".toCharArray()

    /** The report to upload, or null when the callback carries no PDU. */
    fun from(pdu: ByteArray?, format: String?): DeliveryReportDTO? {
        if (pdu == null || pdu.isEmpty()) return null
        return DeliveryReportDTO().apply {
            this.format = format
            status = readStatus(pdu, format)
            this.pdu = hex(pdu)
        }
    }

    /** The status value in a status report PDU, or null when it cannot be read. */
    fun readStatus(pdu: ByteArray?, format: String?): Int? {
        if (pdu == null || pdu.isEmpty() || format == null) return null
        return try {
            val sms = SmsMessage.createFromPdu(pdu, format) ?: return null
            if (!sms.isStatusReportMessage) return null
            sms.status
        } catch (e: Exception) {
            Log.w(TAG, "Could not read the status report: ${e.message}")
            null
        }
    }

    /** Lowercase hex, or null when empty or longer than MAX_PDU_HEX_LENGTH. */
    fun hex(bytes: ByteArray?): String? {
        if (bytes == null || bytes.isEmpty() || bytes.size * 2 > MAX_PDU_HEX_LENGTH) return null
        val out = CharArray(bytes.size * 2)
        bytes.forEachIndexed { i, b ->
            val v = b.toInt() and 0xFF
            out[i * 2] = HEX_DIGITS[v ushr 4]
            out[i * 2 + 1] = HEX_DIGITS[v and 0x0F]
        }
        return String(out)
    }
}
