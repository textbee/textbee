package com.vernu.sms.receivers

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import com.vernu.sms.AppConstants
import com.vernu.sms.database.DeliveryOutcome
import com.vernu.sms.database.MultipartDeliveryTracker
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.helpers.DeliveryReport
import com.vernu.sms.helpers.DeliveryVerdict
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimReport
import com.vernu.sms.workers.DeliverySettleWorker
import com.vernu.sms.workers.SMSStatusUpdateWorker
import java.lang.reflect.Modifier

class SMSStatusReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "SMSStatusReceiver"
        const val SMS_SENT = "SMS_SENT"
        const val SMS_DELIVERED = "SMS_DELIVERED"
        const val EXTRA_PUSH_RECEIVED_AT = "push_received_at"
        const val EXTRA_SEND_ATTEMPTED_AT = "send_attempted_at"
        const val EXTRA_SIM_REPORT = "sim_report"
        const val EXTRA_PART_INDEX = "part_index"
        const val EXTRA_PART_COUNT = "part_count"

        private fun getResultCodeName(resultCode: Int): String? {
            for (clazz in arrayOf<Class<*>>(SmsManager::class.java, Activity::class.java)) {
                try {
                    for (field in clazz.declaredFields) {
                        if (field.type != Int::class.javaPrimitiveType) continue
                        if (!Modifier.isStatic(field.modifiers) || !Modifier.isFinal(field.modifiers)) continue
                        if (!field.name.startsWith("RESULT_")) continue
                        field.isAccessible = true
                        if (field.getInt(null) == resultCode) return "${clazz.simpleName}.${field.name}"
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Reflection failed for ${clazz.simpleName}: ${e.message}")
                }
            }
            return null
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val smsId = intent.getStringExtra("sms_id")
        val smsBatchId = intent.getStringExtra("sms_batch_id")

        val smsDTO = SMSDTO().apply {
            this.smsId = smsId
            this.smsBatchId = smsBatchId
            // Carried through the pending intent from the send worker
            pushReceivedAtInMillis = intent.getLongExtra(EXTRA_PUSH_RECEIVED_AT, 0)
            sendAttemptedAtInMillis = intent.getLongExtra(EXTRA_SEND_ATTEMPTED_AT, 0)
            SimReport.fromJson(intent.getStringExtra(EXTRA_SIM_REPORT))?.let {
                simUsed = it.simUsed
                simSelection = it.selection
            }
        }

        when (intent.action) {
            SMS_SENT -> handleSentStatus(context, intent, resultCode, smsDTO)
            SMS_DELIVERED -> handleDeliveredStatus(context, intent, resultCode, smsDTO)
        }
    }

    private fun handleSentStatus(context: Context, intent: Intent, resultCode: Int, smsDTO: SMSDTO) {
        val timestamp = System.currentTimeMillis()
        when (resultCode) {
            Activity.RESULT_OK -> {
                smsDTO.status = "SENT"
                smsDTO.sentAtInMillis = timestamp
                Log.d(TAG, "SMS sent successfully - ID: ${smsDTO.smsId}")
            }
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> {
                val radioCode = intent.getIntExtra("errorCode", -1)
                var msg = "SMS failed on device. Common causes: no SMS credit on SIM, weak signal, or carrier blocked. Check SIM balance and signal, then try again."
                if (radioCode != -1) msg += " (code $radioCode)"
                setFailed(smsDTO, timestamp, resultCode, msg)
                Log.e(TAG, "SMS failed to send - ID: ${smsDTO.smsId}, Error code: $resultCode, Error: $msg")
            }
            SmsManager.RESULT_ERROR_RADIO_OFF -> setFailed(smsDTO, timestamp, resultCode,
                "Mobile radio is off (e.g. airplane mode). Turn off airplane mode and ensure cellular is on.")
            SmsManager.RESULT_ERROR_NULL_PDU -> setFailed(smsDTO, timestamp, resultCode,
                "Message could not be sent; invalid format or carrier issue. Try a shorter message or different recipient.")
            SmsManager.RESULT_ERROR_NO_SERVICE -> setFailed(smsDTO, timestamp, resultCode,
                "No cellular service. Check signal and try again when you have coverage.")
            SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> setFailed(smsDTO, timestamp, resultCode,
                "Device/carrier send limit reached (too many SMS in a short time). Wait a few minutes or lower the send rate.")
            SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED -> setFailed(smsDTO, timestamp, resultCode,
                "The phone asked whether textbee may text this short code, and the request was denied. In Android settings, open Special app access > Premium SMS access and set textbee to Always allow.")
            SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED -> setFailed(smsDTO, timestamp, resultCode,
                "textbee is blocked from texting short codes on this phone. In Android settings, open Special app access > Premium SMS access and set textbee to Always allow.")
            SmsManager.RESULT_NETWORK_ERROR -> setFailed(smsDTO, timestamp, resultCode,
                "Network error while sending. Check signal and try again.")
            else -> {
                val msg = getResultCodeName(resultCode) ?: "Unknown error (code $resultCode)"
                setFailed(smsDTO, timestamp, resultCode, msg)
                Log.e(TAG, "SMS failed to send - ID: ${smsDTO.smsId}, Error: $msg")
            }
        }
        updateSMSStatus(context, smsDTO)
    }

    private fun handleDeliveredStatus(context: Context, intent: Intent, resultCode: Int, smsDTO: SMSDTO) {
        val timestamp = System.currentTimeMillis()
        when (resultCode) {
            Activity.RESULT_OK -> {
                // Android sends every status report with RESULT_OK. The
                // carrier's verdict is in the PDU; without one, keep the old
                // behaviour and count the report as delivered.
                val format = intent.getStringExtra("format")
                val verdict = DeliveryReport.read(intent.getByteArrayExtra("pdu"), format)
                    ?: DeliveryVerdict.Delivered
                // A 3GPP2 multipart message asks for a report on its last part only
                val partCount = if (format == DeliveryReport.FORMAT_3GPP2) 1 else intent.getIntExtra(EXTRA_PART_COUNT, 1)
                val partIndex = intent.getIntExtra(EXTRA_PART_INDEX, 0)
                val smsId = smsDTO.smsId
                val outcome = if (smsId == null || partCount <= 1) {
                    MultipartDeliveryTracker.single(verdict)
                } else {
                    MultipartDeliveryTracker.get(context).record(smsId, partIndex, partCount, verdict)
                }
                when (outcome) {
                    DeliveryOutcome.Wait -> {
                        val detail = when (verdict) {
                            DeliveryVerdict.Pending -> "carrier still trying"
                            DeliveryVerdict.Delivered -> "part ${partIndex + 1} of $partCount delivered"
                            is DeliveryVerdict.Failed -> "part ${partIndex + 1} of $partCount ${verdict.code}, already reported"
                        }
                        DeviceLog.log(context, "delivery_report_wait", detail, smsId)
                        // A part report for an open multipart message pushes the settle back
                        if (partCount > 1 && verdict !is DeliveryVerdict.Failed) {
                            DeliverySettleWorker.schedule(context, smsDTO)
                        }
                        return
                    }
                    DeliveryOutcome.Delivered -> {
                        if (partCount > 1) DeliverySettleWorker.cancel(context, smsId)
                        smsDTO.status = "DELIVERED"
                        smsDTO.deliveredAtInMillis = timestamp
                        Log.d(TAG, "SMS delivered successfully - ID: ${smsDTO.smsId}")
                    }
                    is DeliveryOutcome.Failed -> {
                        if (partCount > 1) DeliverySettleWorker.cancel(context, smsId)
                        smsDTO.status = "DELIVERY_FAILED"
                        smsDTO.failedAtInMillis = timestamp
                        smsDTO.errorCode = outcome.code
                        smsDTO.errorMessage = outcome.message
                        Log.e(TAG, "SMS delivery failed - ID: ${smsDTO.smsId}, Error: ${outcome.code}")
                    }
                }
            }
            Activity.RESULT_CANCELED -> {
                val msg = "Delivery report was canceled (e.g. carrier does not support delivery receipts). Message may still have been delivered."
                smsDTO.status = "DELIVERY_FAILED"
                smsDTO.errorCode = resultCode.toString()
                smsDTO.errorMessage = msg
                Log.e(TAG, "SMS delivery failed - ID: ${smsDTO.smsId}, Error: $msg")
            }
            else -> {
                val msg = getResultCodeName(resultCode) ?: "Unknown delivery error (code $resultCode)"
                smsDTO.status = "DELIVERY_FAILED"
                smsDTO.errorCode = resultCode.toString()
                smsDTO.errorMessage = msg
                Log.e(TAG, "SMS delivery failed - ID: ${smsDTO.smsId}, Error: $msg")
            }
        }
        updateSMSStatus(context, smsDTO)
    }

    private fun setFailed(smsDTO: SMSDTO, timestamp: Long, resultCode: Int, msg: String) {
        smsDTO.status = "FAILED"
        smsDTO.failedAtInMillis = timestamp
        smsDTO.errorCode = resultCode.toString()
        smsDTO.errorMessage = msg
    }

    private fun updateSMSStatus(context: Context, smsDTO: SMSDTO) {
        DeviceLog.log(context, "status_${smsDTO.status?.lowercase() ?: "unknown"}", smsDTO.errorMessage ?: "", smsDTO.smsId)
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.e(TAG, "Device ID or API key not found")
            return
        }
        SMSStatusUpdateWorker.enqueueWork(context, deviceId, apiKey, smsDTO)
    }
}
