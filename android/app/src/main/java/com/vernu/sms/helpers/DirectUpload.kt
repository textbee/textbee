package com.vernu.sms.helpers

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import android.util.Log
import androidx.work.WorkManager
import com.vernu.sms.ApiManager
import com.vernu.sms.dtos.SMSDTO
import com.vernu.sms.workers.SMSReceivedWorker
import com.vernu.sms.workers.SMSStatusUpdateWorker
import com.vernu.sms.workers.WorkerRetryPolicy
import java.io.IOException
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
    // Status only: the job name holds the part
    val partReports: Boolean = false,
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

/** Monotonic time in milliseconds, unaffected by changes to the wall clock. */
fun interface UploadClock {
    fun nowMs(): Long
}

fun interface NetworkCheck {
    fun hasValidatedInternet(): Boolean
}

fun interface UploadEvents {
    fun log(event: String, detail: String, smsId: String?)
}

// One direct upload plus a delayed retry job queued first; an upload that cannot be queued goes once directly
class DirectUploader(
    private val jobs: UploadJobQueue,
    private val transport: UploadTransport,
    private val clock: UploadClock,
    private val network: NetworkCheck,
    private val pool: Executor,
    private val enabled: () -> Boolean,
    private val events: UploadEvents,
    private val onError: (Throwable) -> Unit,
    private val retryDelayMs: () -> Long = { DeviceConfig.DIRECT_UPLOAD_RETRY_DELAY_SECONDS.default * 1000L },
    // Runs an unqueued direct call when the pool is full; past its queue the call is dropped and logged
    private val spare: Executor = ThreadPoolExecutor(
        1, 1, 30L, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(SPARE_QUEUE)
    ).apply { allowCoreThreadTimeOut(true) },
) {
    companion object {
        const val KEY_DIRECT_TRIED = "direct_tried"
        const val DEDUPE_WINDOW_MS = 10 * 60 * 1000L
        const val MAX_START_LAG_MS = 15_000L
        const val DIRECT_REPORT_ATTEMPT = 1
        const val SPARE_QUEUE = 50

        /** The direct call is attempt 1, so a worker after it starts at 2. */
        fun workerReportAttempt(runAttemptCount: Int, directTried: Boolean): Int =
            runAttemptCount + if (directTried) 2 else 1

        /** True when the queued job would only repeat this result. */
        fun cancelsJob(code: Int): Boolean =
            code in 200..299 || !WorkerRetryPolicy.shouldRetry(code, 0)
    }

    // Insertion order is time order, so expired names sit at the head
    private val recentNames = LinkedHashMap<String, Long>()

    fun upload(upload: Upload) {
        if (upload.deviceId.isEmpty() || upload.apiKey.isEmpty()) return
        if (!enabled()) {
            if (queue(upload, 0, false) == null) start(upload, null, clock.nowMs())
            return
        }
        val queuedAt = clock.nowMs()
        if (usesNameMap(upload) && !markNew(upload.workName)) return
        if (!network.hasValidatedInternet()) {
            if (queue(upload, 0, false) == null) start(upload, null, queuedAt)
            return
        }
        // If the pool is full or the task starts late, no direct call is made
        // and the worker's attempt number reads one high.
        start(upload, queue(upload, retryDelayMs(), true), queuedAt)
    }

    // Null when the job could not be queued, for example an input over WorkManager's size limit
    private fun queue(upload: Upload, startDelayMs: Long, directTried: Boolean): UUID? = try {
        jobs.enqueue(upload, startDelayMs, directTried)
    } catch (e: Exception) {
        onError(e)
        logSafely(queueFailedEvent(upload.kind), "${e.javaClass.simpleName}, one direct upload only", upload.sms.smsId)
        null
    }

    // Without a queued job the direct call is the only upload
    private fun start(upload: Upload, jobId: UUID?, queuedAt: Long) {
        if (upload.kind == UploadKind.STATUS) upload.sms.reportAttempt = DIRECT_REPORT_ATTEMPT
        try {
            pool.execute { attempt(upload, jobId, queuedAt) }
        } catch (e: RejectedExecutionException) {
            // Pool is full. A queued job uploads; without one the spare executor runs the call.
            if (jobId != null) return
            try {
                spare.execute { attempt(upload, null, queuedAt) }
            } catch (t: Throwable) {
                onError(t)
                logSafely(failedEvent(upload.kind), "not queued, not sent", upload.sms.smsId)
            }
        }
    }

    internal fun trackedNameCount(): Int = synchronized(recentNames) { recentNames.size }

    // Without the part in the name, failures always go through
    private fun usesNameMap(upload: Upload): Boolean =
        upload.kind == UploadKind.RECEIVED ||
            upload.sms.status == "SENT" || upload.sms.status == "DELIVERED" ||
            (upload.partReports && upload.sms.status == "FAILED")

    private fun markNew(name: String): Boolean {
        synchronized(recentNames) {
            // Read inside the lock so inserts stay in time order
            val now = clock.nowMs()
            dropExpired(now)
            if (recentNames.containsKey(name)) return false
            recentNames[name] = now
            return true
        }
    }

    private fun dropExpired(now: Long) {
        val entries = recentNames.entries.iterator()
        while (entries.hasNext()) {
            if (now - entries.next().value < DEDUPE_WINDOW_MS) return
            entries.remove()
        }
    }

    private fun attempt(upload: Upload, jobId: UUID?, queuedAt: Long) {
        try {
            // A late start is skipped only when a queued job uploads instead
            if (jobId != null && clock.nowMs() - queuedAt > MAX_START_LAG_MS) return
            val code = try {
                transport.send(upload)
            } catch (e: IOException) {
                if (jobId == null) events.log(failedEvent(upload.kind), "network, not queued", upload.sms.smsId)
                else logNetworkRetry(upload)
                return
            }
            when {
                code in 200..299 -> logUploaded(upload)
                cancelsJob(code) -> logRejected(upload, code)
                jobId == null -> events.log(failedEvent(upload.kind), "http $code, not queued", upload.sms.smsId)
            }
            // Logged first, so a failure while logging leaves the job in place
            if (jobId != null && cancelsJob(code)) jobs.cancel(jobId)
        } catch (e: Throwable) {
            // The queued job uploads, if there is one
            onError(e)
        }
    }

    private fun logSafely(event: String, detail: String, smsId: String?) {
        try {
            events.log(event, detail, smsId)
        } catch (e: Throwable) {
            onError(e)
        }
    }

    private fun queueFailedEvent(kind: UploadKind) = when (kind) {
        UploadKind.STATUS -> "status_upload_not_queued"
        UploadKind.RECEIVED -> "sms_forward_not_queued"
    }

    private fun failedEvent(kind: UploadKind) = when (kind) {
        UploadKind.STATUS -> "status_upload_failed"
        UploadKind.RECEIVED -> "sms_forward_failed"
    }

    private fun logNetworkRetry(upload: Upload) = when (upload.kind) {
        UploadKind.STATUS ->
            events.log("status_upload_direct_retry", "network", upload.sms.smsId)
        UploadKind.RECEIVED ->
            events.log("sms_forward_direct_retry", "network", null)
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
    private const val TAG = "DirectUpload"
    private const val POOL_THREADS = 2
    private const val POOL_QUEUE = 50

    @Volatile
    private var uploader: DirectUploader? = null

    fun status(context: Context, deviceId: String, apiKey: String, smsDTO: SMSDTO) {
        get(context).upload(statusUpload(deviceId, apiKey, smsDTO, DeviceConfig.partReportsEnabled(context)))
    }

    // One mode read sets the job name, the dedupe and the report field
    fun statusUpload(deviceId: String, apiKey: String, smsDTO: SMSDTO, partReports: Boolean): Upload {
        smsDTO.perPartUpload = if (partReports) true else null
        val name = SMSStatusUpdateWorker.workName(smsDTO, partReports)
        return Upload(UploadKind.STATUS, name, deviceId, apiKey, smsDTO, partReports)
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
        transport = ApiTransport(appContext),
        clock = UploadClock { SystemClock.elapsedRealtime() },
        network = AndroidNetworkCheck(appContext),
        pool = ThreadPoolExecutor(
            POOL_THREADS, POOL_THREADS, 30L, TimeUnit.SECONDS, ArrayBlockingQueue<Runnable>(POOL_QUEUE)
        ).apply { allowCoreThreadTimeOut(true) },
        enabled = { DeviceConfig.directUploadEnabled(appContext) },
        events = UploadEvents { event, detail, smsId -> DeviceLog.log(appContext, event, detail, smsId) },
        onError = { Log.w(TAG, "Direct upload task failed, the queued job will upload", it) },
        retryDelayMs = { DeviceConfig.directUploadRetryDelaySeconds(appContext) * 1000L },
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

    private class ApiTransport(private val context: Context) : UploadTransport {
        override fun send(upload: Upload): Int {
            val api = ApiManager.getDirectApiService()
            val call = when (upload.kind) {
                UploadKind.STATUS -> api.updateSMSStatus(upload.deviceId, upload.apiKey, upload.sms)
                UploadKind.RECEIVED -> api.sendReceivedSMS(upload.deviceId, upload.apiKey, upload.sms)
            }
            val code = call.execute().code()
            ApiKeyStatus.record(context, code, upload.apiKey)
            return code
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
