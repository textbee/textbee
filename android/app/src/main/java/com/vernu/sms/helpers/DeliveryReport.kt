package com.vernu.sms.helpers

import android.telephony.SmsMessage
import android.util.Log
import java.util.Locale

// The carrier's verdict in an SMS status report. Android sends every report
// to the delivery PendingIntent with RESULT_OK; the verdict is only in the
// "pdu" and "format" extras (SmsDispatchersController.handleSmsStatusReport).
sealed class DeliveryVerdict {
    object Delivered : DeliveryVerdict()

    // The carrier is still trying. A later report decides.
    object Pending : DeliveryVerdict()

    data class Failed(val code: String, val message: String) : DeliveryVerdict()
}

object DeliveryReport {
    private const val TAG = "DeliveryReport"
    const val FORMAT_3GPP = "3gpp"
    const val FORMAT_3GPP2 = "3gpp2"
    const val CODE_PREFIX = "CARRIER_"

    private fun hex(value: Int) = "0x%02X".format(Locale.ROOT, value)

    /** The verdict in a status report PDU, or null when there is none to read. */
    fun read(pdu: ByteArray?, format: String?): DeliveryVerdict? {
        if (pdu == null || pdu.isEmpty() || format == null) return null
        return try {
            val sms = SmsMessage.createFromPdu(pdu, format) ?: return null
            if (!sms.isStatusReportMessage) return null
            verdict(format, sms.status)
        } catch (e: Exception) {
            Log.w(TAG, "Could not read the status report: ${e.message}")
            null
        }
    }

    fun verdict(format: String, status: Int): DeliveryVerdict? = when (format) {
        FORMAT_3GPP -> gsmVerdict(status)
        FORMAT_3GPP2 -> cdmaVerdict(status)
        else -> null
    }

    // TP-Status, 3GPP TS 23.040 section 9.2.3.15
    fun gsmVerdict(status: Int): DeliveryVerdict? {
        // createFromPdu falls back to the other format; a 3GPP2 value is shifted
        if (status < 0 || status > 0xFF) return null
        val code = CODE_PREFIX + hex(status)
        return when {
            status < 0x20 -> DeliveryVerdict.Delivered
            status < 0x40 -> DeliveryVerdict.Pending
            status in 0x60..0x7F -> DeliveryVerdict.Failed(
                code,
                "The carrier stopped trying to deliver the message after a temporary error (TP-Status ${hex(status)}).",
            )
            else -> DeliveryVerdict.Failed(
                code,
                "The carrier could not deliver the message and stopped trying (TP-Status ${hex(status)}).",
            )
        }
    }

    // Error class in bits 25-24, cause code in bits 23-16 (3GPP2 C.S0015-B
    // 4.5.21). Same rule as the framework: class 0 is delivered, class 2 is
    // temporary, any other class is a failure.
    fun cdmaVerdict(status: Int): DeliveryVerdict {
        val errorClass = (status shr 24) and 0x03
        val cause = (status shr 16) and 0xFF
        return when (errorClass) {
            0 -> DeliveryVerdict.Delivered
            2 -> DeliveryVerdict.Pending
            else -> DeliveryVerdict.Failed(
                "${CODE_PREFIX}3GPP2_${hex(cause)}",
                "The carrier could not deliver the message and stopped trying (3GPP2 status ${hex(cause)}).",
            )
        }
    }
}
