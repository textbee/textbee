package com.vernu.sms.helpers

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import androidx.work.WorkManager
import com.vernu.sms.ApiManager
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.workers.SMSReceivedWorker
import com.vernu.sms.workers.SMSStatusUpdateWorker
import com.vernu.sms.workers.WorkerRetryPolicy
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

enum class UploadKind { STATUS, RECEIVED }

/** One status report or received SMS on its way to the server. */
class Upload(
    val kind: UploadKind,
    val workName: String,
    val deviceId: String,
    val apiKey: String,
    val sms: SMSDTO,
)

interface UploadJobQueue {
    /** Queues the worker for this upload and returns its request ID. */
    fun enqueue(upload: Upload, startDelayMs: Long, directTried: Boolean): UUID
    fun cancel(id: UUID)
}

fun interface UploadTransport {
    /** Returns the HTTP status code. Throws on a network error or timeout. */
    fun send(upload: Upload): Int
}

fun interface UploadClock {
    fun nowMs(): Long
}

fun interface NetworkCheck {
    fun hasValidatedInternet(): Boolean
}

fun interface UploadEvents {
    fun log(event: String, detail: String, smsId: String?)
}

// Uploads once directly and keeps a delayed WorkManager job as the retry.
// The job is queued first, so a killed process or a failed call still ends
// in an upload.
class DirectUploader(
    private val jobs: UploadJobQueue,
    private val transport: UploadTransport,
    private val clock: UploadClock,
    private val network: NetworkCheck,
    private val pool: Executor,
    private val enabled: () -> Boolean,
    private val events: UploadEvents,
) {
    companion object {
        const val KEY_DIRECT_TRIED = "direct_tried"
        const val DEDUPE_WINDOW_MS = 10 * 60 * 1000L
        const val JOB_START_DELAY_MS = 30_000L
        const val MAX_START_LAG_MS = 15_000L
        const val DIRECT_REPORT_ATTEMPT = 1
        private const val PRUNE_ABOVE = 100

        /** The direct call is attempt 1, so a worker after it starts at 2. */
        fun workerReportAttempt(runAttemptCount: Int, directTried: Boolean): Int =
            runAttemptCount + if (directTried) 2 else 1

        /** True when the queued job would only repeat this result. */
        fun cancelsJob(code: Int): Boolean =
            code in 200..299 || !WorkerRetryPolicy.shouldRetry(code, 0)
    }

    private val recentNames = HashMap<String, Long>()

    fun upload(upload: Upload) {
        if (upload.deviceId.isEmpty() || upload.apiKey.isEmpty()) return
        if (!enabled()) {
            jobs.enqueue(upload, 0, false)
            return
        }
        val queuedAt = clock.nowMs()
        if (!markNew(upload.workName, queuedAt)) return
        val jobId = jobs.enqueue(upload, JOB_START_DELAY_MS, true)
        if (!network.hasValidatedInternet()) return
        if (upload.kind == UploadKind.STATUS) upload.sms.reportAttempt = DIRECT_REPORT_ATTEMPT
        try {
            pool.execute { attempt(upload, jobId, queuedAt) }
        } catch (e: RejectedExecutionException) {
            // Pool is full. The queued job uploads.
        }
    }

    // A multipart message reports the same status once per part
    private fun markNew(name: String, now: Long): Boolean {
        synchronized(recentNames) {
            val last = recentNames[name]
            if (last != null && now - last in 0 until DEDUPE_WINDOW_MS) return false
            if (recentNames.size > PRUNE_ABOVE) {
                recentNames.values.removeAll { now - it !in 0 until DEDUPE_WINDOW_MS }
            }
            recentNames[name] = now
            return true
        }
    }

    private fun attempt(upload: Upload, jobId: UUID, queuedAt: Long) {
        if (clock.nowMs() - queuedAt > MAX_START_LAG_MS) return
        val code = try {
            transport.send(upload)
        } catch (e: Exception) {
            return
        }
        if (cancelsJob(code)) jobs.cancel(jobId)
        when {
            code in 200..299 -> logUploaded(upload)
            cancelsJob(code) -> logRejected(upload, code)
        }
    }

    private fun logUploaded(upload: Upload) = when (upload.kind) {
        UploadKind.STATUS ->
            events.log("status_uploaded", "${upload.sms.status}, direct", upload.sms.smsId)
        UploadKind.RECEIVED ->
            events.log("sms_forwarded", "from ${upload.sms.sender}, direct", null)
    }

    private fun logRejected(upload: Upload, code: Int) = when (upload.kind) {
        UploadKind.STATUS ->
            events.log("status_upload_failed", "http $code, direct", upload.sms.smsId)
        UploadKind.RECEIVED ->
            events.log("sms_forward_failed", "http $code, direct", null)
    }
}

// Android wiring for DirectUploader. Every part here only forwards calls.
object DirectUpload {
    private const val POOL_THREADS = 2
    private const val POOL_QUEUE = 50

    @Volatile
    private var uploader: DirectUploader? = null

    fun status(context: Context, deviceId: String, apiKey: String, smsDTO: SMSDTO) {
        val name = SMSStatusUpdateWorker.workName(smsDTO)
        get(context).upload(Upload(UploadKind.STATUS, name, deviceId, apiKey, smsDTO))
    }

    fun received(context: Context, deviceId: String, apiKey: String, smsDTO: SMSDTO) {
        val name = SMSReceivedWorker.workName(smsDTO)
        get(context).upload(Upload(UploadKind.RECEIVED, name, deviceId, apiKey, smsDTO))
    }

    private fun get(context: Context): DirectUploader =
        uploader ?: synchronized(this) {
            uploader ?: create(context.applicationContext).also { uploader = it }
        }

    private fun create(appContext: Context): DirectUploader = DirectUploader(
        jobs = WorkJobQueue(appContext),
        transport = ApiTransport,
        clock = UploadClock { System.currentTimeMillis() },
        network = AndroidNetworkCheck(appContext),
        pool = ThreadPoolExecutor(
            POOL_THREADS, POOL_THREADS, 30L, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(POOL_QUEUE)
        ).apply { allowCoreThreadTimeOut(true) },
        enabled = { DeviceConfig.directUploadEnabled(appContext) },
        events = UploadEvents { event, detail, smsId -> DeviceLog.log(appContext, event, detail, smsId) },
    )

    private class WorkJobQueue(private val context: Context) : UploadJobQueue {
        override fun enqueue(upload: Upload, startDelayMs: Long, directTried: Boolean): UUID =
            when (upload.kind) {
                UploadKind.STATUS -> SMSStatusUpdateWorker.enqueueWork(
                    context, upload.deviceId, upload.apiKey, upload.sms,
                    upload.workName, startDelayMs, directTried
                )
                UploadKind.RECEIVED -> SMSReceivedWorker.enqueueWork(
                    context, upload.deviceId, upload.apiKey, upload.sms,
                    upload.workName, startDelayMs, directTried
                )
            }

        override fun cancel(id: UUID) {
            WorkManager.getInstance(context).cancelWorkById(id)
        }
    }

    private object ApiTransport : UploadTransport {
        override fun send(upload: Upload): Int {
            val api = ApiManager.getDirectApiService()
            val call = when (upload.kind) {
                UploadKind.STATUS -> api.updateSMSStatus(upload.deviceId, upload.apiKey, upload.sms)
                UploadKind.RECEIVED -> api.sendReceivedSMS(upload.deviceId, upload.apiKey, upload.sms)
            }
            return call.execute().code()
        }
    }

    private class AndroidNetworkCheck(private val context: Context) : NetworkCheck {
        override fun hasValidatedInternet(): Boolean {
            return try {
                val cm: ConnectivityManager = context.getSystemService(ConnectivityManager::class.java)
                    ?: return false
                val network = cm.activeNetwork ?: return false
                val caps = cm.getNetworkCapabilities(network) ?: return false
                caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            } catch (e: SecurityException) {
                // The check is only a shortcut. Try the call; the queued job covers a failure.
                true
            }
        }
    }
}
