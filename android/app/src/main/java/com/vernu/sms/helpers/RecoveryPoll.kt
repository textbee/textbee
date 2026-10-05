package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.workers.SmsSendWorker

// Asks the server for messages whose push never arrived and hands them to
// the normal send path. Runs only when the server has switched it on.
object RecoveryPoll {
    private const val TAG = "RecoveryPoll"
    const val MIN_INTERVAL_MS = 5 * 60 * 1000L

    fun shouldPoll(enabled: Boolean, lastPollMs: Long, nowMs: Long): Boolean =
        enabled && (nowMs < lastPollMs || nowMs - lastPollMs >= MIN_INTERVAL_MS)

    fun runAsync(context: Context, reason: String) {
        val appContext = context.applicationContext
        Thread { run(appContext, reason) }.start()
    }

    // Blocking. Returns how many messages were handed to the send path.
    fun run(context: Context, reason: String): Int {
        val now = System.currentTimeMillis()
        val lastPoll = SharedPreferenceHelper.getSharedPreferenceLong(
            context, AppConstants.SHARED_PREFS_LAST_RECOVERY_POLL_MS_KEY, 0L
        )
        if (!shouldPoll(DeviceConfig.recoveryPollEnabled(context), lastPoll, now)) return 0

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        if (deviceId.isEmpty() || apiKey.isEmpty()) return 0

        SharedPreferenceHelper.setSharedPreferenceLong(
            context, AppConstants.SHARED_PREFS_LAST_RECOVERY_POLL_MS_KEY, now
        )

        return try {
            val response = ApiManager.getApiService().getPendingMessages(deviceId, apiKey).execute()
            if (!response.isSuccessful) {
                Log.w(TAG, "Recovery poll ($reason) failed: ${response.code()}")
                return 0
            }
            val messages = response.body()?.data.orEmpty()
            // Stamped after the reply, since the server claims the messages while answering
            val receivedAt = System.currentTimeMillis()
            var enqueued = 0
            for (payload in messages) {
                val smsId = payload.smsId ?: continue
                val message = payload.message ?: continue
                for (recipient in payload.recipients.orEmpty()) {
                    SmsSendWorker.enqueue(
                        context, recipient, message, smsId, payload.smsBatchId,
                        payload.simSubscriptionId, receivedAt
                    )
                    enqueued++
                }
            }
            Log.d(TAG, "Recovery poll ($reason): ${messages.size} messages, $enqueued sends enqueued")
            DeviceLog.log(context, "recovery_poll", "$reason: ${messages.size} message(s)")
            enqueued
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Recovery poll failed")
            0
        }
    }
}
