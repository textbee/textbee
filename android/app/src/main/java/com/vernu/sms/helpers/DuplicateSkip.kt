package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import com.vernu.sms.AppConstants
import com.vernu.sms.database.SendMarkerStore
import com.vernu.sms.dtos.SMSDTO

// A message this phone already handed to the radio was offered again. It is
// not sent; the server gets the last status the phone knows instead.
object DuplicateSkip {
    private const val TAG = "DuplicateSkip"
    // A younger "sending" marker is a send whose result is still on its way
    const val INTERRUPTED_AFTER_MS = 5 * 60 * 1000L
    const val SEND_INTERRUPTED = "SEND_INTERRUPTED"

    private val countLock = Any()

    fun report(context: Context, smsId: String, phone: String, smsBatchId: String?) {
        try {
            incrementCount(context)
            val marker = SendMarkerStore.get(context).find(smsId, phone)
            val known = SendMarkerStore.get(context).exists(smsId, phone)
            val dto = statusFor(marker, known, System.currentTimeMillis())
            DeviceLog.log(context, "send_skipped", "already handled, ${dto?.status ?: "result pending"}", smsId)
            if (dto == null) return
            dto.smsId = smsId
            dto.smsBatchId = smsBatchId

            val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
                context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
            ) ?: ""
            val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
                context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
            ) ?: ""
            if (deviceId.isEmpty() || apiKey.isEmpty()) return
            DirectUpload.status(context, deviceId, apiKey, dto)
        } catch (e: Exception) {
            // The skip itself already happened; only the report is lost
            Log.w(TAG, "Could not report a skipped duplicate: ${e.message}")
        }
    }

    // Null when nothing should be uploaded yet.
    // known: a marker exists, even one that cannot be read.
    fun statusFor(marker: SendMarkerStore.Marker?, known: Boolean, nowMs: Long): SMSDTO? {
        val dto = SMSDTO()
        when (marker?.state) {
            SendMarkerStore.SENT -> {
                dto.status = "SENT"
                dto.sentAtInMillis = marker.atMs
            }
            SendMarkerStore.FAILED -> {
                dto.status = "FAILED"
                dto.failedAtInMillis = marker.atMs
                dto.errorCode = marker.errorCode
                dto.errorMessage = marker.errorMessage
            }
            else -> {
                val age = nowMs - (marker?.atMs ?: 0L)
                if (marker != null && age in 0 until INTERRUPTED_AFTER_MS) return null
                dto.status = "UNKNOWN"
                dto.errorCode = SEND_INTERRUPTED
                dto.errorMessage = if (known) {
                    "The app stopped before the result of this send arrived. The message may have been sent."
                } else {
                    "This message was already handed to the radio. Its result is not known."
                }
            }
        }
        return dto
    }

    fun count(context: Context): Long =
        SharedPreferenceHelper.getSharedPreferenceLong(
            context, AppConstants.SHARED_PREFS_DEDUPE_SKIP_COUNT_KEY, 0L
        )

    private fun incrementCount(context: Context) = synchronized(countLock) {
        SharedPreferenceHelper.setSharedPreferenceLong(
            context, AppConstants.SHARED_PREFS_DEDUPE_SKIP_COUNT_KEY, count(context) + 1
        )
    }
}
