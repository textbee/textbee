package com.vernu.sms.helpers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vernu.sms.AppConstants
import com.vernu.sms.R
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.ui.main.NewMainActivity

// One silent notification per notice id that the server marks with notify
object NoticeNotifier {
    private const val CHANNEL_ID = "notices"
    private const val NOTIFICATION_ID = 7395
    const val MAX_NOTIFIED = 50

    fun toNotify(visible: List<AppNotice>, notifiedIds: Collection<String>): List<AppNotice> =
        visible.filter { it.notify && it.id !in notifiedIds }

    fun maybeNotify(context: Context) {
        try {
            notifyNew(context)
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Notice notification failed")
        }
    }

    // Posting and cancelling use the same shown list, so one pass never posts and then cancels
    @Synchronized
    private fun notifyNew(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val shown = Notices.visible(context)
        cancelHidden(manager, shown)

        var notified = notifiedIds(context)
        val pending = toNotify(shown, notified)
        if (pending.isEmpty()) return
        if (!DeviceHealth.evaluate(context).hasPostNotificationsPermission) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Notices", NotificationManager.IMPORTANCE_LOW)
            )
        }
        // A blocked channel shows nothing; do not record the ids as notified
        val blocked = !NotificationManagerCompat.from(context).areNotificationsEnabled() ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                manager.getNotificationChannel(CHANNEL_ID)?.importance == NotificationManager.IMPORTANCE_NONE)
        if (blocked) return

        val home = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: Intent(context, NewMainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val open = PendingIntent.getActivity(
            context, 0, home, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        pending.forEach { notice ->
            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(notice.title ?: "textbee")
                .setContentText(notice.text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(notice.text))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()
            manager.notify(notice.id, NOTIFICATION_ID, notification)
            notified = Notices.idsAfter(notified, notice.id, MAX_NOTIFIED)
            DeviceLog.log(context, "notice_notified", notice.id)
        }
        SharedPreferenceHelper.setSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_NOTICE_NOTIFIED_IDS_KEY, Notices.idsToJson(notified)
        )
    }

    // Removes the notification of each notice that is closed, expired or gone
    @Synchronized
    fun cancelHidden(context: Context) {
        try {
            context.getSystemService(NotificationManager::class.java)?.let { cancelHidden(it, Notices.visible(context)) }
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Notice notification cancel failed")
        }
    }

    private fun cancelHidden(manager: NotificationManager, shown: List<AppNotice>) {
        val shownIds = shown.map { it.id }.toSet()
        manager.activeNotifications
            .filter { it.id == NOTIFICATION_ID && it.tag != null && it.tag !in shownIds }
            .forEach { manager.cancel(it.tag, NOTIFICATION_ID) }
    }

    private fun notifiedIds(context: Context): List<String> =
        Notices.idsFromJson(SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_NOTICE_NOTIFIED_IDS_KEY, null))
}
