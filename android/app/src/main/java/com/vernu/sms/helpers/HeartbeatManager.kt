package com.vernu.sms.helpers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.vernu.sms.AppConstants
import com.vernu.sms.workers.HeartbeatWorker
import java.util.concurrent.TimeUnit

// REPLACE or KEEP for the periodic job, its period, and the start delay
data class ScheduleDecision(
    val policy: ExistingPeriodicWorkPolicy,
    val periodMinutes: Int,
    val initialDelayMinutes: Int,
)

object HeartbeatManager {
    private const val TAG = "HeartbeatManager"
    private const val UNIQUE_WORK_NAME = "heartbeat_pull_periodic_work"
    private const val OLD_UNIQUE_WORK_NAME = "heartbeat_unique_work"
    private const val TRIGGER_WORK_NAME = "heartbeat_trigger_work"
    // Lets quick successive edits (typing a delay, toggling twice) share one heartbeat
    private const val TRIGGER_DELAY_SECONDS = 3L
    // Stops a failing heartbeat from repeating on every screen resume
    private const val RESUME_RETRY_MS = 10 * 60 * 1000L

    // Only a run that just sent a heartbeat delays the replaced job by one period
    fun scheduleDecision(wantedMinutes: Int, appliedMinutes: Int?, afterRun: Boolean): ScheduleDecision {
        val period = DeviceConfig.PERIODIC_JOB_MINUTES.clamp(wantedMinutes)
        return when {
            appliedMinutes == period -> ScheduleDecision(ExistingPeriodicWorkPolicy.KEEP, period, 0)
            afterRun -> ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, period, period)
            else -> ScheduleDecision(ExistingPeriodicWorkPolicy.REPLACE, period, 0)
        }
    }

    fun appliedPeriodMinutes(context: Context): Int? =
        SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_APPLIED_PERIOD_MINUTES_KEY, 0
        ).takeIf { it > 0 }

    // One periodic job for the heartbeat and the message claim
    @JvmStatic
    @JvmOverloads
    fun scheduleHeartbeat(context: Context, afterRun: Boolean = false) {
        val appContext = context.applicationContext
        val decision = scheduleDecision(
            DeviceConfig.periodicJobMinutes(appContext), appliedPeriodMinutes(appContext), afterRun
        )

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val periodicWork = PeriodicWorkRequest.Builder(
            HeartbeatWorker::class.java,
            decision.periodMinutes.toLong(),
            TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setInitialDelay(decision.initialDelayMinutes.toLong(), TimeUnit.MINUTES)
            .addTag(AppConstants.HEARTBEAT_WORK_TAG)
            .build()

        val workManager = WorkManager.getInstance(appContext)
        workManager.enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, decision.policy, periodicWork)
        if (decision.policy == ExistingPeriodicWorkPolicy.REPLACE) {
            SharedPreferenceHelper.commitSharedPreferenceInt(
                appContext, AppConstants.SHARED_PREFS_APPLIED_PERIOD_MINUTES_KEY, decision.periodMinutes
            )
        }
        // The 2.9.0 job, cancelled last since its own run may be the caller
        workManager.cancelUniqueWork(OLD_UNIQUE_WORK_NAME)
        Log.d(TAG, "Periodic job ${decision.policy}, every ${decision.periodMinutes} minutes")
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
