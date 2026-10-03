package com.vernu.sms.helpers

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.ActivityCompat
import com.vernu.sms.AppConstants

// Shared help for a missing SMS permission, including Android 15 restricted settings
object SmsPermissionHelp {
    const val GUIDE_URL =
        "https://textbee.dev/blog/android-15-send-sms-permission-guide?utm_source=android&utm_medium=app&utm_campaign=sms_permission"

    private const val MENU_STEP =
        "Tap the menu (⋮) in the top right and choose Allow restricted settings. Confirm with your PIN or fingerprint. If the menu is not there, skip this step."

    val needsRestrictedSettings: Boolean get() = Build.VERSION.SDK_INT >= 35

    fun steps(restricted: Boolean = needsRestrictedSettings): List<String> = listOfNotNull(
        "Tap Open app settings below.",
        MENU_STEP.takeIf { restricted },
        "Tap Permissions, then SMS, then Allow.",
        "Come back to textbee.",
    )

    fun intro(restricted: Boolean = needsRestrictedSettings): String =
        if (restricted) "Android can lock SMS for apps installed outside the Play Store until you allow restricted settings."
        else "Android does not ask again after a denial. Allow SMS in the app settings."

    fun findActivity(context: Context): Activity? {
        var current: Context? = context
        while (current is ContextWrapper) {
            if (current is Activity) return current
            current = current.baseContext
        }
        return null
    }

    fun isBlocked(granted: Boolean, requestedBefore: Boolean, canShowRationale: Boolean): Boolean =
        !granted && requestedBefore && !canShowRationale

    fun canShowRationale(activity: Activity?, permission: String): Boolean =
        activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, permission)

    fun openAppSettings(context: Context) {
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        if (!start(context, details)) start(context, Intent(Settings.ACTION_SETTINGS))
    }

    fun openGuide(context: Context) {
        start(context, Intent(Intent.ACTION_VIEW, Uri.parse(GUIDE_URL)))
    }

    // Tells the server right away, so the dashboard warning clears without waiting for the next heartbeat
    fun reportGranted(context: Context) {
        val app = context.applicationContext
        Thread {
            try {
                val deviceId = SharedPreferenceHelper.getSharedPreferenceString(app, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, "") ?: ""
                val apiKey = SharedPreferenceHelper.getSharedPreferenceString(app, AppConstants.SHARED_PREFS_API_KEY_KEY, "") ?: ""
                if (apiKey.isNotEmpty() && HeartbeatHelper.isDeviceEligibleForHeartbeat(app)) {
                    HeartbeatHelper.sendHeartbeat(app, deviceId, apiKey)
                }
            } catch (e: Throwable) {
                Log.e("SmsPermissionHelp", "Heartbeat after permission grant failed", e)
            }
        }.start()
    }

    private fun start(context: Context, intent: Intent): Boolean = try {
        if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        true
    } catch (e: Exception) {
        false
    }
}
