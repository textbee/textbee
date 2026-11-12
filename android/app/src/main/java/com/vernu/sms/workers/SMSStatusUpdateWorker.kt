package com.vernu.sms.workers

import android.content.Context
import android.util.Log
import androidx.work.*
import com.vernu.sms.ApiManager
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.helpers.ApiKeyStatus
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.DirectUploader
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit

class SMSStatusUpdateWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "SMSStatusUpdateWorker"

        const val KEY_DEVICE_ID = "device_id"
        const val KEY_API_KEY = "api_key"
        const val KEY_SMS_DTO = "sms_dto"

        // Off: one upload per message and status. On: one per part, status and carrier status.
        fun workName(smsDTO: SMSDTO, partReports: Boolean): String {
            val id = smsDTO.smsId ?: System.currentTimeMillis()
            if (!partReports) return "sms_status_${id}_${smsDTO.status}"
            val part = smsDTO.partIndex?.toString() ?: "x"
            val report = smsDTO.deliveryReport
            // An unreadable report is told apart by its PDU
            val delivery = report?.status?.toString()
                ?: report?.pdu?.let { "none_%08x".format(Locale.ROOT, it.hashCode()) }
                ?: "none"
            return "sms_status_${id}_${part}_${smsDTO.status}_$delivery"
        }

        fun enqueueWork(
            context: Context,
            deviceId: String,
            apiKey: String,
            smsDTO: SMSDTO,
            uniqueWorkName: String,
            startDelayMs: Long = 0,
            directTried: Boolean = false,
        ): UUID {
            val inputBuilder = Data.Builder()
                .putString(KEY_DEVICE_ID, deviceId)
                .putString(KEY_API_KEY, apiKey)
                .putString(KEY_SMS_DTO, JobJson.toJson(smsDTO))
            if (directTried) inputBuilder.putBoolean(DirectUploader.KEY_DIRECT_TRIED, true)
            val inputData = inputBuilder.build()

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val requestBuilder = OneTimeWorkRequest.Builder(SMSStatusUpdateWorker::class.java)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .setInputData(inputData)
            if (startDelayMs > 0) requestBuilder.setInitialDelay(startDelayMs, TimeUnit.MILLISECONDS)
            val workRequest = requestBuilder.build()

            WorkManager.getInstance(context)
                .enqueueUniqueWork(uniqueWorkName, ExistingWorkPolicy.KEEP, workRequest)

            Log.d(TAG, "Work enqueued for SMS status update - ID: ${smsDTO.smsId}")
            return workRequest.id
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

        val smsDTO = JobJson.fromJson(smsDtoJson)
        smsDTO.reportAttempt = DirectUploader.workerReportAttempt(
            runAttemptCount, inputData.getBoolean(DirectUploader.KEY_DIRECT_TRIED, false)
        )

        return try {
            val response = ApiManager.getApiService().updateSMSStatus(deviceId, apiKey, smsDTO).execute()
            ApiKeyStatus.record(applicationContext, response.code(), apiKey)
            if (response.isSuccessful) {
                Log.d(TAG, "SMS status updated successfully - ID: ${smsDTO.smsId}, Status: ${smsDTO.status}")
                DeviceLog.log(applicationContext, "status_uploaded", "${smsDTO.status}, attempt ${smsDTO.reportAttempt}", smsDTO.smsId)
                Result.success()
            } else {
                Log.e(TAG, "Failed to update SMS status. Response code: ${response.code()}")
                DeviceLog.log(applicationContext, "status_upload_retry", "http ${response.code()}, attempt ${smsDTO.reportAttempt}", smsDTO.smsId)
                retryOrFail(response.code())
            }
        } catch (e: IOException) {
            Log.e(TAG, "API call failed: ${e.message}")
            DeviceLog.log(applicationContext, "status_upload_retry", "network, attempt ${smsDTO.reportAttempt}", smsDTO.smsId)
            retryOrFail(null)
        }
    }

    private fun retryOrFail(responseCode: Int?): Result {
        if (WorkerRetryPolicy.shouldRetry(responseCode, runAttemptCount)) return Result.retry()
        Log.e(TAG, "Giving up on SMS status update after ${runAttemptCount + 1} attempts")
        return Result.failure()
    }
}
