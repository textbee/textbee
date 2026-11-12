package com.vernu.sms.helpers

import android.content.Context
import com.vernu.sms.AppConstants
import com.vernu.sms.dtos.DeviceConfigDTO

// Settings the server sends on every heartbeat and claim reply. Until the first reply arrives
// every switch reads as off, so a fresh install behaves like the old app.
object DeviceConfig {
    fun save(context: Context, config: DeviceConfigDTO?) {
        if (config == null) return
        config.sendSchedulerV2Enabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_SEND_SCHEDULER_V2_KEY, it
            )
        }
        config.recoveryPollEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_RECOVERY_POLL_KEY, it
            )
        }
        // A reply without the field comes from a server that does not know pull
        setPullEnabled(context, config.pullEnabled == true)
        setPartReportsEnabled(context, config)
        config.directUploadEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_KEY, it
            )
        }
        config.updateNotificationsEnabled?.let {
            SharedPreferenceHelper.setSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_CONFIG_UPDATE_NOTIFICATIONS_KEY, it
            )
        }
        config.latestVersionCode?.let {
            SharedPreferenceHelper.setSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_CODE_KEY, it
            )
        }
        config.latestVersionName?.let {
            SharedPreferenceHelper.setSharedPreferenceString(
                context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_NAME_KEY, it
            )
        }
    }

    fun sendSchedulerV2Enabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_SEND_SCHEDULER_V2_KEY, false
        )

    fun recoveryPollEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_RECOVERY_POLL_KEY, false
        )

    // On: messages are claimed with PullClient and RecoveryPoll stays idle
    fun pullEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PULL_KEY, false
        )

    fun setPullEnabled(context: Context, enabled: Boolean) =
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PULL_KEY, enabled
        )

    fun directUploadEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_KEY, false
        )

    const val PART_REPORTS_DEFAULT = false

    // A reply without the key or without a config turns part reports off
    fun partReportsEnabled(config: DeviceConfigDTO?): Boolean = config?.partReportsEnabled == true

    fun setPartReportsEnabled(context: Context, config: DeviceConfigDTO?) =
        SharedPreferenceHelper.setSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PART_REPORTS_KEY, partReportsEnabled(config)
        )

    fun partReportsEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_PART_REPORTS_KEY, PART_REPORTS_DEFAULT
        )

    fun updateNotificationsEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_UPDATE_NOTIFICATIONS_KEY, false
        )

    fun latestVersionCode(context: Context): Int =
        SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_CODE_KEY, 0
        )

    fun latestVersionName(context: Context): String? =
        SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_CONFIG_LATEST_VERSION_NAME_KEY, null
        )
}
