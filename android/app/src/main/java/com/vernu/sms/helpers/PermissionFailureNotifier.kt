package com.vernu.sms.helpers

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vernu.sms.AppConstants
import com.vernu.sms.R
import com.vernu.sms.TextbeeUtils

// Tells the user on the phone when a send failed because the SMS permission is off
object PermissionFailureNotifier {
    private const val CHANNEL_ID = "sms_permission"
    private const val NOTIFICATION_ID = 7393
    private const val MIN_GAP_MS = 3_600_000L

    // A clock set backwards must not mute the notice forever
    fun shouldNotify(nowMs: Long, lastMs: Long, minGapMs: Long = MIN_GAP_MS): Boolean =
        lastMs <= 0L || nowMs < lastMs || nowMs - lastMs >= minGapMs

    fun maybeNotify(context: Context) {
        try {
            val now = System.currentTimeMillis()
            val last = SharedPreferenceHelper.getSharedPreferenceLong(
                context, AppConstants.SHARED_PREFS_LAST_PERMISSION_NOTIFIED_AT_KEY, 0L
            )
            if (!shouldNotify(now, last)) return
            if (!DeviceHealth.evaluate(context).hasPostNotificationsPermission) return
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Sending problems", NotificationManager.IMPORTANCE_HIGH)
                )
                if (manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE) return
            }

            // SMS allowed means the send targeted a SIM and the Phone permission is the one missing
            val phoneOnly = TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS)
            val builder = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(if (phoneOnly) "textbee cannot send from the chosen SIM" else "textbee cannot send SMS")
                .setContentText(
                    if (phoneOnly) "Android has not allowed the Phone permission. Tap to fix it."
                    else "Android has not allowed the SMS permission. Tap to fix it."
                )
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
                context, AppConstants.SHARED_PREFS_LAST_PERMISSION_NOTIFIED_AT_KEY, now
            )
            DeviceLog.log(context, "permission_notified")
        } catch (e: Exception) {
            DeviceLog.log(context, "permission_notify_failed", e.javaClass.simpleName)
        }
    }
}
