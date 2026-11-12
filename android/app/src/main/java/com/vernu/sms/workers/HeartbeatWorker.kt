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

        // A cancelled job or a device that left the gateway must not queue itself again
        fun reschedulesAfterRun(stopped: Boolean, eligible: Boolean): Boolean = !stopped && eligible
    }

    override fun doWork(): Result {
        val context = applicationContext
        val oneShot = inputData.getBoolean(KEY_ONE_SHOT, false)

        val heartbeatOk = runHeartbeat(context)
        if (!heartbeatOk) {
            Log.w(TAG, if (oneShot) "One-shot heartbeat failed, the periodic one reports the change later"
                else "Heartbeat failed, the next periodic run sends it again")
        }
        // Never retry: a backoff would also hold back the claim timer
        if (oneShot) return Result.success()

        PullClient.claimBlocking(context, "timer")

        // Last: a new period replaces this job and stops this run
        val eligible = HeartbeatHelper.isDeviceEligibleForHeartbeat(context)
        if (reschedulesAfterRun(isStopped, eligible)) HeartbeatManager.scheduleHeartbeat(context, afterRun = true)
        return Result.success()
    }

    // False only when a heartbeat was sent and failed
    private fun runHeartbeat(context: Context): Boolean {
        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(context)) {
            Log.d(TAG, "Device not eligible for heartbeat, skipping")
            return true
        }

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        return HeartbeatHelper.sendHeartbeat(context, deviceId, apiKey)
    }
}
