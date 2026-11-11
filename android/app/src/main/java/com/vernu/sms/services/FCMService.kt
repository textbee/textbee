package com.vernu.sms.services

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.google.gson.Gson
import com.vernu.sms.ApiManager
import com.vernu.sms.AppConstants
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.dtos.RegisterDeviceInputDTO
import com.vernu.sms.dtos.RegisterDeviceResponseDTO
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.HeartbeatHelper
import com.vernu.sms.helpers.HeartbeatManager
import com.vernu.sms.helpers.InstallId
import com.vernu.sms.helpers.PullClient
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.models.SMSPayload
import com.vernu.sms.workers.SmsSendWorker
import retrofit2.Call
import retrofit2.Callback
import retrofit2.Response

class FCMService : FirebaseMessagingService() {
    companion object {
        private const val TAG = "FirebaseMessagingService"
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        Log.d(TAG, remoteMessage.data.toString())
        val pushReceivedAt = System.currentTimeMillis()

        try {
            val messageType = remoteMessage.data["type"]
            if (messageType == "heartbeat_check") {
                DeviceLog.log(this, "push_received", "heartbeat check")
                handleHeartbeatCheck()
                return
            }

            // A doorbell carries no message; the phone asks the server for work
            if (messageType == "poll" && remoteMessage.data["smsData"].isNullOrEmpty()) {
                DeviceLog.log(this, "push_received", "poll")
                PullClient.claimNow(this, "fcm_doorbell")
                return
            }

            val smsPayload = Gson().fromJson(remoteMessage.data["smsData"], SMSPayload::class.java)

            if (remoteMessage.data.isNotEmpty()) {
                sendSMS(smsPayload, pushReceivedAt)
            }
        } catch (e: Exception) {
            TextbeeUtils.logException(e, "Error processing FCM message")
        }
    }

    private fun handleHeartbeatCheck() {
        Log.d(TAG, "Received heartbeat check request from backend")

        if (!HeartbeatHelper.isDeviceEligibleForHeartbeat(this)) {
            Log.d(TAG, "Device not eligible for heartbeat, skipping heartbeat check")
            return
        }

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            this, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            this, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""

        val success = HeartbeatHelper.sendHeartbeat(this, deviceId, apiKey)
        if (success) {
            Log.d(TAG, "Heartbeat sent successfully in response to backend check")
        } else {
            Log.e(TAG, "Failed to send heartbeat in response to backend check")
        }
        HeartbeatManager.scheduleHeartbeat(this)
    }

    private fun sendSMS(smsPayload: SMSPayload?, pushReceivedAt: Long) {
        if (smsPayload == null) {
            Log.e(TAG, "SMS payload is null")
            return
        }

        val recipients = smsPayload.recipients
        if (recipients == null || recipients.isEmpty()) {
            Log.e(TAG, "No recipients found in SMS payload")
            return
        }
        if (smsPayload.smsId.isNullOrEmpty() || smsPayload.message == null) {
            Log.e(TAG, "SMS payload is missing its id or message")
            DeviceLog.log(this, "push_invalid", "missing id or message")
            return
        }
        DeviceLog.log(this, "push_received", "${recipients.size} recipient(s)", smsPayload.smsId)
        SharedPreferenceHelper.setSharedPreferenceLong(
            this, AppConstants.SHARED_PREFS_LAST_PUSH_RECEIVED_AT_MS_KEY, pushReceivedAt
        )

        for (recipient in recipients) {
            SmsSendWorker.enqueue(
                this, recipient, smsPayload.message ?: "",
                smsPayload.smsId, smsPayload.smsBatchId, smsPayload.simSubscriptionId,
                smsPayload.simSlotIndex, pushReceivedAt
            )
        }

        Log.d(TAG, "Enqueued ${recipients.size} SMS for sending - Batch: ${smsPayload.smsBatchId}")
    }

    override fun onNewToken(token: String) {
        DeviceLog.log(this, "token_refreshed")
        sendRegistrationToServer(token)
    }

    private fun sendRegistrationToServer(token: String) {
        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            this, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            this, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""

        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.d(TAG, "Device ID or API key not available, skipping FCM token update")
            return
        }

        val updateInput = RegisterDeviceInputDTO().apply {
            fcmToken = token
            installId = InstallId.get(this@FCMService)
        }
        Log.d(TAG, "Updating FCM token for device: $deviceId")

        ApiManager.getApiService()
            .updateDevice(deviceId, apiKey, updateInput)
            .enqueue(object : Callback<RegisterDeviceResponseDTO> {
                override fun onResponse(
                    call: Call<RegisterDeviceResponseDTO>,
                    response: Response<RegisterDeviceResponseDTO>
                ) {
                    if (response.isSuccessful) {
                        Log.d(TAG, "FCM token updated successfully")
                    } else {
                        Log.e(TAG, "Failed to update FCM token. Response code: ${response.code()}")
                    }
                }

                override fun onFailure(call: Call<RegisterDeviceResponseDTO>, t: Throwable) {
                    Log.e(TAG, "Error updating FCM token: ${t.message}")
                }
            })
    }
}
