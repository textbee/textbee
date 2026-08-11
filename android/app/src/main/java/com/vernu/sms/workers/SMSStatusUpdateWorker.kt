package com.vernu.sms.workers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.google.gson.Gson
import com.vernu.sms.ApiManager
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.dtos.SMSForwardResponseDTO
import com.google.gson.JsonSyntaxException
import java.io.IOException
import java.util.concurrent.TimeUnit

class SMSStatusUpdateWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "SMSStatusUpdateWorker"
        private const val MAX_RETRIES = 5

        const val KEY_DEVICE_ID = "device_id"
        const val KEY_API_KEY = "api_key"
        const val KEY_SMS_DTO = "sms_dto"

        fun enqueueWork(context: Context, deviceId: String, apiKey: String, smsDTO: SMSDTO) {
            val inputData = Data.Builder()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_API_KEY, apiKey)
                .putString(KEY_SMS_DTO, Gson().toJson(smsDTO))
                .build()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = OneTimeWorkRequest.Builder(SMSStatusUpdateWorker::class.java)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .setInputData(inputData)
                .build()

            val uniqueWorkName = "sms_status_${smsDTO.smsId ?: System.currentTimeMillis()}_${smsDTO.status}"
            WorkManager.getInstance(context)
                .beginUniqueWork(uniqueWorkName, ExistingWorkPolicy.KEEP, workRequest)
                .enqueue()

            Log.d(TAG, "Work enqueued for SMS status update - ID: ${smsDTO.smsId}")
        }
    }

    override fun doWork(): Result {
        val deviceId = inputData.getString(KEY_DEVICE_ID)
        val apiKey = inputData.getString(KEY_API_KEY)
        val smsDtoJson = inputData.getString(KEY_SMS_DTO)

        if (deviceId == null || apiKey == null || smsDtoJson == null) {
            Log.e(TAG, "Missing required parameters")
            return Result.failure()
        }

        if (runAttemptCount >= MAX_RETRIES) {
            Log.e(TAG, "Maximum retry count reached for SMS status update")
            return Result.failure()
        }

        val smsDTO = Gson().fromJson(smsDtoJson, SMSDTO::class.java)

        return try {
            val response = ApiManager.getApiService().updateSMSStatus(deviceId, apiKey, smsDTO).execute()
            if (response.isSuccessful) {
                Log.d(TAG, "SMS status updated successfully - ID: ${smsDTO.smsId}, Status: ${smsDTO.status}")
                Result.success()
            } else {
                Log.e(TAG, "Failed to update SMS status. Response code: ${response.code()}")
                Result.retry()
            }
        } catch (e: IOException) {
            Log.e(TAG, "API call failed: ${e.message}")
            Result.retry()
        } catch (e: JsonSyntaxException) {
            Log.e(TAG, "Malformed response body: ${e.message}")
            Result.retry()
        }
    }
}
