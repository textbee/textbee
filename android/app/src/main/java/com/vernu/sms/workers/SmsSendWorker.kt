package com.vernu.sms.workers

import android.Manifest
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
import com.vernu.sms.helpers.DuplicateSkip
import com.vernu.sms.helpers.PullClient
import com.vernu.sms.helpers.PreferredSim
import com.vernu.sms.helpers.RegistrationChecks
import com.vernu.sms.helpers.SMSHelper
import com.vernu.sms.helpers.SendSlotScheduler
import com.vernu.sms.helpers.SendTiming
import com.vernu.sms.helpers.SharedPreferenceHelper
import com.vernu.sms.helpers.SimDecision
import com.vernu.sms.helpers.SimLookup
import com.vernu.sms.helpers.SimReport
import java.util.concurrent.TimeUnit

class SmsSendWorker(context: Context, workerParams: WorkerParameters) : Worker(context, workerParams) {
    companion object {
        private const val TAG = "SmsSendWorker"
        private const val FOREGROUND_CHANNEL_ID = "sms_sending"
        private const val FOREGROUND_NOTIFICATION_ID = 7391
        // Longest a batched job waits in place for the gap; a longer wait comes back later
        private const val MAX_EXECUTION_WAIT_MS = 120_000L

        // Admission, slot and enqueue are one step, so two pushes cannot both take a slot
        private val enqueueLock = Any()

        const val KEY_PHONE = "phone"
        const val KEY_MESSAGE = "message"
        const val KEY_SMS_ID = "sms_id"
        const val KEY_SMS_BATCH_ID = "sms_batch_id"
        const val KEY_SIM_SUBSCRIPTION_ID = "sim_subscription_id"
        const val KEY_SIM_SLOT_INDEX = "sim_slot_index"
        const val KEY_PUSH_RECEIVED_AT = "push_received_at"
        const val KEY_LEGACY_QUEUE = "legacy_queue"

        // What a job ends in
        enum class JobResult { SUCCESS, RETRY, FAILURE }

        // Why a job ended
        enum class Outcome { SENT, REFUSED, SIM_ERROR, DUPLICATE, MAYBE_SENT, MISSING_INPUT, NOT_REGISTERED, STOPPED, WAIT, ERROR }

        // An old chain job never fails or retries: in a chain one failure cancels every job behind it
        fun resultFor(legacy: Boolean, outcome: Outcome): JobResult = when {
            legacy -> JobResult.SUCCESS
            outcome == Outcome.SENT || outcome == Outcome.DUPLICATE || outcome == Outcome.MAYBE_SENT -> JobResult.SUCCESS
            outcome == Outcome.WAIT -> JobResult.RETRY
            else -> JobResult.FAILURE
        }

        enum class Start { SEND, DUPLICATE, MAYBE_SENT }

        // Jobs queued on the old chain before 2.10 have the flag true or absent
        fun isLegacy(input: Data): Boolean = input.getBoolean(KEY_LEGACY_QUEUE, true)

        fun startFor(input: Data, runAttemptCount: Int, known: Boolean): Start =
            start(isLegacy(input), runAttemptCount, known)

        // An old chain job runs again only when the app stopped during it, maybe after the radio call
        fun start(legacy: Boolean, runAttemptCount: Int, known: Boolean): Start = when {
            known -> Start.DUPLICATE
            legacy && runAttemptCount > 0 -> Start.MAYBE_SENT
            else -> Start.SEND
        }

        // True when a job was queued for the message
        @JvmOverloads
        fun enqueue(
            context: Context, phone: String, message: String,
            smsId: String?, smsBatchId: String?, simSubscriptionId: Int?,
            simSlotIndex: Int?, pushReceivedAtMillis: Long = 0
        ): Boolean {
            if (smsId != null && alreadyHandled(context, smsId, phone)) {
                Log.d(TAG, "SMS already sent, skipping - ID: $smsId")
                DuplicateSkip.report(context, smsId, phone, smsBatchId)
                return false
            }

            val input = sendInput(
                phone, message, smsId, smsBatchId, simSubscriptionId, simSlotIndex, pushReceivedAtMillis
            )
            return queueOrFail(
                input, smsId, phone,
                markers = { SendMarkerStore.get(context) },
                report = {
                    Log.w(TAG, "SMS too large to queue - ID: $smsId")
                    DeviceLog.log(context, "send_failed", "to $phone, ${SMSHelper.ERROR_MESSAGE_TOO_LARGE}", smsId)
                    if (smsId != null) SMSHelper.reportMessageTooLarge(context, smsId, smsBatchId ?: "", pushReceivedAtMillis)
                },
                queue = { enqueuePaced(context, it, smsId, phone) },
            )
        }

        // Queues the job, or marks a message too large to queue as failed and reports it once
        fun queueOrFail(
            input: Data?, smsId: String?, phone: String,
            markers: () -> SendMarkerStore, report: () -> Unit, queue: (Data) -> Boolean,
        ): Boolean {
            if (input != null) return queue(input)
            if (smsId != null) {
                val store = markers()
                // A repeated offer then restates the failure as a duplicate
                when (store.begin(smsId, phone)) {
                    SendMarkerStore.Begin.STARTED -> store.finish(
                        smsId, phone, SendMarkerStore.FAILED,
                        SMSHelper.ERROR_MESSAGE_TOO_LARGE, SMSHelper.MESSAGE_TOO_LARGE_TEXT
                    )
                    // Another push for this message holds the marker and reports it
                    SendMarkerStore.Begin.DUPLICATE -> return false
                    SendMarkerStore.Begin.WRITE_FAILED -> Unit
                }
            }
            report()
            return false
        }

        // Null when over WorkManager's 10,240 byte limit. A new job is always on the paced path.
        fun sendInput(
            phone: String, message: String, smsId: String?, smsBatchId: String?,
            simSubscriptionId: Int?, simSlotIndex: Int?, pushReceivedAtMillis: Long
        ): Data? = try {
            Data.Builder()
                .putString(KEY_PHONE, phone)
                .putString(KEY_MESSAGE, message)
                .putString(KEY_SMS_ID, smsId)
                .putString(KEY_SMS_BATCH_ID, smsBatchId)
                .putInt(KEY_SIM_SUBSCRIPTION_ID, simSubscriptionId ?: -1)
                .putInt(KEY_SIM_SLOT_INDEX, simSlotIndex ?: -1)
                .putLong(KEY_PUSH_RECEIVED_AT, pushReceivedAtMillis)
                .putBoolean(KEY_LEGACY_QUEUE, false)
                .build()
        } catch (e: IllegalStateException) {
            // build() throws this only for the size limit
            null
        }

        // One job per message. The scheduler spaces them with initial delays,
        // and a job due now runs expedited so it is not held back by battery saving.
        private fun enqueuePaced(context: Context, inputData: Data, smsId: String?, phone: String): Boolean = synchronized(enqueueLock) {
            val uniqueName = "sms_send_${smsId}_${phone.hashCode()}"
            // A duplicate push must not reserve a slot that KEEP will then discard
            if (isQueued(context, uniqueName)) {
                Log.d(TAG, "SMS already queued, skipping - ID: $smsId")
                return@synchronized false
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
            true
        }

        // A marker in any state counts: a missed message is accepted over a duplicate
        private fun alreadyHandled(context: Context, smsId: String, phone: String): Boolean =
            SendMarkerStore.get(context).exists(smsId, phone) ||
                SmsDedupeStore.forReading(context)?.wasSent(smsId, phone) == true

        private fun isQueued(context: Context, uniqueName: String): Boolean = try {
            WorkManager.getInstance(context).getWorkInfosForUniqueWork(uniqueName).get()
                .any { !it.state.isFinished }
        } catch (e: Exception) {
            false
        }

        // Every queued send job of every build. A running job checks isStopped before the radio call.
        fun cancelAll(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(SmsSendWorker::class.java.name)
        }

        private fun configuredDelaySeconds(context: Context): Int =
            SharedPreferenceHelper.getSharedPreferenceInt(
                context, AppConstants.SHARED_PREFS_SMS_SEND_DELAY_SECONDS_KEY,
                AppConstants.DEFAULT_SMS_SEND_DELAY_SECONDS
            ).coerceIn(0, 3600)
    }

    override fun doWork(): Result {
        val legacy = isLegacy(inputData)
        val outcome = try {
            send(legacy).also {
                // Refills the queue when the server has more; does nothing otherwise
                PullClient.claimBlocking(applicationContext, PullClient.DRAIN)
            }
        } catch (t: Throwable) {
            // A thrown failure would cancel every old chain job behind this one
            DeviceLog.log(applicationContext, "send_error", t.javaClass.simpleName, inputData.getString(KEY_SMS_ID))
            Outcome.ERROR
        }
        return when (resultFor(legacy, outcome)) {
            JobResult.SUCCESS -> Result.success()
            JobResult.RETRY -> Result.retry()
            JobResult.FAILURE -> Result.failure()
        }
    }

    private fun send(legacy: Boolean): Outcome {
        val phone = inputData.getString(KEY_PHONE)
        val message = inputData.getString(KEY_MESSAGE)
        val smsId = inputData.getString(KEY_SMS_ID)
        val smsBatchId = inputData.getString(KEY_SMS_BATCH_ID)
        val simSubscriptionId = inputData.getInt(KEY_SIM_SUBSCRIPTION_ID, -1)
        // Jobs queued before the slot release have no key and read as no slot
        val simSlotIndex = inputData.getInt(KEY_SIM_SLOT_INDEX, -1)
        val pushReceivedAt = inputData.getLong(KEY_PUSH_RECEIVED_AT, 0)

        val context = applicationContext
        if (!isRegistered(context)) {
            DeviceLog.log(context, "send_skipped", "not connected", smsId)
            return Outcome.NOT_REGISTERED
        }
        if (phone == null || message == null || smsId == null) {
            Log.e(TAG, "Missing required parameters")
            return Outcome.MISSING_INPUT
        }

        when (startFor(inputData, runAttemptCount, alreadyHandled(context, smsId, phone))) {
            Start.DUPLICATE -> {
                Log.d(TAG, "SMS already sent, skipping - ID: $smsId")
                DuplicateSkip.report(context, smsId, phone, smsBatchId)
                return Outcome.DUPLICATE
            }
            Start.MAYBE_SENT -> {
                // Reported as interrupted, then marked so a repeated offer is a duplicate
                DuplicateSkip.report(context, smsId, phone, smsBatchId)
                SendMarkerStore.get(context).begin(smsId, phone)
                return Outcome.MAYBE_SENT
            }
            Start.SEND -> Unit
        }

        val decision = resolveSim(context, simSubscriptionId, simSlotIndex)
        if (decision.errorCode != null) {
            // Nothing reaches the radio, so the send gap is not used
            failUnsent(context, decision, phone, smsId, smsBatchId ?: "", simSlotIndex, pushReceivedAt)
            return Outcome.SIM_ERROR
        }
        var resolvedSim = decision.subscriptionId
        var simReport = describeSim(context, resolvedSim, decision.selection)
        val gapMs = configuredDelaySeconds(context) * 1000L

        // Jobs due at different times can still run together after the phone
        // wakes, so the gap is enforced once more right before the radio call
        if (!legacy) {
            val wait = SendSlotScheduler.reserveIfWithin(
                context, gapMs, SendSlotScheduler.EXECUTION, MAX_EXECUTION_WAIT_MS
            )
            if (wait == null) {
                Log.d(TAG, "Send gap not reached yet, coming back later - ID: $smsId")
                return Outcome.WAIT
            }
            if (wait > 0) {
                try {
                    Thread.sleep(wait)
                } catch (e: InterruptedException) {
                    // A cancelled job must not reach the radio
                    Thread.currentThread().interrupt()
                    return Outcome.WAIT
                }
                // The SIM in the slot can change during the wait
                if (simSlotIndex >= 0) {
                    val fresh = resolveSim(context, simSubscriptionId, simSlotIndex)
                    if (fresh.errorCode != null) {
                        failUnsent(context, fresh, phone, smsId, smsBatchId ?: "", simSlotIndex, pushReceivedAt)
                        return Outcome.SIM_ERROR
                    }
                    if (fresh.subscriptionId != resolvedSim) {
                        resolvedSim = fresh.subscriptionId
                        simReport = describeSim(context, resolvedSim, fresh.selection)
                    }
                }
            }
        }

        // A disconnect or a cancel during the work above must not reach the radio
        if (isStopped || !isRegistered(context)) {
            DeviceLog.log(context, "send_skipped", "stopped before the radio call", smsId)
            return Outcome.STOPPED
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
        if (!sent) DeviceLog.log(context, "send_failed", "radio call refused", smsId)

        if (legacy) {
            // Paced jobs keep their gap after this send
            if (sent) SendSlotScheduler.reserve(context, gapMs, SendSlotScheduler.EXECUTION)
            // In 1 second steps, so a cancelled job frees its thread
            var left = gapMs
            while (left > 0 && !isStopped) {
                try {
                    Thread.sleep(minOf(left, 1_000L))
                } catch (e: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
                left -= 1_000L
            }
        }
        return if (sent) Outcome.SENT else Outcome.REFUSED
    }

    private fun isRegistered(context: Context): Boolean = RegistrationChecks.hasRegistration(
        SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_DEVICE_ID_KEY, ""),
        SharedPreferenceHelper.getSharedPreferenceString(context, AppConstants.SHARED_PREFS_API_KEY_KEY, ""),
    )

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

    // The subscription to send from (null for the system default) and why.
    // Each lookup runs only when the branches before it did not decide.
    private fun resolveSim(context: Context, backendSimId: Int, backendSlot: Int): SimDecision {
        val requestedSlot = if (backendSlot < 0) null else backendSlot
        val requestedId = if (backendSimId == -1) null else backendSimId
        val phonePermission = TextbeeUtils.isPermissionGranted(context, Manifest.permission.READ_PHONE_STATE)
        val slotSubscriptionId = if (requestedSlot != null && phonePermission) {
            SimLookup.activeSubscriptionIdForSlot(context, requestedSlot)
        } else null
        val requestedValid = requestedSlot == null && requestedId != null &&
            TextbeeUtils.isValidSubscriptionId(context, requestedId)
        val preferredId = if (requestedSlot == null && !requestedValid) PreferredSim.subscriptionId(context) else null

        val decision = SimReport.decide(
            requestedSlot, phonePermission, slotSubscriptionId, requestedId, requestedValid, preferredId
        )
        Log.d(TAG, "SIM for send: ${decision.subscriptionId ?: "default"} (${decision.selection})")
        return decision
    }

    private fun failUnsent(
        context: Context, decision: SimDecision, phone: String, smsId: String,
        smsBatchId: String, slot: Int, pushReceivedAt: Long
    ) {
        val timing = SendTiming(pushReceivedAt, System.currentTimeMillis())
        val sim = SimReport(null, decision.selection)
        if (decision.errorCode == SimReport.ERROR_SIM_SLOT_EMPTY) {
            SMSHelper.reportSimSlotEmpty(context, smsId, smsBatchId, slot, timing, sim)
        } else {
            val smsGranted = TextbeeUtils.isPermissionGranted(context, Manifest.permission.SEND_SMS)
            SMSHelper.reportPermissionError(
                context, smsId, smsBatchId, timing, sim, SMSHelper.permissionDeniedMessage(smsGranted)
            )
        }
        DeviceLog.log(context, "send_failed", "to $phone, ${decision.errorCode}", smsId)
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
