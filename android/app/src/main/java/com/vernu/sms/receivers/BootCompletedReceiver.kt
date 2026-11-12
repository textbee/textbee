package com.vernu.sms.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.BuildConfig
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.RegisterDeviceResponseDTO
import com.vernu.sms.helpers.InstallSource
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.Diagnostics
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.PullClient
import com.vernu.sms.helpers.PushToken
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
        Diagnostics.identify(context)

        // Checks the switch and the registration
        TextbeeUtils.startStickyNotificationService(context)

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
                PullClient.claimNow(context, "boot")
            }
        }
    }

    private fun updateDeviceInfo(context: Context, deviceId: String, apiKey: String) {
        PushToken.get(context).addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.e(TAG, "Failed to obtain FCM token after boot")
                return@addOnCompleteListener
            }

            val input = RegisterDeviceInputDTO().apply {
                fcmToken = task.result
                appVersionCode = BuildConfig.VERSION_CODE
                appVersionName = BuildConfig.VERSION_NAME
                InstallSource.applyTo(this, context)
            }

            Log.d(TAG, "Updating device info after boot - deviceId: $deviceId")

            ApiManager.getApiService()
                .updateDevice(deviceId, apiKey, input)
                .enqueue(object : Callback<RegisterDeviceResponseDTO> {
                    override fun onResponse(
                        call: Call<RegisterDeviceResponseDTO>,
                        response: Response<RegisterDeviceResponseDTO>
                    ) {
                        ApiKeyStatus.record(context, response.code(), apiKey)
                        if (response.isSuccessful) {
                            Log.d(TAG, "Device info updated successfully after boot")
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
