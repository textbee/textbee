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

        override fun enqueue(upload: Upload, startDelayMs: Long, directTried: Boolean): UUID {
            val id = UUID.randomUUID()
            queued += Queued(upload.workName, startDelayMs, directTried, id)
            return id
        }

        override fun cancel(id: UUID) {
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
    private val events = mutableListOf<String>()

    private fun uploader(pool: Executor = Executor { it.run() }) = DirectUploader(
        jobs = jobs,
        transport = transport,
        clock = UploadClock { now },
        network = NetworkCheck { online },
        pool = pool,
        enabled = { switchOn },
        events = UploadEvents { event, detail, _ -> events += "$event: $detail" },
    )

    private fun statusUpload(
        name: String = "sms_status_m1_SENT",
        deviceId: String = "device-1",
        apiKey: String = "key-1",
    ) = Upload(
        UploadKind.STATUS, name, deviceId, apiKey,
        SMSDTO().apply { smsId = "m1"; status = "SENT" },
    )

    private fun receivedUpload() = Upload(
        UploadKind.RECEIVED, "sms_received_abc", "device-1", "key-1",
        SMSDTO().apply { sender = "+15555550100"; fingerprint = "abc" },
    )

    @Test
    fun successCancelsTheQueuedJob() {
        listOf(200, 201, 204).forEach { code ->
            val jobs = FakeJobs()
            val uploader = DirectUploader(
                jobs, FakeTransport { code }, { now }, { true }, Executor { it.run() }, { true }, { _, _, _ -> },
            )
            uploader.upload(statusUpload())
            assertEquals("code $code", listOf(jobs.queued.single().id), jobs.cancelled)
        }
    }

    @Test
    fun queuesTheJobWithAStartDelayAndTheFlag() {
        uploader().upload(statusUpload())

        val job = jobs.queued.single()
        assertEquals("sms_status_m1_SENT", job.name)
        assertEquals(DirectUploader.JOB_START_DELAY_MS, job.startDelayMs)
        assertEquals(30_000L, job.startDelayMs)
        assertTrue(job.directTried)
        assertEquals(listOf("status_uploaded: SENT, direct"), events)
    }

    @Test
    fun nonRetryableCodesCancelTheQueuedJob() {
        listOf(400, 401, 403, 404, 422).forEach { code ->
            val jobs = FakeJobs()
            val uploader = DirectUploader(
                jobs, FakeTransport { code }, { now }, { true }, Executor { it.run() }, { true }, { _, _, _ -> },
            )
            uploader.upload(statusUpload())
            assertEquals("code $code", listOf(jobs.queued.single().id), jobs.cancelled)
        }
    }

    @Test
    fun retryableCodesKeepTheQueuedJob() {
        listOf(408, 429, 500, 502, 503).forEach { code ->
            val jobs = FakeJobs()
            val uploader = DirectUploader(
                jobs, FakeTransport { code }, { now }, { true }, Executor { it.run() }, { true }, { _, _, _ -> },
            )
            uploader.upload(statusUpload())
            assertEquals("code $code", 1, jobs.queued.size)
            assertTrue("code $code", jobs.cancelled.isEmpty())
        }
    }

    @Test
    fun networkErrorKeepsTheQueuedJob() {
        transport.result = { throw IOException("connection reset") }
        uploader().upload(statusUpload())

        assertEquals(1, transport.sent.size)
        assertEquals(1, jobs.queued.size)
        assertTrue(jobs.cancelled.isEmpty())
        assertTrue(events.isEmpty())
    }

    @Test
    fun timeoutKeepsTheQueuedJob() {
        transport.result = { throw InterruptedIOException("timeout") }
        uploader().upload(statusUpload())

        assertEquals(1, transport.sent.size)
        assertTrue(jobs.cancelled.isEmpty())
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
        uploader.upload(statusUpload(name = "sms_status_m1_DELIVERED"))

        assertEquals(2, jobs.queued.size)
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
    fun noValidatedInternetLeavesTheUploadToTheJob() {
        online = false
        uploader().upload(statusUpload())

        assertEquals(1, jobs.queued.size)
        assertTrue(transport.sent.isEmpty())
        assertTrue(jobs.cancelled.isEmpty())
    }

    @Test
    fun fullPoolDropsTheCallAndKeepsTheJob() {
        uploader(Executor { throw RejectedExecutionException() }).upload(statusUpload())

        assertEquals(1, jobs.queued.size)
        assertTrue(transport.sent.isEmpty())
        assertTrue(jobs.cancelled.isEmpty())
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
