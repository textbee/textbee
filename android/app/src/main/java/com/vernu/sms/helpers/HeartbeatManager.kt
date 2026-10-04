package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.vernu.sms.AppConstants
import com.vernu.sms.workers.HeartbeatWorker
import java.util.concurrent.TimeUnit

object HeartbeatManager {
    private const val TAG = "HeartbeatManager"
    private const val MIN_INTERVAL_MINUTES = 15
    private const val UNIQUE_WORK_NAME = "heartbeat_unique_work"
    private const val TRIGGER_WORK_NAME = "heartbeat_trigger_work"
    // Lets quick successive edits (typing a delay, toggling twice) share one heartbeat
    private const val TRIGGER_DELAY_SECONDS = 3L
    // Stops a failing heartbeat from repeating on every screen resume
    private const val RESUME_RETRY_MS = 10 * 60 * 1000L

    @JvmStatic
    fun scheduleHeartbeat(context: Context) {
        val appContext = context.applicationContext
        var intervalMinutes = SharedPreferenceHelper.getSharedPreferenceInt(
            appContext, AppConstants.SHARED_PREFS_HEARTBEAT_INTERVAL_MINUTES_KEY, 30
        )
        if (intervalMinutes < MIN_INTERVAL_MINUTES) {
            Log.w(TAG, "Interval $intervalMinutes minutes is less than minimum $MIN_INTERVAL_MINUTES minutes, using minimum")
            intervalMinutes = MIN_INTERVAL_MINUTES
        }
        Log.d(TAG, "Scheduling heartbeat with interval: $intervalMinutes minutes")

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val heartbeatWork = PeriodicWorkRequest.Builder(
            HeartbeatWorker::class.java,
            intervalMinutes.toLong(),
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(AppConstants.HEARTBEAT_WORK_TAG)
            .build()

        WorkManager.getInstance(appContext)
            .enqueueUniquePeriodicWork(
                UNIQUE_WORK_NAME,
                ExistingPeriodicWorkPolicy.REPLACE,
                heartbeatWork
            )
        Log.d(TAG, "Heartbeat scheduled successfully with unique work name: $UNIQUE_WORK_NAME")
    }

    @JvmStatic
    fun cancelHeartbeat(context: Context) {
        Log.d(TAG, "Cancelling heartbeat work")
        val appContext = context.applicationContext
        WorkManager.getInstance(appContext).cancelUniqueWork(UNIQUE_WORK_NAME)
        WorkManager.getInstance(appContext).cancelAllWorkByTag(AppConstants.HEARTBEAT_WORK_TAG)
    }

    /** Sends one heartbeat soon, without resetting the periodic schedule. */
    @JvmStatic
    fun triggerHeartbeat(context: Context) {
        val appContext = context.applicationContext
        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(appContext)) return
        Log.d(TAG, "Triggering immediate heartbeat")

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val work = OneTimeWorkRequest.Builder(HeartbeatWorker::class.java)
            .setInitialDelay(TRIGGER_DELAY_SECONDS, TimeUnit.SECONDS)
            .setConstraints(constraints)
            .setInputData(Data.Builder().putBoolean(HeartbeatWorker.KEY_ONE_SHOT, true).build())
            .addTag(AppConstants.HEARTBEAT_WORK_TAG)
            .build()

        WorkManager.getInstance(appContext)
            .enqueueUniqueWork(TRIGGER_WORK_NAME, ExistingWorkPolicy.REPLACE, work)
    }

    /** Sends a heartbeat if a user-controlled value changed since the last one, e.g. in system settings. */
    @JvmStatic
    fun triggerHeartbeatIfSettingsChanged(context: Context) {
        val appContext = context.applicationContext
        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(appContext)) return
        val current = HeartbeatHelper.reportedSettingsKey(appContext)
        val lastSent = SharedPreferenceHelper.getSharedPreferenceString(
            appContext, AppConstants.SHARED_PREFS_LAST_REPORTED_SETTINGS_KEY, ""
        )
        if (current == lastSent) return

        val lastTried = SharedPreferenceHelper.getSharedPreferenceString(
            appContext, AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_KEY, ""
        )
        val lastTriedAt = SharedPreferenceHelper.getSharedPreferenceLong(
            appContext, AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_AT_KEY, 0L
        )
        val now = System.currentTimeMillis()
        if (current == lastTried && now - lastTriedAt in 0 until RESUME_RETRY_MS) return

        SharedPreferenceHelper.setSharedPreferenceString(
            appContext, AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_KEY, current
        )
        SharedPreferenceHelper.setSharedPreferenceLong(
            appContext, AppConstants.SHARED_PREFS_LAST_TRIGGERED_SETTINGS_AT_KEY, now
        )
        triggerHeartbeat(appContext)
    }
}
