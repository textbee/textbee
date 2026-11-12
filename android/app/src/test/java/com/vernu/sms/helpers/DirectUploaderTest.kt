package com.vernu.sms.helpers

import com.vernu.sms.dtos.SMSDTO
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.io.InterruptedIOException
import java.util.UUID
import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

class DirectUploaderTest {
    private data class Queued(val name: String, val startDelayMs: Long, val directTried: Boolean, val id: UUID)

    private class FakeJobs : UploadJobQueue {
        val queued = mutableListOf<Queued>()
        val cancelled = mutableListOf<UUID>()
        var failCancel = false

        override fun enqueue(upload: Upload, startDelayMs: Long, directTried: Boolean): UUID {
            val id = UUID.randomUUID()
            queued += Queued(upload.workName, startDelayMs, directTried, id)
            return id
        }

        override fun cancel(id: UUID) {
            if (failCancel) throw IllegalStateException("cancel failed")
            cancelled += id
        }
    }

    private class FakeTransport(var result: () -> Int = { 200 }) : UploadTransport {
        val sent = mutableListOf<Upload>()
        val reportAttempts = mutableListOf<Int>()

        override fun send(upload: Upload): Int {
            sent += upload
            reportAttempts += upload.sms.reportAttempt
            return result()
        }
    }

    // Holds tasks until the test runs them
    private class HeldPool : Executor {
        val tasks = mutableListOf<Runnable>()
        override fun execute(command: Runnable) {
            tasks += command
        }
        fun runAll() = tasks.toList().also { tasks.clear() }.forEach { it.run() }
    }

    private val jobs = FakeJobs()
    private val transport = FakeTransport()
    private var now = 1_000_000L
    private var online = true
    private var switchOn = true
    private var failLog = false
    private val events = mutableListOf<String>()
    private val errors = mutableListOf<Throwable>()

    private fun uploader(pool: Executor = Executor { it.run() }, retryDelayMs: Long = DeviceConfig.DIRECT_UPLOAD_RETRY_DELAY_SECONDS.default * 1000L) = DirectUploader(
        jobs = jobs,
        transport = transport,
        clock = UploadClock { now },
        network = NetworkCheck { online },
        pool = pool,
        enabled = { switchOn },
        events = UploadEvents { event, detail, _ ->
            if (failLog) throw IllegalStateException("log failed")
            events += "$event: $detail"
        },
        onError = { errors += it },
        retryDelayMs = { retryDelayMs },
    )

    private fun statusUpload(
        name: String = "sms_status_m1_SENT",
        status: String = "SENT",
        deviceId: String = "device-1",
        apiKey: String = "key-1",
        partReports: Boolean = false,
    ) = Upload(
        UploadKind.STATUS, name, deviceId, apiKey,
        SMSDTO().apply { smsId = "m1"; this.status = status },
        partReports,
    )

    private fun receivedUpload() = Upload(
        UploadKind.RECEIVED, "sms_received_abc", "device-1", "key-1",
        SMSDTO().apply { sender = "+15555550100"; fingerprint = "abc" },
    )

    private fun uploadOnceWithCode(code: Int): FakeJobs {
        transport.result = { code }
        val uploader = uploader()
        jobs.queued.clear()
        jobs.cancelled.clear()
        uploader.upload(statusUpload())
        return jobs
    }

    @Test
    fun successCancelsTheQueuedJob() {
        listOf(200, 201, 204).forEach { code ->
            val jobs = uploadOnceWithCode(code)
            assertEquals("code $code", listOf(jobs.queued.single().id), jobs.cancelled)
        }
    }

    @Test
    fun queuesTheJobWithAStartDelayAndTheFlag() {
        uploader().upload(statusUpload())

        val job = jobs.queued.single()
        assertEquals("sms_status_m1_SENT", job.name)
        assertEquals(30_000L, job.startDelayMs)
        assertTrue(job.directTried)
        assertEquals(listOf("status_uploaded: SENT, direct"), events)
    }

    @Test
    fun theRetryJobUsesTheConfiguredDelay() {
        uploader(retryDelayMs = 120_000L).upload(statusUpload())
        assertEquals(120_000L, jobs.queued.single().startDelayMs)
    }

    @Test
    fun nonRetryableCodesCancelTheQueuedJob() {
        listOf(400, 401, 403, 404, 422).forEach { code ->
            val jobs = uploadOnceWithCode(code)
            assertEquals("code $code", listOf(jobs.queued.single().id), jobs.cancelled)
        }
    }

    @Test
    fun retryableCodesKeepTheQueuedJob() {
        listOf(408, 429, 500, 502, 503).forEach { code ->
            val jobs = uploadOnceWithCode(code)
            assertEquals("code $code", 1, jobs.queued.size)
            assertTrue("code $code", jobs.cancelled.isEmpty())
        }
    }

    @Test
    fun networkErrorKeepsTheQueuedJobAndIsLogged() {
        transport.result = { throw IOException("connection reset") }
        uploader().upload(statusUpload())

        assertEquals(1, transport.sent.size)
        assertEquals(1, jobs.queued.size)
        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(listOf("status_upload_direct_retry: network"), events)
        assertTrue(errors.isEmpty())
    }

    @Test
    fun networkErrorOnReceivedSmsIsLogged() {
        transport.result = { throw IOException("connection reset") }
        uploader().upload(receivedUpload())

        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(listOf("sms_forward_direct_retry: network"), events)
    }

    @Test
    fun timeoutKeepsTheQueuedJob() {
        transport.result = { throw InterruptedIOException("timeout") }
        uploader().upload(statusUpload())

        assertEquals(1, transport.sent.size)
        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(listOf("status_upload_direct_retry: network"), events)
    }

    @Test
    fun throwingCancelStaysInsideTheTaskAndLeavesTheJob() {
        jobs.failCancel = true
        uploader().upload(statusUpload())

        assertEquals(1, jobs.queued.size)
        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(1, errors.size)
    }

    @Test
    fun throwingLogStaysInsideTheTaskAndLeavesTheJob() {
        failLog = true
        uploader().upload(statusUpload())

        assertEquals(1, transport.sent.size)
        assertEquals(1, jobs.queued.size)
        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(1, errors.size)
    }

    @Test
    fun throwingTransportStaysInsideTheTaskAndLeavesTheJob() {
        transport.result = { throw IllegalStateException("bad response") }
        uploader().upload(statusUpload())

        assertTrue(jobs.cancelled.isEmpty())
        assertEquals(1, errors.size)
    }

    @Test
    fun taskThatStartsMoreThan15SecondsLateSkipsTheCall() {
        val pool = HeldPool()
        uploader(pool).upload(statusUpload())
        now += DirectUploader.MAX_START_LAG_MS + 1
        pool.runAll()

        assertTrue(transport.sent.isEmpty())
        assertEquals(1, jobs.queued.size)
        assertTrue(jobs.cancelled.isEmpty())
    }

    @Test
    fun taskThatStartsWithin15SecondsMakesTheCall() {
        val pool = HeldPool()
        uploader(pool).upload(statusUpload())
        now += DirectUploader.MAX_START_LAG_MS
        pool.runAll()

        assertEquals(1, transport.sent.size)
        assertEquals(1, jobs.cancelled.size)
    }

    // A monotonic clock reads time since boot, far from wall time
    @Test
    fun latenessIsMeasuredOnTheInjectedMonotonicClock() {
        now = 5_000L
        val pool = HeldPool()
        uploader(pool).upload(statusUpload())
        now += 1_000
        pool.runAll()

        assertEquals(1, transport.sent.size)
    }

    @Test
    fun duplicateNameWithin10MinutesDoesNothing() {
        val uploader = uploader()
        uploader.upload(statusUpload())
        now += DirectUploader.DEDUPE_WINDOW_MS - 1
        uploader.upload(statusUpload())

        assertEquals(1, jobs.queued.size)
        assertEquals(1, transport.sent.size)
    }

    @Test
    fun sameNameAfter10MinutesUploadsAgain() {
        val uploader = uploader()
        uploader.upload(statusUpload())
        now += DirectUploader.DEDUPE_WINDOW_MS
        uploader.upload(statusUpload())

        assertEquals(2, jobs.queued.size)
        assertEquals(2, transport.sent.size)
    }

    @Test
    fun differentNamesAreNotDuplicates() {
        val uploader = uploader()
        uploader.upload(statusUpload(name = "sms_status_m1_SENT"))
        uploader.upload(statusUpload(name = "sms_status_m1_DELIVERED", status = "DELIVERED"))

        assertEquals(2, jobs.queued.size)
    }

    @Test
    fun sentDeliveredAndReceivedSmsUseTheNameMap() {
        val uploader = uploader()
        repeat(2) {
            uploader.upload(statusUpload(name = "sms_status_m1_SENT", status = "SENT"))
            uploader.upload(statusUpload(name = "sms_status_m1_DELIVERED", status = "DELIVERED"))
            uploader.upload(receivedUpload())
        }

        assertEquals(3, jobs.queued.size)
        assertEquals(3, transport.sent.size)
        assertEquals(3, uploader.trackedNameCount())
    }

    @Test
    fun failureReportsBypassTheNameMap() {
        val uploader = uploader()
        repeat(2) {
            uploader.upload(statusUpload(name = "sms_status_m1_FAILED", status = "FAILED"))
            uploader.upload(statusUpload(name = "sms_status_m1_DELIVERY_FAILED", status = "DELIVERY_FAILED"))
        }

        assertEquals(4, jobs.queued.size)
        assertEquals(4, transport.sent.size)
        assertEquals(0, uploader.trackedNameCount())
    }

    @Test
    fun withPartReportsAFailureUsesTheNameMap() {
        val uploader = uploader()
        repeat(2) {
            uploader.upload(statusUpload(name = "sms_status_m1_0_FAILED_none", status = "FAILED", partReports = true))
            uploader.upload(statusUpload(name = "sms_status_m1_1_FAILED_none", status = "FAILED", partReports = true))
        }

        assertEquals(2, jobs.queued.size)
        assertEquals(2, transport.sent.size)
        assertEquals(2, uploader.trackedNameCount())
    }

    @Test
    fun withPartReportsSentAndDeliveredStillUseTheNameMap() {
        val uploader = uploader()
        repeat(2) {
            uploader.upload(statusUpload(name = "sms_status_m1_0_SENT_none", status = "SENT", partReports = true))
            uploader.upload(statusUpload(name = "sms_status_m1_0_DELIVERED_0", status = "DELIVERED", partReports = true))
        }

        assertEquals(2, jobs.queued.size)
        assertEquals(2, uploader.trackedNameCount())
    }

    @Test
    fun withPartReportsADeliveryFailureBypassesTheNameMap() {
        val uploader = uploader()
        repeat(2) {
            uploader.upload(statusUpload(name = "sms_status_m1_0_DELIVERY_FAILED_none", status = "DELIVERY_FAILED", partReports = true))
        }

        assertEquals(2, jobs.queued.size)
        assertEquals(0, uploader.trackedNameCount())
    }

    @Test
    fun nameMapDropsExpiredEntries() {
        val uploader = uploader()
        repeat(500) { uploader.upload(statusUpload(name = "sms_status_m${it}_SENT")) }
        assertEquals(500, uploader.trackedNameCount())

        now += DirectUploader.DEDUPE_WINDOW_MS
        uploader.upload(statusUpload(name = "sms_status_next_SENT"))

        assertEquals(1, uploader.trackedNameCount())
    }

    @Test
    fun nameMapStaysSmallDuringALongSend() {
        val uploader = uploader()
        val stepMs = 5_000L
        repeat(2_000) {
            uploader.upload(statusUpload(name = "sms_status_m${it}_SENT"))
            now += stepMs
        }

        val maxInWindow = (DirectUploader.DEDUPE_WINDOW_MS / stepMs).toInt()
        assertTrue(uploader.trackedNameCount() <= maxInWindow)
    }

    @Test
    fun switchOffQueuesWithNoStartDelayAndNoDirectCall() {
        switchOn = false
        val uploader = uploader()
        uploader.upload(statusUpload())
        uploader.upload(statusUpload())

        assertEquals(2, jobs.queued.size)
        jobs.queued.forEach {
            assertEquals(0L, it.startDelayMs)
            assertEquals(false, it.directTried)
        }
        assertTrue(transport.sent.isEmpty())
        assertTrue(jobs.cancelled.isEmpty())
    }

    @Test
    fun missingDeviceIdOrApiKeyUploadsNothing() {
        val uploader = uploader()
        uploader.upload(statusUpload(deviceId = ""))
        uploader.upload(statusUpload(apiKey = ""))
        switchOn = false
        uploader.upload(statusUpload(deviceId = ""))

        assertTrue(jobs.queued.isEmpty())
        assertTrue(transport.sent.isEmpty())
    }

    @Test
    fun noValidatedInternetQueuesTheJobWithNoFlagAndNoStartDelay() {
        online = false
        val upload = statusUpload()
        uploader().upload(upload)

        val job = jobs.queued.single()
        assertEquals(0L, job.startDelayMs)
        assertEquals(false, job.directTried)
        assertEquals(0, upload.sms.reportAttempt)
        assertTrue(transport.sent.isEmpty())
        assertTrue(jobs.cancelled.isEmpty())
    }

    @Test
    fun fullPoolDropsTheCallAndKeepsTheJob() {
        uploader(Executor { throw RejectedExecutionException() }).upload(statusUpload())

        assertEquals(1, jobs.queued.size)
        assertTrue(transport.sent.isEmpty())
        assertTrue(jobs.cancelled.isEmpty())
        assertTrue(events.isEmpty())
    }

    @Test
    fun directCallReportsAttemptOne() {
        uploader().upload(statusUpload())
        assertEquals(listOf(1), transport.reportAttempts)
    }

    @Test
    fun workerReportAttemptCountsTheDirectCall() {
        assertEquals(1, DirectUploader.workerReportAttempt(0, directTried = false))
        assertEquals(3, DirectUploader.workerReportAttempt(2, directTried = false))
        assertEquals(2, DirectUploader.workerReportAttempt(0, directTried = true))
        assertEquals(4, DirectUploader.workerReportAttempt(2, directTried = true))
    }

    @Test
    fun receivedSmsUsesTheSamePath() {
        uploader().upload(receivedUpload())

        assertEquals(1, transport.sent.size)
        assertEquals(UploadKind.RECEIVED, transport.sent.single().kind)
        assertEquals(listOf(0), transport.reportAttempts)
        assertEquals(listOf(jobs.queued.single().id), jobs.cancelled)
        assertEquals(1, events.size)
        assertTrue(events.single().startsWith("sms_forwarded: "))
    }

    @Test
    fun rejectedUploadIsLogged() {
        transport.result = { 400 }
        uploader().upload(statusUpload())
        assertEquals(listOf("status_upload_failed: http 400, direct"), events)
    }
}
