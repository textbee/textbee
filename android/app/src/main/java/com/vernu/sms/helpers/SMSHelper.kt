package com.vernu.sms.helpers

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.receivers.SMSStatusReceiver
import com.vernu.sms.workers.SMSStatusUpdateWorker

/** When the push arrived and when the radio was called, for one message. */
data class SendTiming(
    val pushReceivedAtMillis: Long = 0,
    val sendAttemptedAtMillis: Long = 0,
)

object SMSHelper {
    private const val TAG = "SMSHelper"

    @JvmStatic
    @JvmOverloads
    fun sendSMS(
        phoneNo: String,
        message: String,
        smsId: String,
        smsBatchId: String,
        context: Context,
        timing: SendTiming = SendTiming()
    ): Boolean {
        if (!TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS)) {
            Log.e(TAG, "SMS permission not granted. Unable to send SMS.")
            reportPermissionError(context, smsId, smsBatchId, timing)
            return false
        }
        return try {
            val smsManager = SmsManager.getDefault()
            val sentIntent = createSentPendingIntent(context, smsId, smsBatchId, timing)
            val deliveredIntent = createDeliveredPendingIntent(context, smsId, smsBatchId, timing)
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                val sentIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                    repeat(parts.size) { list.add(sentIntent) }
                }
                val deliveredIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                    repeat(parts.size) { list.add(deliveredIntent) }
                }
                smsManager.sendMultipartTextMessage(phoneNo, null, parts, sentIntents, deliveredIntents)
            } else {
                smsManager.sendTextMessage(phoneNo, null, message, sentIntent, deliveredIntent)
            }
            true
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Exception when sending SMS")
            reportSendingError(context, smsId, smsBatchId, e.message, timing)
            false
        }
    }

    @JvmStatic
    @JvmOverloads
    fun sendSMSFromSpecificSim(
        phoneNo: String,
        message: String,
        simSubscriptionId: Int,
        smsId: String,
        smsBatchId: String,
        context: Context,
        timing: SendTiming = SendTiming()
    ): Boolean {
        if (!TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS) ||
            !TextbeeUtils.isPermissionGranted(context, Manifest.permission.READ_PHONE_STATE)
        ) {
            Log.e(TAG, "SMS or Phone State permission not granted. Unable to send SMS from specific SIM.")
            reportPermissionError(context, smsId, smsBatchId, timing)
            return false
        }
        return try {
            @Suppress("DEPRECATION")
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
                SmsManager.getSmsManagerForSubscriptionId(simSubscriptionId)
            } else {
                Log.w(TAG, "Using default SIM as specific SIM selection not supported on this Android version")
                SmsManager.getDefault()
            }
            val sentIntent = createSentPendingIntent(context, smsId, smsBatchId, timing)
            val deliveredIntent = createDeliveredPendingIntent(context, smsId, smsBatchId, timing)
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                val sentIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                    repeat(parts.size) { list.add(sentIntent) }
                }
                val deliveredIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                    repeat(parts.size) { list.add(deliveredIntent) }
                }
                smsManager.sendMultipartTextMessage(phoneNo, null, parts, sentIntents, deliveredIntents)
            } else {
                smsManager.sendTextMessage(phoneNo, null, message, sentIntent, deliveredIntent)
            }
            true
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Exception when sending SMS from specific SIM")
            reportSendingError(context, smsId, smsBatchId, e.message, timing)
            false
        }
    }

    private fun reportPermissionError(
        context: Context,
        smsId: String,
        smsBatchId: String,
        timing: SendTiming
    ) {
        val smsDTO = SMSDTO().apply {
            this.smsId = smsId
            this.smsBatchId = smsBatchId
            status = "FAILED"
            failedAtInMillis = System.currentTimeMillis()
            errorCode = "PERMISSION_DENIED"
            errorMessage = "SMS permission not granted"
            pushReceivedAtInMillis = timing.pushReceivedAtMillis
            sendAttemptedAtInMillis = timing.sendAttemptedAtMillis
        }
        updateSMSStatus(context, smsDTO)
        try {
            PermissionFailureNotifier.maybeNotify(context)
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Permission failure notification failed")
        }
    }

    private fun reportSendingError(
        context: Context,
        smsId: String,
        smsBatchId: String,
        error: String?,
        timing: SendTiming
    ) {
        val smsDTO = SMSDTO().apply {
            this.smsId = smsId
            this.smsBatchId = smsBatchId
            status = "FAILED"
            failedAtInMillis = System.currentTimeMillis()
            errorCode = "SENDING_EXCEPTION"
            errorMessage = error
            pushReceivedAtInMillis = timing.pushReceivedAtMillis
            sendAttemptedAtInMillis = timing.sendAttemptedAtMillis
        }
        updateSMSStatus(context, smsDTO)
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
        SMSStatusUpdateWorker.enqueueWork(context, deviceId, apiKey, smsDTO)
    }

    private fun createSentPendingIntent(
        context: Context,
        smsId: String,
        smsBatchId: String,
        timing: SendTiming
    ): PendingIntent {
        val intent = Intent(context, SMSStatusReceiver::class.java).apply {
            action = SMSStatusReceiver.SMS_SENT
            putExtra("sms_id", smsId)
            putExtra("sms_batch_id", smsBatchId)
            putExtra(SMSStatusReceiver.EXTRA_PUSH_RECEIVED_AT, timing.pushReceivedAtMillis)
            putExtra(SMSStatusReceiver.EXTRA_SEND_ATTEMPTED_AT, timing.sendAttemptedAtMillis)
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(context, (smsId + "_sent").hashCode(), intent, flags)
    }

    private fun createDeliveredPendingIntent(
        context: Context,
        smsId: String,
        smsBatchId: String,
        timing: SendTiming
    ): PendingIntent {
        val intent = Intent(context, SMSStatusReceiver::class.java).apply {
            action = SMSStatusReceiver.SMS_DELIVERED
            putExtra("sms_id", smsId)
            putExtra("sms_batch_id", smsBatchId)
            putExtra(SMSStatusReceiver.EXTRA_PUSH_RECEIVED_AT, timing.pushReceivedAtMillis)
            putExtra(SMSStatusReceiver.EXTRA_SEND_ATTEMPTED_AT, timing.sendAttemptedAtMillis)
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(context, (smsId + "_delivered").hashCode(), intent, flags)
    }
}
