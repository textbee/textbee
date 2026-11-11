package com.vernu.sms.workers

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.concurrent.futures.CallbackToFutureAdapter
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.google.common.util.concurrent.ListenableFuture
import com.vernu.sms.AppConstants
import com.vernu.sms.R
import com.vernu.sms.TextbeeUtils
import com.vernu.sms.database.SendMarkerStore
import com.vernu.sms.database.SmsDedupeStore
import com.vernu.sms.dtos.SimUsedDTO
import com.vernu.sms.helpers.DeviceLog
import com.vernu.sms.helpers.DeviceConfig
import com.vernu.sms.helpers.DuplicateSkip
import com.vernu.sms.helpers.PullClient
import com.vernu.sms.helpers.SMSHelper
import com.vernu.sms.helpers.SendSlotScheduler
import com.vernu.sms.helpers.SendTiming
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimLookup
import com.vernu.sms.helpers.SimReport
import java.util.concurrent.TimeUnit

class SmsSendWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "SmsSendWorker"
        private const val QUEUE_NAME = "sms_send_queue"
        private const val FOREGROUND_CHANNEL_ID = "sms_sending"
        private const val FOREGROUND_NOTIFICATION_ID = 7391
        // Longest a batched job waits in place to keep the gap before sending;
        // a longer wait means the job comes back later instead of sending early
        private const val MAX_EXECUTION_WAIT_MS = 120_000L

        // Admission, slot reservation and enqueue happen as one step, so two
        // pushes for the same message cannot both take a slot
        private val enqueueLock = Any()

        const val KEY_PHONE = "phone"
        const val KEY_MESSAGE = "message"
        const val KEY_SMS_ID = "sms_id"
        const val KEY_SMS_BATCH_ID = "sms_batch_id"
        const val KEY_SIM_SUBSCRIPTION_ID = "sim_subscription_id"
        const val KEY_PUSH_RECEIVED_AT = "push_received_at"
        const val KEY_LEGACY_QUEUE = "legacy_queue"

        @JvmOverloads
        fun enqueue(
            context: Context, phone: String, message: String,
            smsId: String?, smsBatchId: String?, simSubscriptionId: Int?,
            pushReceivedAtMillis: Long = 0
        ) {
            if (smsId != null) {
                val store = SmsDedupeStore.get(context)
                if (alreadyHandled(context, store, smsId, phone)) {
                    Log.d(TAG, "SMS already sent, skipping - ID: $smsId")
                    DuplicateSkip.report(context, smsId, phone, smsBatchId)
                    return
                }
                store.markSeen(smsId, phone)
            }

            val legacy = !DeviceConfig.sendSchedulerV2Enabled(context)
            val inputData = Data.Builder()
                .putString(KEY_PHONE, phone)
                .putString(KEY_MESSAGE, message)
                .putString(KEY_SMS_ID, smsId)
                .putString(KEY_SMS_BATCH_ID, smsBatchId)
                .putInt(KEY_SIM_SUBSCRIPTION_ID, simSubscriptionId ?: -1)
                .putLong(KEY_PUSH_RECEIVED_AT, pushReceivedAtMillis)
                .putBoolean(KEY_LEGACY_QUEUE, legacy)
                .build()

            if (legacy) {
                enqueueLegacy(context, inputData)
            } else {
                enqueuePaced(context, inputData, smsId, phone)
            }
            Log.d(TAG, "SMS enqueued for sending - ID: $smsId, Phone: $phone, legacy: $legacy")
        }

        // One job per message. The scheduler spaces them with initial delays,
        // and a job due now runs expedited so it is not held back by battery saving.
        private fun enqueuePaced(context: Context, inputData: Data, smsId: String?, phone: String) = synchronized(enqueueLock) {
            val uniqueName = "sms_send_${smsId}_${phone.hashCode()}"
            // A duplicate push must not reserve a slot that KEEP will then discard
            if (isQueued(context, uniqueName)) {
                Log.d(TAG, "SMS already queued, skipping - ID: $smsId")
                return@synchronized
            }

            val gapMs = configuredDelaySeconds(context) * 1000L
            val initialDelayMs = SendSlotScheduler.reserve(context, gapMs)

            val builder = OneTimeWorkRequest.Builder(SmsSendWorker::class.java)
                .setInputData(inputData)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
            if (initialDelayMs > 0) {
                builder.setInitialDelay(initialDelayMs, TimeUnit.MILLISECONDS)
            } else {
                builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            }
            DeviceLog.log(context, "send_queued", "to $phone, starts in ${initialDelayMs / 1000}s", smsId)

            WorkManager.getInstance(context).enqueueUniqueWork(
                uniqueName,
                ExistingWorkPolicy.KEEP,
                builder.build()
            )
        }

        // True when either store knows the message. A marker in any state
        // counts: a missed message is accepted over a duplicate.
        private fun alreadyHandled(context: Context, store: SmsDedupeStore, smsId: String, phone: String): Boolean =
            SendMarkerStore.get(context).exists(smsId, phone) || store.wasSent(smsId, phone)

        private fun isQueued(context: Context, uniqueName: String): Boolean = try {
            WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueName).get()
                .any { !it.state.isFinished }
        } catch (e: Exception) {
            false
        }

        // The path every release before 2.9.0 used: a single chain that sleeps
        // between sends. Kept so the server can switch the new path off.
        private fun enqueueLegacy(context: Context, inputData: Data) {
            val workRequest = OneTimeWorkRequest.Builder(SmsSendWorker::class.java)
                .setInputData(inputData)
                .build()
            WorkManager.getInstance(context)
                .beginUniqueWork(QUEUE_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, workRequest)
                .enqueue()
        }

        private fun configuredDelaySeconds(context: Context): Int =
            SharedPreferenceHelper.getSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
                AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
            ).coerceIn(0, 3600)
    }

    override fun doWork(): Result {
        val result = send()
        // Refills the queue when the server has more; does nothing otherwise
        PullClient.claimNow(applicationContext, PullClient.DRAIN)
        return result
    }

    private fun send(): Result {
        val phone = inputData.getString(KEY_PHONE)
        val message = inputData.getString(KEY_MESSAGE)
        val smsId = inputData.getString(KEY_SMS_ID)
        val smsBatchId = inputData.getString(KEY_SMS_BATCH_ID)
        val simSubscriptionId = inputData.getInt(KEY_SIM_SUBSCRIPTION_ID, -1)
        val pushReceivedAt = inputData.getLong(KEY_PUSH_RECEIVED_AT, 0)
        val legacy = inputData.getBoolean(KEY_LEGACY_QUEUE, true)

        if (phone == null || message == null || smsId == null) {
            Log.e(TAG, "Missing required parameters")
            return Result.failure()
        }

        val context = applicationContext
        val store = SmsDedupeStore.get(context)
        if (alreadyHandled(context, store, smsId, phone)) {
            Log.d(TAG, "SMS already sent, skipping - ID: $smsId")
            DuplicateSkip.report(context, smsId, phone, smsBatchId)
            return Result.success()
        }

        val (resolvedSim, simSelection) = resolveSim(context, simSubscriptionId)
        val simReport = describeSim(context, resolvedSim, simSelection)

        // Jobs due at different times can still run together after the phone
        // wakes, so the gap is enforced once more right before the radio call
        if (!legacy) {
            val gapMs = configuredDelaySeconds(context) * 1000L
            val wait = SendSlotScheduler.reserveIfWithin(
                context, gapMs, SendSlotScheduler.EXECUTION, MAX_EXECUTION_WAIT_MS
            )
            if (wait == null) {
                Log.d(TAG, "Send gap not reached yet, coming back later - ID: $smsId")
                return Result.retry()
            }
            if (wait > 0) {
                try {
                    Thread.sleep(wait)
                } catch (e: InterruptedException) {
                    // A cancelled job must not reach the radio
                    Thread.currentThread().interrupt()
                    return Result.retry()
                }
            }
        }

        // Stamped here, so the gap to sentAt is radio time and the gap from
        // pushReceivedAt is time this message waited in the worker queue
        val timing = SendTiming(pushReceivedAt, System.currentTimeMillis())

        DeviceLog.log(context, "send_attempted", "to $phone" + (resolvedSim?.let { ", sim $it" } ?: ""), smsId)
        val sent = if (resolvedSim != null) {
            SMSHelper.sendSMSFromSpecificSim(phone, message, resolvedSim, smsId, smsBatchId ?: "", context, timing, simReport)
        } else {
            SMSHelper.sendSMS(phone, message, smsId, smsBatchId ?: "", context, timing, simReport)
        }
        if (sent) store.markSent(smsId, phone) else DeviceLog.log(context, "send_failed", "radio call refused", smsId)

        if (legacy) {
            val delaySeconds = configuredDelaySeconds(context)
            if (delaySeconds > 0) {
                try {
                    Thread.sleep(delaySeconds * 1000L)
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                }
            }
            // A failure here would cancel every message behind it in the chain
            return Result.success()
        }

        return if (sent) Result.success() else Result.failure()
    }

    // Shown only on Android 11 and below, where expedited work runs as a
    // foreground service. Android 12 and up runs it without a notification.
    override fun getForegroundInfoAsync(): ListenableFuture<ForegroundInfo> =
        CallbackToFutureAdapter.getFuture { completer ->
            completer.set(buildForegroundInfo())
            "SmsSendWorker.foregroundInfo"
        }

    private fun buildForegroundInfo(): ForegroundInfo {
        val manager = applicationContext.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    FOREGROUND_CHANNEL_ID, "Sending messages", NotificationManager.IMPORTANCE_LOW
                )
            )
        }
        val notification = NotificationCompat.Builder(applicationContext, FOREGROUND_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Sending SMS")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        return ForegroundInfo(FOREGROUND_NOTIFICATION_ID, notification)
    }

    // The subscription to send from (null for the system default) and why
    private fun resolveSim(context: Context, backendSimId: Int): Pair<Int?, String> {
        val requested = if (backendSimId == -1) null else backendSimId
        val requestedValid = requested != null && TextbeeUtils.isValidSubscriptionId(context, requested)
        if (requested != null && requestedValid) {
            Log.d(TAG, "Using backend-provided SIM subscription ID: $requested")
            return requested to SimReport.selectionFor(requested, true, false)
        }

        val preferredSim = SharedPreferenceHelper.getSharedPreferenceInt(
            context, AppConstants.SHARED_PREFS_PREFERRED_SIM_KEY, -1
        )
        val preferredValid = preferredSim != -1 && TextbeeUtils.isValidSubscriptionId(context, preferredSim)
        val selection = SimReport.selectionFor(requested, false, preferredValid)
        if (preferredValid) {
            Log.d(TAG, "Using app-preferred SIM subscription ID: $preferredSim")
            return preferredSim to selection
        }

        return null to selection
    }

    // Never fails the send. An unreadable SIM goes out as an empty simUsed,
    // so the server drops whatever an earlier attempt stored.
    private fun describeSim(context: Context, resolvedSim: Int?, selection: String): SimReport = try {
        val subscriptionId = resolvedSim ?: SimLookup.defaultSmsSubscriptionId()
        SimReport(SimLookup.describe(context, subscriptionId) ?: SimUsedDTO(), selection)
    } catch (e: Exception) {
        Log.w(TAG, "Could not describe the sending SIM: ${e.message}")
        SimReport(SimUsedDTO(), selection)
    }
}
