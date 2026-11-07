package com.vernu.sms.workers

import android.content.Context
import android.util.Log
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.google.gson.Gson
import com.vernu.sms.AppConstants
import com.vernu.sms.database.MultipartDeliveryTracker
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.SharedPreferenceHelper
import java.util.concurrent.TimeUnit

// Some carriers send a delivery report for only some parts of a long SMS.
// When no part report comes for SETTLE_HOURS, a message with a delivered
// part and no failed part is reported as delivered.
class DeliverySettleWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    companion object {
        private const val TAG = "DeliverySettleWorker"
        const val SETTLE_HOURS = 24L
        private const val KEY_SMS_DTO = "sms_dto"

        private fun workName(smsId: String) = "sms_delivery_settle_$smsId"

        /** Starts the wait again; each new part report pushes it back. */
        fun schedule(context: Context, smsDTO: SMSDTO) {
            val smsId = smsDTO.smsId ?: return
            val request = OneTimeWorkRequest.Builder(DeliverySettleWorker::class.java)
                .setInitialDelay(SETTLE_HOURS, TimeUnit.HOURS)
                .setInputData(Data.Builder().putString(KEY_SMS_DTO, Gson().toJson(smsDTO)).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(workName(smsId), ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context, smsId: String?) {
            if (smsId == null) return
            WorkManager.getInstance(context).cancelUniqueWork(workName(smsId))
        }
    }

    override fun doWork(): Result {
        val smsDTO = inputData.getString(KEY_SMS_DTO)?.let { Gson().fromJson(it, SMSDTO::class.java) }
        val smsId = smsDTO?.smsId ?: return Result.success()
        val deliveredAt = MultipartDeliveryTracker.get(applicationContext).settle(smsId)
            ?: return Result.success()

        smsDTO.status = "DELIVERED"
        smsDTO.deliveredAtInMillis = deliveredAt
        DeviceLog.log(applicationContext, "delivery_settled", "no report for some parts after $SETTLE_HOURS h", smsId)

        val deviceId = SharedPreferenceHelper.getSharedPreferenceString(
            applicationContext, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""
        ) ?: ""
        val apiKey = SharedPreferenceHelper.getSharedPreferenceString(
            applicationContext, AppConstants.SHARED_PREFS_API_KEY_KEY, ""
        ) ?: ""
        if (deviceId.isEmpty() || apiKey.isEmpty()) {
            Log.e(TAG, "Device ID or API key not found")
            return Result.success()
        }
        SMSStatusUpdateWorker.enqueueWork(applicationContext, deviceId, apiKey, smsDTO)
        return Result.success()
    }
}
