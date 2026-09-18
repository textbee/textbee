package com.vernu.sms.receivers

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.RegisterDeviceResponseDTO
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.SharedPreferenceHelper
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class BootCompletedReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "BootCompletedReceiver"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val stickyNotificationEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
            context, AppConstants.SHARED_PREFS_STICKY_NOTIFICATION_ENABLED_KEY, false
        )
        if (stickyNotificationEnabled && TextbeeUtils.isPermissionGranted(context, Manifest.permission.RECEIVE_SMS)) {
            Log.i(TAG, "Device booted, starting sticky notification service")
            TextbeeUtils.startStickyNotificationService(context)
        }

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""

        if (deviceId.isNotEmpty() && apiKey.isNotEmpty()) {
            updateDeviceInfo(context, deviceId, apiKey)

            val deviceEnabled = SharedPreferenceHelper.getSharedPreferenceBoolean(
                context, AppConstants.SHARED_PREFS_GATEWAY_ENABLED_KEY, false
            )
            if (deviceEnabled) {
                Log.i(TAG, "Device booted, scheduling heartbeat")
                HeartbeatManager.scheduleHeartbeat(context)
            }
        }
    }

    private fun updateDeviceInfo(context: Context, deviceId: String, apiKey: String) {
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.e(TAG, "Failed to obtain FCM token after boot")
                return@addOnCompleteListener
            }

            val token = task.result ?: run {
                Log.e(TAG, "FCM token null after boot")
                return@addOnCompleteListener
            }
            val input = RegisterDeviceInputDTO().apply {
                fcmToken = token
                appVersionCode = BuildConfig.VERSION_CODE
                appVersionName = BuildConfig.VERSION_NAME
            }

            Log.d(TAG, "Updating device info after boot - deviceId: $deviceId")

            ApiManager.getApiService()
                .updateDevice(deviceId, apiKey, input)
                .enqueue(object : Callback<RegisterDeviceResponseDTO> {
                    override fun onResponse(
                        call: Call<RegisterDeviceResponseDTO>,
                        response: Response<RegisterDeviceResponseDTO>
                    ) {
                        if (response.isSuccessful) {
                            Log.d(TAG, "Device info updated successfully after boot")
                            val data = response.body()?.data ?: return
                            val intervalObj = data["heartbeatIntervalMinutes"] as? Number ?: return
                            SharedPreferenceHelper.setSharedPreferenceInt(
                                context,
                                AppConstants.SHARED_PREFS_HEARTBEAT_INTERVAL_MINUTES_KEY,
                                intervalObj.toInt()
                            )
                            Log.d(TAG, "Synced heartbeat interval from server: ${intervalObj.toInt()} minutes")
                        } else {
                            Log.e(TAG, "Failed to update device info after boot. Response code: ${response.code()}")
                        }
                    }

                    override fun onFailure(call: Call<RegisterDeviceResponseDTO>, t: Throwable) {
                        Log.e(TAG, "Error updating device info after boot: ${t.message}")
                    }
                })
        }
    }
}
