package com.vernu.sms.helpers

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.os.BatteryManager
import android.os.Build
import android.os.StatFs
import android.os.SystemClock
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.HeartbeatInputDTO
import com.vernu.sms.dtos.SimInfoCollectionDTO
import java.io.IOException
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object HeartbeatHelper {
    private const val TAG = "HeartbeatHelper"

    @JvmStatic
    fun sendHeartbeat(context: Context, deviceId: String, apiKey: String): Boolean {
        if (deviceId.isEmpty()) {
            Log.d(TAG, "Device not registered, skipping heartbeat")
            return false
        }
        if (apiKey.isEmpty()) {
            Log.e(TAG, "API key not available, skipping heartbeat")
            return false
        }

        val heartbeatInput = HeartbeatInputDTO()

        return try {
            // FCM token (blocking wait up to 5 seconds)
            try {
                val latch = CountDownLatch(1)
                var fcmTokenResult: String? = null
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    if (task.isSuccessful) fcmTokenResult = task.result
                    latch.countDown()
                }
                if (latch.await(5, TimeUnit.SECONDS) && fcmTokenResult != null) {
                    heartbeatInput.fcmToken = fcmTokenResult
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to get FCM token: ${e.message}")
            }

            // Battery info
            val batteryStatus = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            if (batteryStatus != null) {
                val level = batteryStatus.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
                val scale = batteryStatus.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
                heartbeatInput.batteryPercentage = ((level / scale.toFloat()) * 100).toInt()
                val status = batteryStatus.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                heartbeatInput.isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == BatteryManager.BATTERY_STATUS_FULL
            }

            // Network type
            @Suppress("DEPRECATION")
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            @Suppress("DEPRECATION")
            val activeNetwork = cm?.activeNetworkInfo
            @Suppress("DEPRECATION")
            heartbeatInput.networkType = when {
                activeNetwork?.isConnected == true && activeNetwork.type == ConnectivityManager.TYPE_WIFI -> "wifi"
                activeNetwork?.isConnected == true && activeNetwork.type == ConnectivityManager.TYPE_MOBILE -> "cellular"
                else -> "none"
            }

            // App version
            heartbeatInput.appVersionName = BuildConfig.VERSION_NAME
            heartbeatInput.appVersionCode = BuildConfig.VERSION_CODE

            // OS version, so devices backfill without needing to re-register
            heartbeatInput.osVersion = Build.VERSION.RELEASE
            heartbeatInput.osApiLevel = Build.VERSION.SDK_INT

            // Device uptime
            heartbeatInput.deviceUptimeMillis = SystemClock.uptimeMillis()

            // Memory
            val runtime = Runtime.getRuntime()
            heartbeatInput.memoryFreeBytes = runtime.freeMemory()
            heartbeatInput.memoryTotalBytes = runtime.totalMemory()
            heartbeatInput.memoryMaxBytes = runtime.maxMemory()

            // Storage
            val statFs = StatFs(context.filesDir.path)
            heartbeatInput.storageAvailableBytes = statFs.availableBytes
            heartbeatInput.storageTotalBytes = statFs.totalBytes

            // Locale / timezone
            heartbeatInput.timezone = TimeZone.getDefault().id
            heartbeatInput.locale = Locale.getDefault().toString()

            // Preferences
            heartbeatInput.receiveSMSEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_RECEIVE_SMS_ENABLED_KEY, false
            )
            heartbeatInput.smsSendDelaySeconds = SharedPreferenceHelper.getSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
                AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
            )

            // SIM info
            heartbeatInput.simInfo = SimInfoCollectionDTO().apply {
                lastUpdated = System.currentTimeMillis()
                sims = TextbeeUtils.collectSimInfo(context)
            }

            // Send heartbeat (blocking)
            val response = ApiManager.getApiService().heartbeat(deviceId, apiKey, heartbeatInput).execute()
            if (response.isSuccessful && response.body() != null) {
                val body = response.body() ?: return false
                if (body.fcmTokenUpdated) Log.d(TAG, "FCM token was updated during heartbeat")
                val deviceName = body.name
                if (!deviceName.isNullOrBlank()) {
                    SharedPreferenceHelper.setSharedPreferenceString(
                        context, AppConstants.SHARED_PREFS_DEVICE_NAME_KEY, deviceName
                    )
                    Log.d(TAG, "Synced device name from heartbeat: ${body.name}")
                }
                SharedPreferenceHelper.setSharedPreferenceString(
                    context, AppConstants.SHARED_PREFS_LAST_HEARTBEAT_MS_KEY,
                    System.currentTimeMillis().toString()
                )
                Log.d(TAG, "Heartbeat sent successfully")
                true
            } else {
                Log.e(TAG, "Failed to send heartbeat. Response code: ${response.code()}")
                false
            }
        } catch (e: IOException) {
            Log.e(TAG, "Heartbeat API call failed: ${e.message}")
            false
        } catch (e: Exception) {
            Log.e(TAG, "Error collecting device information: ${e.message}")
            false
        }
    }

    @JvmStatic
    fun isDeviceEligibleForHeartbeat(context: Context): Boolean {
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        if (deviceId.isEmpty()) return false

        val deviceEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
        )
        if (!deviceEnabled) return false

        return SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_HEARTBEAT_ENABLED_KEY, true
        )
    }
}
