package com.vernu.sms.helpers

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
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
        timing: SendTiming = SendTiming(),
        sim: SimReport? = null
    ): Boolean {
        if (!TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS)) {
            Log.e(TAG, "SMS permission not granted. Unable to send SMS.")
            reportPermissionError(context, smsId, smsBatchId, timing, sim)
            return false
        }
        return try {
            send(SmsManager.getDefault(), phoneNo, message, smsId, smsBatchId, context, timing, sim)
            true
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Exception when sending SMS")
            reportSendingError(context, smsId, smsBatchId, e.message, timing, sim)
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
        timing: SendTiming = SendTiming(),
        sim: SimReport? = null
    ): Boolean {
        if (!TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS) ||
            !TextbeeUtils.isPermissionGranted(context, Manifest.permission.READ_PHONE_STATE)
        ) {
            Log.e(TAG, "SMS or Phone State permission not granted. Unable to send SMS from specific SIM.")
            reportPermissionError(context, smsId, smsBatchId, timing, sim)
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
            send(smsManager, phoneNo, message, smsId, smsBatchId, context, timing, sim)
            true
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Exception when sending SMS from specific SIM")
            reportSendingError(context, smsId, smsBatchId, e.message, timing, sim)
            false
        }
    }

    private fun send(
        smsManager: SmsManager,
        phoneNo: String,
        message: String,
        smsId: String,
        smsBatchId: String,
        context: Context,
        timing: SendTiming,
        sim: SimReport?
    ) {
        val sentIntent = createSentPendingIntent(context, smsId, smsBatchId, timing, sim)
        val parts = smsManager.divideMessage(message)
        if (parts.size > 1) {
            val sentIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                repeat(parts.size) { list.add(sentIntent) }
            }
            // One intent per part, so each part's delivery report can be told apart
            val deliveredIntents = ArrayList<PendingIntent>(parts.size).also { list ->
                for (i in parts.indices) {
                    list.add(createDeliveredPendingIntent(context, smsId, smsBatchId, timing, sim, i, parts.size))
                }
            }
            smsManager.sendMultipartTextMessage(phoneNo, null, parts, sentIntents, deliveredIntents)
        } else {
            val deliveredIntent = createDeliveredPendingIntent(context, smsId, smsBatchId, timing, sim)
            smsManager.sendTextMessage(phoneNo, null, message, sentIntent, deliveredIntent)
        }
    }

    private fun reportPermissionError(
        context: Context,
        smsId: String,
        smsBatchId: String,
        timing: SendTiming,
        sim: SimReport?
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
            // Nothing reached the radio, so no SIM is claimed
            simSelection = sim?.selection
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
        timing: SendTiming,
        sim: SimReport?
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
            // Nothing reached the radio, so no SIM is claimed
            simSelection = sim?.selection
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
        timing: SendTiming,
        sim: SimReport?
    ): PendingIntent {
        val intent = Intent(context, SMSStatusReceiver::class.java).apply {
            action = SMSStatusReceiver.SMS_SENT
            putExtra("sms_id", smsId)
            putExtra("sms_batch_id", smsBatchId)
            putExtra(SMSStatusReceiver.EXTRA_PUSH_RECEIVED_AT, timing.pushReceivedAtMillis)
            putExtra(SMSStatusReceiver.EXTRA_SEND_ATTEMPTED_AT, timing.sendAttemptedAtMillis)
            sim?.let { putExtra(SMSStatusReceiver.EXTRA_SIM_REPORT, it.toJson()) }
        }
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        return PendingIntent.getBroadcast(context, (smsId + "_sent").hashCode(), intent, flags)
    }

    private fun createDeliveredPendingIntent(
        context: Context,
        smsId: String,
        smsBatchId: String,
        timing: SendTiming,
        sim: SimReport?,
        partIndex: Int = 0,
        partCount: Int = 1
    ): PendingIntent {
        val intent = Intent(context, SMSStatusReceiver::class.java).apply {
            action = SMSStatusReceiver.SMS_DELIVERED
            // A unique data URI makes each part its own PendingIntent, even
            // when two request codes collide
            data = Uri.parse("textbee-delivery://$smsId/$partIndex")
            putExtra("sms_id", smsId)
            putExtra("sms_batch_id", smsBatchId)
            putExtra(SMSStatusReceiver.EXTRA_PUSH_RECEIVED_AT, timing.pushReceivedAtMillis)
            putExtra(SMSStatusReceiver.EXTRA_SEND_ATTEMPTED_AT, timing.sendAttemptedAtMillis)
            putExtra(SMSStatusReceiver.EXTRA_PART_INDEX, partIndex)
            putExtra(SMSStatusReceiver.EXTRA_PART_COUNT, partCount)
            sim?.let { putExtra(SMSStatusReceiver.EXTRA_SIM_REPORT, it.toJson()) }
        }
        // FLAG_MUTABLE: Android adds the report's "pdu" and "format" extras
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
        val key = if (partCount > 1) "${smsId}_delivered_$partIndex" else "${smsId}_delivered"
        return PendingIntent.getBroadcast(context, key.hashCode(), intent, flags)
    }
}
