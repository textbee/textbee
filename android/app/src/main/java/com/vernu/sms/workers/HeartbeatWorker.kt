package com.vernu.sms.workers

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.vernu.sms.AppConstants
import com.vernu.sms.helpers.HeartbeatHelper
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.PullClient
import com.vernu.sms.helpers.SharedPreferenceHelper

class HeartbeatWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "HeartbeatWorker"
        const val KEY_ONE_SHOT = "one_shot"
    }

    override fun doWork(): Result {
        val context = applicationContext
        val oneShot = inputData.getBoolean(KEY_ONE_SHOT, false)

        val heartbeatOk = runHeartbeat(context, oneShot)
        if (!heartbeatOk) {
            Log.w(TAG, if (oneShot) "One-shot heartbeat failed, the periodic one reports the change later"
                else "Heartbeat failed, the next periodic run sends it again")
        }
        // The periodic run is also the timer for claims. A user who turned
        // the heartbeat off still gets it. Does nothing unless the server
        // switched pull on. Runs here, so the job lives until the claimed
        // messages are queued.
        if (!oneShot) PullClient.claimBlocking(context, "timer")

        // Never retry: a backoff would also hold back the claim timer. A
        // failed heartbeat stays due and goes out with the next run.
        return Result.success()
    }

    // False only when a heartbeat was sent and failed
    private fun runHeartbeat(context: Context, oneShot: Boolean): Boolean {
        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(context)) {
            Log.d(TAG, "Device not eligible for heartbeat, skipping")
            return true
        }
        if (!oneShot && !HeartbeatManager.isHeartbeatDue(context)) return true

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        return HeartbeatHelper.sendHeartbeat(context, deviceId, apiKey)
    }
}
