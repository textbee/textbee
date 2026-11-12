package com.vernu.sms.helpers

import android.Manifest
import android.content.Context
import android.os.Build
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils

data class DeviceHealthSnapshot(
    val hasSendSmsPermission: Boolean,
    val hasReceiveSmsPermission: Boolean,
    val hasReadPhoneStatePermission: Boolean,
    val hasPostNotificationsPermission: Boolean,
    val stickyNotificationEnabled: Boolean,
    val usingLegacyUi: Boolean,
)

// The raw reads behind each check, so the checks can be tested without Android
interface DeviceHealthProbe {
    val sdkInt: Int
    fun isPermissionGranted(permission: String): Boolean
    fun prefBoolean(key: String, default: Boolean): Boolean
}

object DeviceHealth {
    private const val POST_NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS"

    fun evaluate(probe: DeviceHealthProbe): DeviceHealthSnapshot = DeviceHealthSnapshot(
        hasSendSmsPermission = probe.isPermissionGranted(Manifest.permission.SEND_SMS),
        hasReceiveSmsPermission = probe.isPermissionGranted(Manifest.permission.RECEIVE_SMS),
        hasReadPhoneStatePermission = probe.isPermissionGranted(Manifest.permission.READ_PHONE_STATE),
        // Only Android 13 and up has the permission; older versions always show notifications
        hasPostNotificationsPermission = probe.sdkInt < 33 || probe.isPermissionGranted(POST_NOTIFICATIONS),
        stickyNotificationEnabled = probe.prefBoolean(AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, false),
        usingLegacyUi = !probe.prefBoolean(AppConstants.SHARED_PREFS_USE_NEW_UI_KEY, true),
    )

    @JvmStatic
    fun evaluate(context: Context): DeviceHealthSnapshot = evaluate(AndroidProbe(context))

    // The user's switch alone decides; the service needs no SMS permission
    @JvmStatic
    fun shouldStartSticky(snapshot: DeviceHealthSnapshot): Boolean = snapshot.stickyNotificationEnabled

    private class AndroidProbe(private val context: Context) : DeviceHealthProbe {
        override val sdkInt: Int get() = Build.VERSION.SDK_INT
        override fun isPermissionGranted(permission: String) =
            TextbeeUtils.isPermissionGranted(context, permission)
        override fun prefBoolean(key: String, default: Boolean) =
            SharedPreferenceHelper.getSharedPreferenceBoolean(context, key, default)
    }
}
