package com.vernu.sms.receivers

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.SmsManager
import android.util.Log
import com.vernu.sms.AppConstants
import com.vernu.sms.database.SendMarkerStore
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.helpers.CallbackPart
import com.vernu.sms.helpers.DeliveryReport
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.DirectUpload
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimReport
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
        const val EXTRA_RECIPIENT = "recipient"
        private const val EXTRA_RADIO_ERROR_CODE = "errorCode"

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
            val part = CallbackPart.lookup(
                if (intent.hasExtra(EXTRA_PART_INDEX)) intent.getIntExtra(EXTRA_PART_INDEX, -1) else null,
                if (intent.hasExtra(EXTRA_PART_COUNT)) intent.getIntExtra(EXTRA_PART_COUNT, -1) else null,
                intent.dataString,
            )
            partIndex = part.index
            partCount = part.count
        }
        smsDTO.resultCode = resultCode

        when (intent.action) {
            SMS_SENT -> handleSentStatus(context, intent, resultCode, smsDTO)
            SMS_DELIVERED -> handleDeliveredStatus(context, intent, resultCode, smsDTO)
        }
    }

    private fun handleSentStatus(context: Context, intent: Intent, resultCode: Int, smsDTO: SMSDTO) {
        val timestamp = System.currentTimeMillis()
        if (intent.hasExtra(EXTRA_RADIO_ERROR_CODE)) {
            smsDTO.radioErrorCode = intent.getIntExtra(EXTRA_RADIO_ERROR_CODE, -1)
        }
        when (resultCode) {
            Activity.RESULT_OK -> {
                smsDTO.status = "SENT"
                smsDTO.sentAtInMillis = timestamp
                Log.d(TAG, "SMS sent successfully - ID: ${smsDTO.smsId}")
            }
            SmsManager.RESULT_ERROR_GENERIC_FAILURE -> {
                val radioCode = intent.getIntExtra(EXTRA_RADIO_ERROR_CODE, -1)
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
        recordSendResult(context, intent, smsDTO)
        DeviceLog.log(
            context, "sent_report",
            CallbackPart.sentDetail(part(smsDTO), resultCode, smsDTO.radioErrorCode),
            smsDTO.smsId,
        )
        updateSMSStatus(context, smsDTO)
    }

    // Moves the send marker on, so a later duplicate can restate this result
    private fun recordSendResult(context: Context, intent: Intent, smsDTO: SMSDTO) {
        val smsId = smsDTO.smsId ?: return
        val recipient = intent.getStringExtra(EXTRA_RECIPIENT) ?: return
        try {
            val sent = smsDTO.status == "SENT"
            SendMarkerStore.get(context).finish(
                smsId, recipient,
                if (sent) SendMarkerStore.SENT else SendMarkerStore.FAILED,
                if (sent) null else smsDTO.errorCode,
                if (sent) null else smsDTO.errorMessage,
            )
        } catch (e: Exception) {
            Log.w(TAG, "Could not update the send marker: ${e.message}")
        }
    }

    private fun handleDeliveredStatus(context: Context, intent: Intent, resultCode: Int, smsDTO: SMSDTO) {
        val timestamp = System.currentTimeMillis()
        val report = DeliveryReport.from(intent.getByteArrayExtra("pdu"), intent.getStringExtra("format"))
        smsDTO.deliveryReport = report
        when (resultCode) {
            // Every carrier status is reported as delivered. The server reads the raw status.
            Activity.RESULT_OK -> {
                smsDTO.status = "DELIVERED"
                smsDTO.deliveredAtInMillis = timestamp
                Log.d(TAG, "SMS delivery report - ID: ${smsDTO.smsId}, carrier status: ${report?.status}")
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
        DeviceLog.log(
            context, "delivery_report",
            CallbackPart.deliveryDetail(
                part(smsDTO), resultCode == Activity.RESULT_OK, resultCode, report?.format, report?.status,
            ),
            smsDTO.smsId,
        )
        updateSMSStatus(context, smsDTO)
    }

    private fun part(smsDTO: SMSDTO) = CallbackPart(smsDTO.partIndex, smsDTO.partCount)

    private fun setFailed(smsDTO: SMSDTO, timestamp: Long, resultCode: Int, msg: String) {
        smsDTO.status = "FAILED"
        smsDTO.failedAtInMillis = timestamp
        smsDTO.errorCode = resultCode.toString()
        smsDTO.errorMessage = msg
    }

    private fun updateSMSStatus(context: Context, smsDTO: SMSDTO) {
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
        DirectUpload.status(context, deviceId, apiKey, smsDTO)
    }
}
