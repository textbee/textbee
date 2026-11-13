package com.vernu.sms.services

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.vernu.sms.AppConstants
import com.vernu.sms.R
import com.vernu.sms.helpers.SharedPreferenceHelper

class StickyNotificationService : Service() {
    companion object {
        private const val TAG = "StickyNotificationService"
        private const val NOTIFICATION_CHANNEL_ID = "stickyNotificationChannel"
        private const val NOTIFICATION_ID = 1
    }

    override fun onBind(intent: Intent): IBinder? {
        Log.i(TAG, "Service onBind ${intent.action}")
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Received start id $startId: $intent")
        val wanted = SharedPreferenceHelper.getSharedPreferenceBoolean(
            applicationContext, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, false
        )
        if (StickyStart.handle(wanted, ::enterForeground, ::leaveForeground)) return START_STICKY
        Log.i(TAG, "Sticky notification off or not allowed, stopping")
        // Does nothing when a newer start request waits, which then decides
        stopSelf(startId)
        return START_NOT_STICKY
    }

    private fun enterForeground(): Boolean = try {
        val notification = createNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        true
    } catch (e: Exception) {
        // Refused, for example on a background restart on Android 12 and newer
        Log.w(TAG, "Cannot start foreground service: ${e.message}")
        false
    }

    private fun leaveForeground() {
        stopForeground(STOP_FOREGROUND_REMOVE)
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.i(TAG, "StickyNotificationService destroyed")
    }

    private fun createNotification(): Notification {
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID, NOTIFICATION_CHANNEL_ID, NotificationManager.IMPORTANCE_HIGH
            ).apply {
                enableVibration(false)
                setShowBadge(false)
            }
            notificationManager.createNotificationChannel(channel)

            // Brings the open app forward instead of starting a second copy
            val pendingIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
                PendingIntent.getActivity(
                    this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
                )
            }

            Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setContentTitle("textbee Active")
                .setContentText("SMS gateway service is active")
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSmallIcon(R.mipmap.ic_launcher)
                .build()
        } else {
            @Suppress("DEPRECATION")
            NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
                .setContentTitle("textbee Active")
                .setContentText("SMS gateway service is active")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSmallIcon(R.mipmap.ic_launcher)
                .build()
        }
    }
}
