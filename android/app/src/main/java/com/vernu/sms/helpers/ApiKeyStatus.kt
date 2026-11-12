package com.vernu.sms.helpers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vernu.sms.AppConstants
import com.vernu.sms.R

// Tracks whether the server still accepts this device's API key
object ApiKeyStatus {
    private const val NOTIFICATION_ID = 7394
    private const val MIN_GAP_MS = 24 * 3_600_000L
    private val lock = Any()

    // The new stored time after a reply: 401 sets it once, 2xx clears it, anything else keeps it
    fun next(code: Int, storedMs: Long, nowMs: Long): Long = when {
        code == 401 -> if (storedMs > 0L) storedMs else nowMs
        code in 200..299 -> 0L
        else -> storedMs
    }

    // A reply counts only when it was made with the key stored now
    fun isCurrentKey(usedKey: String, currentKey: String): Boolean = usedKey.isNotEmpty() && usedKey == currentKey

    // Null when the reply says nothing about the current key
    fun decide(code: Int, usedKey: String, currentKey: String, storedMs: Long, nowMs: Long): Long? =
        if (!isCurrentKey(usedKey, currentKey)) null else next(code, storedMs, nowMs)

    // A clock set backwards must not mute the notice forever
    fun shouldNotify(nowMs: Long, lastMs: Long, minGapMs: Long = MIN_GAP_MS): Boolean =
        lastMs <= 0L || nowMs < lastMs || nowMs - lastMs >= minGapMs

    fun rejectedAt(context: Context): Long =
        SharedPreferenceHelper.getSharedPreferenceLong(context, AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY, 0L)

    fun clear(context: Context) {
        synchronized(lock) {
            SharedPreferenceHelper.setSharedPreferenceLong(context, AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY, 0L)
            cancelNotification(context)
        }
    }

    private fun cancelNotification(context: Context) {
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
        } catch (e: Exception) {
            DeviceLog.log(context, "api_key_cancel_failed", e.javaClass.simpleName)
        }
    }

    // Called with the code of every request made with the API key. Never throws.
    @JvmStatic
    fun record(context: Context, code: Int, usedApiKey: String) {
        try {
            // The state, the notification and its daily limit change together, so a late reply cannot undo a newer one
            val (stored, updated) = synchronized(lock) {
                // A queued job may still carry a key the user already replaced
                val current = SharedPreferenceHelper.getSharedPreferenceString(
                    context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
                ) ?: ""
                val stored = rejectedAt(context)
                val updated = decide(code, usedApiKey, current, stored, System.currentTimeMillis()) ?: return
                if (updated != stored) {
                    SharedPreferenceHelper.setSharedPreferenceLong(
                        context, AppConstants.SHARED_PREFS_API_KEY_REJECTED_AT_KEY, updated
                    )
                }
                if (updated > 0L) maybeNotify(context)
                else if (stored > 0L) cancelNotification(context)
                stored to updated
            }
            if (updated != stored) DeviceLog.log(context, if (updated > 0L) "api_key_rejected" else "api_key_accepted")
        } catch (e: Throwable) {
            DeviceLog.log(context, "api_key_status_failed", e.javaClass.simpleName)
        }
    }

    // Call only while holding lock
    private fun maybeNotify(context: Context) {
        try {
            if (rejectedAt(context) <= 0L) return
            val now = System.currentTimeMillis()
            val last = SharedPreferenceHelper.getSharedPreferenceLong(
                context, AppConstants.SHARED_PREFS_LAST_API_KEY_NOTIFIED_AT_KEY, 0L
            )
            if (!shouldNotify(now, last)) return
            if (!DeviceHealth.evaluate(context).hasPostNotificationsPermission) return
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(
                        PermissionFailureNotifier.CHANNEL_ID, PermissionFailureNotifier.CHANNEL_NAME,
                        NotificationManager.IMPORTANCE_HIGH
                    )
                )
                if (manager.getNotificationChannel(PermissionFailureNotifier.CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE) return
            }

            val builder = NotificationCompat.Builder(context, PermissionFailureNotifier.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle("textbee needs a new API key")
                .setContentText("The API key of this device no longer works. Tap to fix.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ERROR)
                .setAutoCancel(true)
            context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
                builder.setContentIntent(
                    PendingIntent.getActivity(
                        context, NOTIFICATION_ID, launch,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                )
            }

            manager.notify(NOTIFICATION_ID, builder.build())
            SharedPreferenceHelper.setSharedPreferenceLong(
                context, AppConstants.SHARED_PREFS_LAST_API_KEY_NOTIFIED_AT_KEY, now
            )
            DeviceLog.log(context, "api_key_notified")
        } catch (e: Exception) {
            DeviceLog.log(context, "api_key_notify_failed", e.javaClass.simpleName)
        }
    }
}
