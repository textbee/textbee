package com.vernu.sms.helpers

import android.content.Context
import com.vernu.sms.AppConstants
import com.vernu.sms.dtos.DeviceConfigDTO

// Settings the server sends on every heartbeat. Until the first reply arrives
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

    fun directUploadEnabled(context: Context): Boolean =
        SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_CONFIG_DIRECT_UPLOAD_KEY, false
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
