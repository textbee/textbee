package com.vernu.sms.workers

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.vernu.sms.AppConstants
import com.vernu.sms.helpers.HeartbeatHelper
import com.vernu.sms.helpers.SharedPreferenceHelper

class HeartbeatWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "HeartbeatWorker"
        const val KEY_ONE_SHOT = "one_shot"
    }

    override fun doWork(): Result {
        val context = applicationContext

        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(context)) {
            Log.d(TAG, "Device not eligible for heartbeat, skipping")
            return Result.success()
        }

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""

        return if (HeartbeatHelper.sendHeartbeat(context, deviceId, apiKey)) {
            Result.success()
        } else if (inputData.getBoolean(KEY_ONE_SHOT, false)) {
            Log.w(TAG, "One-shot heartbeat failed, the periodic one reports the change later")
            Result.success()
        } else {
            Log.e(TAG, "Failed to send heartbeat, will retry")
            Result.retry()
        }
    }
}
