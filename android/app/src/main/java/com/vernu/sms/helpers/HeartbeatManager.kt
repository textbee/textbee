package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.vernu.sms.AppConstants
import com.vernu.sms.workers.HeartbeatWorker
import java.util.concurrent.TimeUnit

object HeartbeatManager {
    private const val TAG = "HeartbeatManager"
    private const val PERIOD_MINUTES = 15L
    private const val UNIQUE_WORK_NAME = "heartbeat_pull_periodic_work"
    private const val OLD_UNIQUE_WORK_NAME = "heartbeat_unique_work"
    private const val TRIGGER_WORK_NAME = "heartbeat_trigger_work"
    // Lets quick successive edits (typing a delay, toggling twice) share one heartbeat
    private const val TRIGGER_DELAY_SECONDS = 3L
    // Stops a failing heartbeat from repeating on every screen resume
    private const val RESUME_RETRY_MS = 10 * 60 * 1000L

    // One periodic job for the heartbeat and the message claim. KEEP leaves a
    // running schedule alone, so opening the app does not push the next run back.
    @JvmStatic
    fun scheduleHeartbeat(context: Context) {
        val appContext = context.applicationContext
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val periodicWork = PeriodicWorkRequest.Builder(
            HeartbeatWorker::class.java,
            PERIOD_MINUTES,
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .addTag(AppConstants.HEARTBEAT_WORK_TAG)
            .build()

        val workManager = WorkManager.getInstance(appContext)
        // The job of earlier versions ran at the heartbeat interval
        workManager.cancelUniqueWork(OLD_UNIQUE_WORK_NAME)
        workManager.enqueueUniquePeriodicWork(
            UNIQUE_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            periodicWork
        )
        Log.d(TAG, "Periodic job scheduled with unique work name: $UNIQUE_WORK_NAME")
    }

    // The job runs every 15 minutes; the heartbeat keeps its own interval
    @JvmStatic
    fun isHeartbeatDue(context: Context): Boolean {
        val intervalMinutes = SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_HEARTBEAT_INTERVAL_MINUTES_KEY, 30
        )
        val lastMs = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY, ""
        )?.toLongOrNull() ?: 0L
        return isHeartbeatDue(intervalMinutes, lastMs, System.currentTimeMillis())
    }

    fun isHeartbeatDue(intervalMinutes: Int, lastHeartbeatMs: Long, nowMs: Long): Boolean {
        val intervalMs = maxOf(intervalMinutes.toLong(), PERIOD_MINUTES) * 60_000L
        // Runs drift, so a run up to half a period early still counts
        val slackMs = PERIOD_MINUTES * 60_000L / 2
        return nowMs < lastHeartbeatMs || nowMs - lastHeartbeatMs >= intervalMs - slackMs
    }

    @JvmStatic
    fun cancelHeartbeat(context: Context) {
        Log.d(TAG, "Cancelling heartbeat work")
        val appContext = context.applicationContext
        WorkManager.getInstance(appContext).cancelUniqueWork(UNIQUE_WORK_NAME)
        WorkManager.getInstance(appContext).cancelUniqueWork(OLD_UNIQUE_WORK_NAME)
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
