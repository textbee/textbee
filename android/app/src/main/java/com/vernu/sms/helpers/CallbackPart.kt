package com.vernu.sms.helpers

import java.util.Locale

/** The part a sent or delivery callback is about. Both null when unknown. */
data class CallbackPart(val index: Int?, val count: Int?) {
    companion object {
        const val SENT_URI_SCHEME = "textbee-sent"
        const val DELIVERY_URI_SCHEME = "textbee-delivery"
        private const val FORMAT_3GPP2 = "3gpp2"

        fun uri(scheme: String, smsId: String, index: Int, count: Int) = "$scheme://$smsId/$index/$count"

        // Extras first, then the data URI; older intents may carry neither
        fun lookup(extraIndex: Int?, extraCount: Int?, dataUri: String?): CallbackPart {
            val fromUri = fromUri(dataUri)
            val index = extraIndex?.takeIf { it >= 0 } ?: fromUri?.index ?: return CallbackPart(null, null)
            return CallbackPart(index, extraCount?.takeIf { it >= 1 } ?: fromUri?.count)
        }

        // {scheme}://{smsId}/{index}[/{count}]
        private fun fromUri(uri: String?): CallbackPart? {
            if (uri == null) return null
            val path = listOf(SENT_URI_SCHEME, DELIVERY_URI_SCHEME)
                .firstOrNull { uri.startsWith("$it://") }
                ?.let { uri.removePrefix("$it://") } ?: return null
            val segments = path.split('/')
            val index = segments.getOrNull(1)?.toIntOrNull()?.takeIf { it >= 0 } ?: return null
            return CallbackPart(index, segments.getOrNull(2)?.toIntOrNull()?.takeIf { it >= 1 })
        }

        fun sentDetail(part: CallbackPart, resultCode: Int, radioErrorCode: Int?): String =
            "${part.label()}, result $resultCode" + (radioErrorCode?.let { ", error code $it" } ?: "")

        fun deliveryDetail(
            part: CallbackPart,
            resultOk: Boolean,
            resultCode: Int,
            format: String?,
            carrierStatus: Int?,
        ): String {
            val status = when {
                carrierStatus == null -> "no carrier status"
                // A long hex value would read as a phone number to the log redaction
                format == FORMAT_3GPP2 -> "carrier status class %d cause 0x%02X".format(
                    Locale.ROOT, (carrierStatus shr 24) and 0x03, (carrierStatus shr 16) and 0xFF,
                )
                else -> "carrier status 0x%02X".format(Locale.ROOT, carrierStatus)
            }
            return "${part.label()}, $status" + if (resultOk) "" else ", result $resultCode"
        }
    }

    fun label(): String = when {
        index == null -> "part unknown"
        count == null -> "part ${index + 1}"
        else -> "part ${index + 1} of $count"
    }
}
